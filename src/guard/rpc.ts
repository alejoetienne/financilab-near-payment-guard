/**
 * Tiny, fetch-based, READ-ONLY NEAR JSON-RPC client.
 *
 * Only these methods are ever called: `query` (view_account, view_access_key_list,
 * view_code) and `block`. There is deliberately no code path that sends
 * `send_tx`/`broadcast_tx_*`: this project never signs or broadcasts.
 */
import type { FetchLike, KeySummary, Network } from './types.js';

/**
 * Tried in order. FastNEAR's free RPC is first because, as of 2026-11-11, the
 * near.org endpoints answer correctly but with a constant ~3 s delay; they are
 * kept as fallbacks. Both are public, keyless, CORS-enabled.
 */
export const RPC_ENDPOINTS: Record<Network, string[]> = {
  testnet: ['https://test.rpc.fastnear.com', 'https://rpc.testnet.near.org'],
  mainnet: ['https://free.rpc.fastnear.com', 'https://rpc.mainnet.near.org'],
};

/** Allowlist of RPC methods / request types. Anything else throws before touching the network. */
const READ_ONLY_METHODS = new Set(['query', 'block']);
const READ_ONLY_REQUESTS = new Set(['view_account', 'view_access_key_list', 'view_code']);

export class RpcError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'timeout' | 'http' | 'rpc',
    public readonly causeName?: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface ViewAccountResult {
  exists: true;
  amount: string;
  locked: string;
  codeHash: string;
  storageUsage: number;
  blockHeight: number;
}

export interface RpcClientOptions {
  network: Network;
  fetch?: FetchLike;
  endpoints?: string[];
  timeoutMs?: number;
}

export interface RpcClient {
  network: Network;
  /** Endpoint that answered most recently. */
  lastEndpoint(): string | undefined;
  viewAccount(accountId: string): Promise<ViewAccountResult | { exists: false }>;
  viewAccessKeyList(accountId: string): Promise<KeySummary>;
  block(): Promise<{ height: number; timestampNs: string }>;
}

function defaultFetch(): FetchLike {
  if (typeof globalThis.fetch !== 'function') throw new Error('No fetch available; pass one via options.fetch');
  return globalThis.fetch.bind(globalThis) as unknown as FetchLike;
}

export async function fetchJsonWithTimeout(
  fetchFn: FetchLike,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string },
  timeoutMs: number,
): Promise<unknown> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl?.abort();
      reject(new RpcError(`timeout after ${timeoutMs}ms`, 'timeout'));
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([fetchFn(url, { ...init, signal: ctrl?.signal }), timeout]);
    if (!res.ok) throw new RpcError(`HTTP ${res.status}`, 'http');
    return await Promise.race([res.json(), timeout]);
  } catch (e) {
    if (e instanceof RpcError) throw e;
    throw new RpcError(e instanceof Error ? e.message : String(e), 'network');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface JsonRpcResponse {
  result?: Record<string, unknown>;
  error?: { name?: string; message?: string; data?: unknown; cause?: { name?: string; info?: unknown } };
}

function isUnknownAccount(err: JsonRpcResponse['error']): boolean {
  if (!err) return false;
  if (err.cause?.name === 'UNKNOWN_ACCOUNT') return true;
  const data = typeof err.data === 'string' ? err.data : '';
  return /does not exist while viewing/.test(data);
}

export function createRpcClient(opts: RpcClientOptions): RpcClient {
  const fetchFn = opts.fetch ?? defaultFetch();
  const endpoints = opts.endpoints ?? RPC_ENDPOINTS[opts.network];
  const timeoutMs = opts.timeoutMs ?? 6000;
  let last: string | undefined;

  async function call(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (!READ_ONLY_METHODS.has(method)) throw new Error(`Refusing non read-only RPC method: ${method}`);
    if (method === 'query' && !READ_ONLY_REQUESTS.has(String(params.request_type))) {
      throw new Error(`Refusing non read-only query: ${String(params.request_type)}`);
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id: 'financilab-guard', method, params });
    let lastErr: unknown;
    for (const url of endpoints) {
      try {
        const json = (await fetchJsonWithTimeout(
          fetchFn,
          url,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body },
          timeoutMs,
        )) as JsonRpcResponse;
        // Node-side errors that are not about the account → try the next endpoint.
        if (json.error && !isUnknownAccount(json.error) && json.error.cause?.name !== 'UNKNOWN_ACCESS_KEY') {
          const name = json.error.cause?.name ?? json.error.name ?? 'RPC_ERROR';
          lastErr = new RpcError(`${name}: ${typeof json.error.data === 'string' ? json.error.data : json.error.message ?? ''}`, 'rpc', name);
          continue;
        }
        last = url;
        return json;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new RpcError(String(lastErr), 'network');
  }

  return {
    network: opts.network,
    lastEndpoint: () => last,
    async viewAccount(accountId) {
      const json = await call('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
      if (isUnknownAccount(json.error)) return { exists: false };
      const r = json.result ?? {};
      return {
        exists: true,
        amount: String(r.amount ?? '0'),
        locked: String(r.locked ?? '0'),
        codeHash: String(r.code_hash ?? ''),
        storageUsage: Number(r.storage_usage ?? 0),
        blockHeight: Number(r.block_height ?? 0),
      };
    },
    async viewAccessKeyList(accountId) {
      const json = await call('query', { request_type: 'view_access_key_list', finality: 'final', account_id: accountId });
      if (isUnknownAccount(json.error)) return { total: 0, fullAccess: 0, functionCall: 0 };
      const keys = (json.result?.keys as Array<{ access_key?: { permission?: unknown } }> | undefined) ?? [];
      let fullAccess = 0;
      let functionCall = 0;
      for (const k of keys) {
        if (k.access_key?.permission === 'FullAccess') fullAccess++;
        else functionCall++;
      }
      return { total: keys.length, fullAccess, functionCall };
    },
    async block() {
      const json = await call('block', { finality: 'final' });
      const header = (json.result?.header ?? {}) as Record<string, unknown>;
      return { height: Number(header.height ?? 0), timestampNs: String(header.timestamp_nanosec ?? header.timestamp ?? '0') };
    },
  };
}
