/**
 * Offline fixtures: a fake `fetch` that answers NEAR JSON-RPC and NearBlocks
 * requests from an in-memory map shaped like the real responses (captured from
 * testnet on 2026-11-11). Used by tests, `--offline` demos and the UI's offline mode.
 */
import type { FetchLike } from './types.js';

export interface FixtureAccount {
  amountNear: string;
  contract?: boolean;
  fullAccessKeys?: number;
  functionCallKeys?: number;
  storageUsage?: number;
  /** Days since creation; null = indexer does not know (common on testnet). */
  createdDaysAgo?: number | null;
  /** Recent transactions (most recent first). */
  txns?: Array<{ signer: string; receiver: string; daysAgo: number }>;
}

export interface FixtureOptions {
  accounts?: Record<string, FixtureAccount>;
  nowMs?: number;
  /** Simulate RPC outage (every RPC request throws). */
  failRpc?: boolean;
  /** Simulate indexer outage. */
  failIndexer?: boolean;
  /** Simulate a hanging indexer (never resolves; exercises timeouts). */
  hangIndexer?: boolean;
  /** Record of every request made (for assertions). */
  log?: Array<{ url: string; method: string; body?: unknown }>;
}

const many = (n: number, other: string, self: string, start = 0.2, step = 0.5) =>
  Array.from({ length: n }, (_, i) => (i % 2 ? { signer: self, receiver: other, daysAgo: start + i * step } : { signer: other, receiver: self, daysAgo: start + i * step }));

export const DEFAULT_FIXTURE_ACCOUNTS: Record<string, FixtureAccount> = {
  'alice.testnet': {
    amountNear: '1131.8311',
    fullAccessKeys: 2,
    storageUsage: 428,
    createdDaysAgo: null,
    txns: many(25, 'friend.testnet', 'alice.testnet'),
  },
  'guest-book.testnet': {
    amountNear: '4495.7318',
    contract: true,
    fullAccessKeys: 4,
    storageUsage: 6863241,
    createdDaysAgo: null,
    txns: many(25, 'visitor.testnet', 'guest-book.testnet', 0.1, 0.3),
  },
  'wrap.testnet': {
    amountNear: '127311150.4313',
    contract: true,
    fullAccessKeys: 1,
    storageUsage: 20953305,
    txns: many(25, 'trader.testnet', 'wrap.testnet', 0.01, 0.01),
  },
  // Real testnet account that happens to look like alice.testnet (dormant since 2022).
  'a1ice.testnet': {
    amountNear: '130.6594',
    fullAccessKeys: 6,
    storageUsage: 1000,
    createdDaysAgo: null,
    txns: many(25, 'someone.testnet', 'a1ice.testnet', 1519, 3),
  },
  'nuevo-vendedor.testnet': {
    amountNear: '0.5',
    fullAccessKeys: 1,
    storageUsage: 182,
    createdDaysAgo: 2,
    txns: [{ signer: 'testnet', receiver: 'nuevo-vendedor.testnet', daysAgo: 2 }],
  },
  'cuenta-bloqueada.testnet': { amountNear: '3', fullAccessKeys: 0, functionCallKeys: 0, storageUsage: 182, txns: many(5, 'x.testnet', 'cuenta-bloqueada.testnet', 30, 10) },
  'wrap.near': {
    amountNear: '127311150.4313',
    contract: true,
    fullAccessKeys: 0,
    storageUsage: 20953305,
    createdDaysAgo: 2000,
    txns: many(25, 'trader.near', 'wrap.near', 0.001, 0.001),
  },
};

const DAY = 86_400_000;
const yocto = (near: string): string => {
  const [w, f = ''] = near.split('.');
  return (BigInt(w!) * 10n ** 24n + BigInt((f + '0'.repeat(24)).slice(0, 24))).toString();
};

