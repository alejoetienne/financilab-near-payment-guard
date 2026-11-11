/**
 * Best-effort, read-only NearBlocks v3 client (public, no API key, CORS *).
 * Every call has a short timeout; failures return `null` and are reported as
 * "activity data unavailable" instead of breaking the check.
 */
import { fetchJsonWithTimeout } from './rpc.js';
import type { FetchLike, Network } from './types.js';

export const INDEXER_HOSTS: Record<Network, string> = {
  testnet: 'https://api-testnet.nearblocks.io',
  mainnet: 'https://api.nearblocks.io',
};

export interface IndexerTxn {
  hash: string;
  signer: string;
  receiver: string;
  timestampMs: number;
}

export interface IndexerClient {
  /** Account creation time in ms, `null` if the indexer does not know it. */
  getCreatedAt(accountId: string): Promise<number | null>;
  getRecentTxns(accountId: string, limit?: number): Promise<IndexerTxn[]>;
}

export interface IndexerOptions {
  network: Network;
  fetch?: FetchLike;
  host?: string;
  timeoutMs?: number;
}

const nsToMs = (ns: unknown): number => {
  try {
    return Number(BigInt(String(ns)) / 1_000_000n);
  } catch {
    return NaN;
  }
};

export function createIndexerClient(opts: IndexerOptions): IndexerClient {
  const fetchFn = opts.fetch ?? (globalThis.fetch.bind(globalThis) as unknown as FetchLike);
  const host = opts.host ?? INDEXER_HOSTS[opts.network];
  const timeoutMs = opts.timeoutMs ?? 4000;
  const get = (path: string) =>
    fetchJsonWithTimeout(fetchFn, `${host}${path}`, { method: 'GET', headers: { accept: 'application/json' } }, timeoutMs);

  return {
    async getCreatedAt(accountId) {
      const json = (await get(`/v3/accounts/${encodeURIComponent(accountId)}`)) as {
        data?: { created?: { block_timestamp?: string } } | Array<{ created?: { block_timestamp?: string } }>;
      };
      const data = Array.isArray(json.data) ? json.data[0] : json.data;
      const ts = data?.created?.block_timestamp;
      if (!ts) return null;
      const ms = nsToMs(ts);
      return Number.isFinite(ms) ? ms : null;
    },
    async getRecentTxns(accountId, limit = 25) {
      const json = (await get(`/v3/accounts/${encodeURIComponent(accountId)}/txns?limit=${limit}`)) as {
        data?: Array<Record<string, unknown>>;
        txns?: Array<Record<string, unknown>>;
      };
      const rows = json.data ?? json.txns ?? [];
      if (!Array.isArray(rows)) throw new Error('unexpected indexer response');
      return rows.map((r) => ({
        hash: String(r.transaction_hash ?? ''),
        signer: String(r.signer_account_id ?? ''),
        receiver: String(r.receiver_account_id ?? ''),
        timestampMs: nsToMs(r.block_timestamp ?? (r.block as Record<string, unknown> | undefined)?.block_timestamp),
      }));
    },
  };
}
