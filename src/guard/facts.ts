/**
 * Collect on-chain facts about the receiver (and optionally the sender) using
 * only read-only RPC + public indexer GETs. All calls run in parallel; any
 * failure is recorded in `facts.errors` and the corresponding field stays null.
 */
import { createIndexerClient, type IndexerClient, type IndexerTxn } from './indexer.js';
import { classifyAccountId, EMPTY_CODE_HASH, explorerUrl, formatYoctoToNear } from './near.js';
import { createRpcClient, type RpcClient } from './rpc.js';
import type { AccountFacts, FetchLike, Network } from './types.js';

export interface FactsOptions {
  network: Network;
  fetch?: FetchLike;
  rpc?: RpcClient;
  indexer?: IndexerClient;
  rpcTimeoutMs?: number;
  indexerTimeoutMs?: number;
  /** Skip indexer calls entirely (e.g. strict offline mode). */
  skipIndexer?: boolean;
  txnLimit?: number;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function collectFacts(receiver: string, sender: string | undefined, opts: FactsOptions): Promise<AccountFacts> {
  const kind = classifyAccountId(receiver);
  const facts: AccountFacts = {
    accountId: receiver,
    network: opts.network,
    kind,
    exists: null,
    keys: null,
    createdAt: null,
    recentTxCount: null,
    lastActiveAt: null,
    priorInteractions: null,
    senderBalanceYocto: null,
    explorerUrl: explorerUrl(opts.network, receiver),
    errors: [],
  };
  if (kind === 'invalid') return facts;

  const rpc = opts.rpc ?? createRpcClient({ network: opts.network, fetch: opts.fetch, timeoutMs: opts.rpcTimeoutMs });
  const indexer =
    opts.indexer ?? createIndexerClient({ network: opts.network, fetch: opts.fetch, timeoutMs: opts.indexerTimeoutMs });
  const limit = opts.txnLimit ?? 25;
  const senderOk = sender && classifyAccountId(sender) !== 'invalid' && sender !== receiver ? sender : undefined;

  const [acc, keys, created, txns, senderAcc, senderTxns] = await Promise.allSettled([
    rpc.viewAccount(receiver),
    rpc.viewAccessKeyList(receiver),
    opts.skipIndexer ? Promise.reject(new Error('indexer disabled')) : indexer.getCreatedAt(receiver),
    opts.skipIndexer ? Promise.reject(new Error('indexer disabled')) : indexer.getRecentTxns(receiver, limit),
    senderOk ? rpc.viewAccount(senderOk) : Promise.resolve(null),
    senderOk && !opts.skipIndexer ? indexer.getRecentTxns(senderOk, limit) : Promise.resolve(null),
  ]);

  if (acc.status === 'fulfilled') {
    facts.rpcEndpoint = rpc.lastEndpoint();
    if (acc.value.exists) {
      facts.exists = true;
      facts.balanceYocto = acc.value.amount;
      facts.balanceNear = formatYoctoToNear(acc.value.amount, 4);
      facts.codeHash = acc.value.codeHash;
      facts.isContract = acc.value.codeHash !== '' && acc.value.codeHash !== EMPTY_CODE_HASH;
      facts.storageUsage = acc.value.storageUsage;
    } else {
      facts.exists = false;
    }
  } else {
    facts.errors.push(`rpc view_account: ${errMsg(acc.reason)}`);
  }

  if (keys.status === 'fulfilled' && facts.exists) facts.keys = keys.value;
  else if (keys.status === 'rejected' && facts.exists !== false) facts.errors.push(`rpc view_access_key_list: ${errMsg(keys.reason)}`);

  if (created.status === 'fulfilled') {
    facts.createdAt = created.value ? new Date(created.value).toISOString() : null;
  } else if (!opts.skipIndexer) {
    facts.errors.push(`indexer account: ${errMsg(created.reason)}`);
  }

  if (txns.status === 'fulfilled') {
    const list = txns.value;
    facts.recentTxCount = list.length;
    const latest = list.reduce((m, t) => (Number.isFinite(t.timestampMs) && t.timestampMs > m ? t.timestampMs : m), 0);
    facts.lastActiveAt = latest ? new Date(latest).toISOString() : null;
  } else if (!opts.skipIndexer) {
    facts.errors.push(`indexer txns: ${errMsg(txns.reason)}`);
  }

  if (senderOk) {
    if (senderAcc.status === 'fulfilled' && senderAcc.value && senderAcc.value.exists) {
      facts.senderBalanceYocto = senderAcc.value.amount;
    } else if (senderAcc.status === 'rejected') {
      facts.errors.push(`rpc sender view_account: ${errMsg(senderAcc.reason)}`);
    }
    const pairs: IndexerTxn[] = [];
    let known = false;
    if (txns.status === 'fulfilled') {
      known = true;
      pairs.push(...txns.value);
    }
    if (senderTxns.status === 'fulfilled' && senderTxns.value) {
      known = true;
      pairs.push(...senderTxns.value);
    }
    if (known) {
      const seen = new Set<string>();
      let n = 0;
      for (const t of pairs) {
        const key = t.hash || `${t.signer}>${t.receiver}@${t.timestampMs}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if ((t.signer === senderOk && t.receiver === receiver) || (t.signer === receiver && t.receiver === senderOk)) n++;
      }
      facts.priorInteractions = n;
    }
  }
  return facts;
}
