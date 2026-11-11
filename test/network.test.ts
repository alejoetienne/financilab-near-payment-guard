import { describe, expect, it, vi } from 'vitest';
import { checkPayment } from '../src/guard/engine.js';
import { collectFacts } from '../src/guard/facts.js';
import { createFixtureFetch } from '../src/guard/fixtures.js';
import { createIndexerClient } from '../src/guard/indexer.js';
import { createRpcClient, RpcError } from '../src/guard/rpc.js';
import type { FetchLike } from '../src/guard/types.js';
import { ids, NOW, offline } from './helpers.js';

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('RPC client (read-only)', () => {
  it('parses view_account and detects contracts', async () => {
    const rpc = createRpcClient({ network: 'testnet', fetch: createFixtureFetch({ nowMs: NOW }) });
    const a = await rpc.viewAccount('guest-book.testnet');
    expect(a.exists).toBe(true);
    if (a.exists) expect(a.codeHash).not.toBe('11111111111111111111111111111111');
  });
  it('maps UNKNOWN_ACCOUNT to exists:false', async () => {
    const rpc = createRpcClient({ network: 'testnet', fetch: createFixtureFetch() });
    expect(await rpc.viewAccount('premio-bac-ni.testnet')).toEqual({ exists: false });
  });
  it('counts full-access vs function-call keys', async () => {
    const fetch = createFixtureFetch({ accounts: { 'k.testnet': { amountNear: '1', fullAccessKeys: 1, functionCallKeys: 2 } } });
    const rpc = createRpcClient({ network: 'testnet', fetch });
    expect(await rpc.viewAccessKeyList('k.testnet')).toEqual({ total: 3, fullAccess: 1, functionCall: 2 });
  });
  it('falls back to the second endpoint when the first fails', async () => {
    const calls: string[] = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push(url);
      if (url.includes('primary')) throw new Error('ECONNRESET');
      return createFixtureFetch()(url, init);
    };
    const rpc = createRpcClient({ network: 'testnet', fetch, endpoints: ['https://primary.example', 'https://fallback.example'] });
    const a = await rpc.viewAccount('alice.testnet');
    expect(a.exists).toBe(true);
    expect(calls).toEqual(['https://primary.example', 'https://fallback.example']);
    expect(rpc.lastEndpoint()).toBe('https://fallback.example');
  });
  it('times out hanging requests', async () => {
    const fetch: FetchLike = () => new Promise(() => {});
    const rpc = createRpcClient({ network: 'testnet', fetch, endpoints: ['https://slow.example'], timeoutMs: 30 });
    await expect(rpc.viewAccount('alice.testnet')).rejects.toBeInstanceOf(RpcError);
  });
  it('only sends allowlisted read-only methods', async () => {
    const log: Array<{ url: string; method: string; body?: unknown }> = [];
    await checkPayment({ receiver: 'alice.testnet', amountNear: '1', sender: 'guest-book.testnet' }, offline({ log }));
    const rpcBodies = log.filter((l) => l.body).map((l) => l.body as { method: string; params: { request_type?: string } });
    expect(rpcBodies.length).toBeGreaterThan(0);
    for (const b of rpcBodies) {
      expect(['query', 'block']).toContain(b.method);
      if (b.method === 'query') expect(['view_account', 'view_access_key_list', 'view_code']).toContain(b.params.request_type);
    }
    for (const l of log.filter((x) => !x.body)) expect(l.method).toBe('GET');
  });
});

describe('Indexer client (best-effort)', () => {
  it('parses created timestamp (ns) and txns', async () => {
    const idx = createIndexerClient({ network: 'testnet', fetch: createFixtureFetch({ nowMs: NOW }) });
    const created = await idx.getCreatedAt('nuevo-vendedor.testnet');
    expect(Math.round((NOW - created!) / 86_400_000)).toBe(2);
    expect(await idx.getCreatedAt('alice.testnet')).toBeNull(); // testnet often returns created: {}
    const txns = await idx.getRecentTxns('alice.testnet');
    expect(txns).toHaveLength(25);
    expect(txns[0]!.timestampMs).toBeGreaterThan(0);
  });
  it('handles the real NearBlocks response shape', async () => {
    const fetch = vi.fn(async (_url: string) =>
      ok({ data: [{ transaction_hash: 'h', signer_account_id: 'a', receiver_account_id: 'b', block: { block_timestamp: '1793688218089039000' }, block_timestamp: '1793688218089039000' }] }),
    );
    const idx = createIndexerClient({ network: 'mainnet', fetch });
    const [t] = await idx.getRecentTxns('b');
    expect(t).toEqual({ hash: 'h', signer: 'a', receiver: 'b', timestampMs: 1793688218089 });
    expect(fetch.mock.calls[0]![0]).toBe('https://api.nearblocks.io/v3/accounts/b/txns?limit=25');
  });
});

describe('facts & graceful degradation', () => {
  it('collects receiver facts and prior interactions', async () => {
    const f = await collectFacts('alice.testnet', 'friend.testnet', { network: 'testnet', fetch: createFixtureFetch({ nowMs: NOW }) });
    expect(f.exists).toBe(true);
    expect(f.isContract).toBe(false);
    expect(f.keys?.fullAccess).toBe(2);
    expect(f.recentTxCount).toBe(25);
    expect(f.priorInteractions).toBe(25);
    expect(f.errors).toEqual([]);
  });
  it('indexer down → "activity data unavailable", decision still made from RPC', async () => {
    const r = await checkPayment({ receiver: 'alice.testnet', amountNear: '1' }, offline({ failIndexer: true }));
    expect(r.decision).toBe('allow');
    expect(ids(r)).toContain('activity_unavailable');
    expect(r.facts.errors.some((e) => e.startsWith('indexer'))).toBe(true);
  });
  it('indexer hanging → times out and degrades', async () => {
    const r = await checkPayment({ receiver: 'alice.testnet', amountNear: '1' }, offline({ hangIndexer: true }, { indexerTimeoutMs: 50 }));
    expect(r.facts.recentTxCount).toBeNull();
    expect(r.facts.errors.join(' ')).toMatch(/timeout/);
    expect(r.decision).toBe('allow');
  });
  it('RPC down → fail safe to needs_human (never allow unverified)', async () => {
    const r = await checkPayment({ receiver: 'alice.testnet', amountNear: '1' }, offline({ failRpc: true }));
    expect(r.facts.exists).toBeNull();
    expect(ids(r)).toContain('rpc_unavailable');
    expect(r.decision).toBe('needs_human');
  });
  it('everything down + denylisted receiver → still deny (local rules)', async () => {
    const r = await checkPayment({ receiver: 'premio-bac-ni.testnet', amountNear: '1' }, offline({ failRpc: true, failIndexer: true }));
    expect(r.decision).toBe('deny');
  });
  it('invalid account id never touches the network', async () => {
    const log: Array<{ url: string; method: string }> = [];
    const r = await checkPayment({ receiver: 'NOT VALID', amountNear: '1' }, offline({ log }));
    expect(r.decision).toBe('deny');
    expect(log).toHaveLength(0);
  });
  it('fetch that throws synchronously-ish never makes checkPayment throw', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(checkPayment({ receiver: 'alice.testnet', amountNear: '1' }, { fetch, nowMs: NOW })).resolves.toMatchObject({ decision: 'needs_human' });
  });
});
