/** Shared types for FinanciLab Payment Guard. */

export type Network = 'testnet' | 'mainnet';
export type Decision = 'allow' | 'needs_human' | 'deny';

/**
 * How a signal influences the decision:
 * - `risk`: only adds its weight to the score.
 * - `needs_human`: forces at least `needs_human`, regardless of score.
 * - `deny`: forces `deny` (hard rule).
 * - `trust`: negative weight, lowers the score (known payee, prior interactions).
 * - `info`: shown to the user, no effect.
 */
export type Effect = 'risk' | 'needs_human' | 'deny' | 'trust' | 'info';
export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Bilingual {
  es: string;
  en: string;
}

export interface GuardSignal extends Bilingual {
  id: string;
  /** 0-99 raises risk (noisy-OR), negative lowers it. */
  weight: number;
  effect: Effect;
  severity: Severity;
  evidence?: Record<string, unknown>;
}

/** Minimal fetch signature so callers (tests, Node, browsers) can inject their own. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface CheckInput {
  network?: Network;
  /** Account that would sign/send the transfer (optional). */
  sender?: string;
  /** Receiver NEAR account id. */
  receiver: string;
  /** Amount in NEAR, as a decimal string or number (e.g. "1.5"). */
  amountNear: string | number;
  /** Memo attached to the payment request (NEAR transfers have no native memo; this is the app-level note). */
  memo?: string;
  /** Message that triggered the payment: WhatsApp/SMS text, email, or the chat instruction given to the agent. */
  message?: string;
}

export type AccountKind = 'named' | 'implicit' | 'eth_implicit' | 'invalid';

export interface KeySummary {
  total: number;
  fullAccess: number;
  functionCall: number;
}

/** Everything we learned about the receiver from read-only NEAR RPC + indexer. */
export interface AccountFacts {
  accountId: string;
  network: Network;
  kind: AccountKind;
  /** true/false when RPC answered; null when RPC was unavailable. */
  exists: boolean | null;
  balanceYocto?: string;
  balanceNear?: string;
  isContract?: boolean;
  codeHash?: string;
  storageUsage?: number;
  keys?: KeySummary | null;
  /** ISO timestamp of account creation, when the indexer knows it. */
  createdAt?: string | null;
  /** Number of recent transactions returned by the indexer (capped by `limit`), null if unavailable. */
  recentTxCount?: number | null;
  lastActiveAt?: string | null;
  /** Transactions between sender and receiver found in recent history; null if unknown. */
  priorInteractions?: number | null;
  /** Sender balance (yocto) if a sender was provided and RPC answered. */
  senderBalanceYocto?: string | null;
  explorerUrl: string;
  rpcEndpoint?: string;
  /** Data-source problems (timeouts, HTTP errors). Never fatal. */
  errors: string[];
}

export interface DenylistEntry {
  accountId: string;
  /** Reason in English. */
  reason: string;
  /** Reason in Spanish (falls back to `reason`). */
  reasonEs?: string;
  evidence: string;
  reportedBy: string;
  network: Network | 'any';
}

export interface KnownPayee {
  accountId: string;
  label: string;
  network: Network | 'any';
}

export interface GuardPolicy {
  /** Transfers up to this amount can be auto-approved (if nothing else is wrong). */
  autoApproveNear: number;
  /** Transfers above this amount are always denied. */
  hardCapNear: number;
  /** Max total per day (with `spentTodayNear`). */
  dailyCapNear: number;
  /** Already spent today (provided by the caller / wallet ledger). */
  spentTodayNear: number;
  /** First-time payee above this amount → human review. */
  firstPayeeThresholdNear: number;
  /** Account younger than this is "new". */
  newAccountDays: number;
  /** Fewer recent txns than this is "low activity". */
  lowActivityTxCount: number;
  /** Last activity older than this is "dormant". */
  dormantDays: number;
  denylist: DenylistEntry[];
  knownPayees: KnownPayee[];
}

export interface ScamCheckSummary {
  verdict: 'safe' | 'suspicious' | 'scam';
  riskScore: number;
  category: string;
  explanationEs: string;
  explanationEn: string;
}

export interface GuardResult {
  decision: Decision;
  riskScore: number;
  reasons: GuardSignal[];
  summary: Bilingual;
  /** Advice for the human, plus a safe reply they can send back to the requester. */
  advice: Bilingual;
  safeReply: Bilingual;
  facts: AccountFacts;
  scamCheck: { message?: ScamCheckSummary; memo?: ScamCheckSummary };
  request: {
    network: Network;
    sender?: string;
    receiver: string;
    amountNear: string;
    amountYocto: string | null;
    memo?: string;
    message?: string;
  };
  checkedAt: string;
  engineVersion: string;
}
