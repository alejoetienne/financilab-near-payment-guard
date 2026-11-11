import { createFixtureFetch, type FixtureOptions } from '../src/guard/fixtures.js';
import type { CheckOptions } from '../src/guard/engine.js';
import type { AccountFacts } from '../src/guard/types.js';

export const NOW = Date.parse('2026-11-11T12:00:00Z');
const DAY = 86_400_000;

/** CheckOptions wired to offline fixtures with a fixed clock. */
export function offline(fx: FixtureOptions = {}, extra: CheckOptions = {}): CheckOptions {
  return { fetch: createFixtureFetch({ nowMs: NOW, ...fx }), nowMs: NOW, ...extra };
}

/** A healthy, existing, active, non-contract account. Override per test. */
export function facts(over: Partial<AccountFacts> = {}): AccountFacts {
  return {
    accountId: 'bob.testnet',
    network: 'testnet',
    kind: 'named',
    exists: true,
    balanceYocto: '10000000000000000000000000',
    balanceNear: '10',
    isContract: false,
    codeHash: '11111111111111111111111111111111',
    storageUsage: 300,
    keys: { total: 1, fullAccess: 1, functionCall: 0 },
    createdAt: new Date(NOW - 400 * DAY).toISOString(),
    recentTxCount: 25,
    lastActiveAt: new Date(NOW - 1 * DAY).toISOString(),
    priorInteractions: null,
    senderBalanceYocto: null,
    explorerUrl: 'https://testnet.nearblocks.io/address/bob.testnet',
    errors: [],
    ...over,
  };
}

export const ids = (r: { reasons: Array<{ id: string }> }) => r.reasons.map((x) => x.id);