function respond(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

export function createFixtureFetch(opts: FixtureOptions = {}): FetchLike {
  const accounts = opts.accounts ?? DEFAULT_FIXTURE_ACCOUNTS;
  const now = opts.nowMs ?? Date.now();
  const nsAt = (daysAgo: number) => (BigInt(Math.round(now - daysAgo * DAY)) * 1_000_000n).toString();

  return async (url, init) => {
    const method = init?.method ?? 'GET';
    let body: Record<string, unknown> | undefined;
    if (init?.body) body = JSON.parse(init.body) as Record<string, unknown>;
    opts.log?.push({ url, method, body });

    if (url.includes('nearblocks.io')) {
      if (opts.hangIndexer) {
        return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      if (opts.failIndexer) throw new Error('fixture: indexer unavailable');
      const m = /\/v3\/accounts\/([^/?]+)(\/txns)?/.exec(url);
      if (!m) return respond({ error: 'not found' }, 404);
      const id = decodeURIComponent(m[1]!);
      const acc = accounts[id];
      if (m[2]) {
        const rows = (acc?.txns ?? []).map((t, i) => ({
          transaction_hash: `fixture-${id}-${i}`,
          signer_account_id: t.signer,
          receiver_account_id: t.receiver,
          block_timestamp: nsAt(t.daysAgo),
          actions: [{ action: 'TRANSFER', method: null }],
        }));
        return respond({ data: rows });
      }
      const created = acc && acc.createdDaysAgo != null ? { block_timestamp: nsAt(acc.createdDaysAgo), transaction_hash: `fixture-create-${id}` } : {};
      return respond({ data: { account_id: id, created, deleted: {}, locked: false } });
    }

    // JSON-RPC
    if (opts.failRpc) throw new Error('fixture: rpc unavailable');
    const params = (body?.params ?? {}) as Record<string, unknown>;
    if (body?.method === 'block') {
      return respond({ jsonrpc: '2.0', id: body.id, result: { header: { height: 277180000, timestamp_nanosec: nsAt(0) } } });
    }
    if (body?.method !== 'query') return respond({ jsonrpc: '2.0', id: body?.id, error: { name: 'REQUEST_VALIDATION_ERROR', message: 'unsupported in fixtures' } });
    const id = String(params.account_id ?? '');
    const acc = accounts[id];
    if (!acc) {
      return respond({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          name: 'HANDLER_ERROR',
          cause: { name: 'UNKNOWN_ACCOUNT', info: { requested_account_id: id } },
          code: -32000,
          message: 'Server error',
          data: `account ${id} does not exist while viewing`,
        },
      });
    }
    if (params.request_type === 'view_account') {
      return respond({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          amount: yocto(acc.amountNear),
          locked: '0',
          code_hash: acc.contract ? '9UnkWSYw6Bj9qkyV5jqtMBYYi7aHTaDUMaoU6dtJQRvy' : '11111111111111111111111111111111',
          storage_usage: acc.storageUsage ?? 182,
          storage_paid_at: 0,
          block_height: 277180000,
        },
      });
    }
    if (params.request_type === 'view_access_key_list') {
      const keys = [
        ...Array.from({ length: acc.fullAccessKeys ?? 1 }, (_, i) => ({ public_key: `ed25519:FixtureFull${i}`, access_key: { nonce: 1, permission: 'FullAccess' } })),
        ...Array.from({ length: acc.functionCallKeys ?? 0 }, (_, i) => ({
          public_key: `ed25519:FixtureFc${i}`,
          access_key: { nonce: 1, permission: { FunctionCall: { allowance: '250000000000000000000000', receiver_id: 'app.testnet', method_names: [] } } },
        })),
      ];
      return respond({ jsonrpc: '2.0', id: body.id, result: { keys, block_height: 277180000 } });
    }
    return respond({ jsonrpc: '2.0', id: body.id, error: { name: 'REQUEST_VALIDATION_ERROR', message: 'unsupported request_type' } });
  };
}
