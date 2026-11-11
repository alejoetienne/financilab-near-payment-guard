/** Default policy + demo lists (denylist, known payees). */
import denylistData from '../../data/denylist.json' with { type: 'json' };
import payeesData from '../../data/known-payees.json' with { type: 'json' };
import type { DenylistEntry, GuardPolicy, KnownPayee, Network } from './types.js';

export const DEMO_DENYLIST: DenylistEntry[] = (denylistData.entries as DenylistEntry[]).map((e) => ({ ...e }));
export const DEMO_KNOWN_PAYEES: KnownPayee[] = (payeesData.entries as KnownPayee[]).map((e) => ({ ...e }));

export const DEFAULT_POLICY: GuardPolicy = {
  autoApproveNear: 5,
  hardCapNear: 50,
  dailyCapNear: 50,
  spentTodayNear: 0,
  firstPayeeThresholdNear: 1,
  newAccountDays: 7,
  lowActivityTxCount: 3,
  dormantDays: 180,
  denylist: DEMO_DENYLIST,
  knownPayees: DEMO_KNOWN_PAYEES,
};

/** Merge a partial policy over the defaults (lists are replaced, not merged, when given). */
export function resolvePolicy(partial?: Partial<GuardPolicy>): GuardPolicy {
  const p: GuardPolicy = { ...DEFAULT_POLICY, ...(partial ?? {}) };
  for (const k of ['autoApproveNear', 'hardCapNear', 'dailyCapNear', 'spentTodayNear', 'firstPayeeThresholdNear'] as const) {
    const v = Number(p[k]);
    p[k] = Number.isFinite(v) && v >= 0 ? v : DEFAULT_POLICY[k];
  }
  return p;
}

export function findDenylisted(accountId: string, network: Network, list: DenylistEntry[]): DenylistEntry | undefined {
  return list.find((e) => e.accountId === accountId && (e.network === 'any' || e.network === network));
}

export function findKnownPayee(accountId: string, network: Network, list: KnownPayee[]): KnownPayee | undefined {
  return list.find((e) => e.accountId === accountId && (e.network === 'any' || e.network === network));
}
