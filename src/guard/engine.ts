/**
 * Decision engine: combines signals into allow | needs_human | deny + 0-100 score.
 *
 *   deny         if any hard-deny signal, or score >= 70
 *   needs_human  if any human-required signal, or score >= 30
 *   allow        otherwise
 */
import { collectFacts, type FactsOptions } from './facts.js';
import type { IndexerClient } from './indexer.js';
import { classifyAccountId, explorerUrl, normalizeAccountId, parseNearToYocto, yoctoToNearNumber } from './near.js';
import { resolvePolicy } from './policy.js';
import type { RpcClient } from './rpc.js';
import { draftSafeReply, effectiveCategory, type AnalysisResult } from './scamShield.js';
import { evaluateSignals } from './signals.js';
import type {
  AccountFacts,
  Bilingual,
  CheckInput,
  Decision,
  FetchLike,
  GuardPolicy,
  GuardResult,
  GuardSignal,
  Network,
  ScamCheckSummary,
} from './types.js';

export const ENGINE_VERSION = '0.1.0';
export const DECISION_THRESHOLDS = { deny: 70, needsHuman: 30 } as const;

/** Noisy-OR of positive weights, minus trust weights; clamped to 0-100. */
export function combineScore(signals: Pick<GuardSignal, 'weight' | 'effect'>[]): number {
  let keep = 1;
  let neg = 0;
  for (const s of signals) {
    if (s.effect === 'info') continue;
    if (s.weight > 0) keep *= 1 - Math.min(s.weight, 99) / 100;
    else neg += s.weight;
  }
  return Math.max(0, Math.min(100, Math.round(100 * (1 - keep) + neg)));
}

export function decide(signals: GuardSignal[]): { decision: Decision; riskScore: number } {
  const raw = combineScore(signals);
  if (signals.some((s) => s.effect === 'deny') || raw >= DECISION_THRESHOLDS.deny) {
    return { decision: 'deny', riskScore: Math.max(raw, DECISION_THRESHOLDS.deny) };
  }
  if (signals.some((s) => s.effect === 'needs_human') || raw >= DECISION_THRESHOLDS.needsHuman) {
    return { decision: 'needs_human', riskScore: Math.min(Math.max(raw, DECISION_THRESHOLDS.needsHuman), DECISION_THRESHOLDS.deny - 1) };
  }
  return { decision: 'allow', riskScore: Math.min(raw, DECISION_THRESHOLDS.needsHuman - 1) };
}

const EFFECT_RANK: Record<GuardSignal['effect'], number> = { deny: 4, needs_human: 3, risk: 2, trust: 1, info: 0 };

/** Most important first: hard denies, then human-required, then by weight. */
export function rankSignals(signals: GuardSignal[]): GuardSignal[] {
  return [...signals].sort((a, b) => EFFECT_RANK[b.effect] - EFFECT_RANK[a.effect] || b.weight - a.weight);
}

function summarize(decision: Decision, amount: string, receiver: string, top?: GuardSignal): Bilingual {
  const why = (s: string) => (top ? ` ${s}` : '');
  switch (decision) {
    case 'deny':
      return {
        es: `BLOQUEAR: no envíe ${amount} NEAR a ${receiver}.${why(`Motivo principal: ${top?.es ?? ''}`)}`,
        en: `DENY: do not send ${amount} NEAR to ${receiver}.${why(`Main reason: ${top?.en ?? ''}`)}`,
      };
    case 'needs_human':
      return {
        es: `REVISIÓN HUMANA: confirme por otro canal antes de enviar ${amount} NEAR a ${receiver}.${why(`Motivo principal: ${top?.es ?? ''}`)}`,
        en: `HUMAN REVIEW: confirm through another channel before sending ${amount} NEAR to ${receiver}.${why(`Main reason: ${top?.en ?? ''}`)}`,
      };
    default:
      return {
        es: `PERMITIR: no encontramos señales de riesgo relevantes para enviar ${amount} NEAR a ${receiver}.`,
        en: `ALLOW: no relevant risk signals found for sending ${amount} NEAR to ${receiver}.`,
      };
  }
}

function adviceFor(decision: Decision, messageScan?: AnalysisResult): Bilingual {
  if (messageScan && messageScan.verdict !== 'safe' && decision !== 'allow' && effectiveCategory(messageScan) !== 'none') {
    return { es: messageScan.adviceEs, en: messageScan.adviceEn };
  }
  if (decision === 'deny') {
    return {
      es: 'No envíe el pago. Si alguien le presiona o le pide urgencia, corte la comunicación y verifique por un canal oficial que usted mismo busque. Las transferencias en NEAR no se pueden revertir.',
      en: 'Do not send the payment. If someone pressures you or demands urgency, stop and verify through an official channel you look up yourself. NEAR transfers cannot be reversed.',
    };
  }
  if (decision === 'needs_human') {
    return {
      es: 'Antes de aprobar, confirme la cuenta destino y el monto con la persona por llamada o en persona (no por el mismo chat). Revise el nombre de la cuenta carácter por carácter.',
      en: 'Before approving, confirm the receiver and amount with the person by phone or in person (not in the same chat). Check the account name character by character.',
    };
  }
  return {
    es: 'Puede continuar. Aun así, revise que la cuenta destino sea exactamente la correcta: los pagos en NEAR no se pueden revertir.',
    en: 'You can proceed. Still, double-check the receiver is exactly right: NEAR payments cannot be reversed.',
  };
}

function safeReplyFor(decision: Decision, messageScan?: AnalysisResult): Bilingual {
  const cat = messageScan ? effectiveCategory(messageScan) : 'none';
  if (messageScan && messageScan.verdict !== 'safe' && cat !== 'none') {
    return { es: draftSafeReply(cat, 'es'), en: draftSafeReply(cat, 'en') };
  }
  if (decision === 'allow') return { es: draftSafeReply('none', 'es'), en: draftSafeReply('none', 'en') };
  return {
    es: 'Antes de enviar cualquier pago lo voy a verificar por mi cuenta en un canal oficial. No envío fondos solo por un mensaje.',
    en: 'Before sending any payment I will verify it myself through an official channel. I do not send funds based only on a message.',
  };
}

const scamSummary = (r?: AnalysisResult): ScamCheckSummary | undefined =>
  r && { verdict: r.verdict, riskScore: r.riskScore, category: effectiveCategory(r), explanationEs: r.explanationEs, explanationEn: r.explanationEn };

export interface NormalizedRequest {
  network: Network;
  sender?: string;
  receiver: string;
  amountNear: string;
  amountYocto: string | null;
  amount: number;
  memo: string;
  message: string;
}

export function normalizeRequest(input: CheckInput): NormalizedRequest {
  const network: Network = input.network === 'mainnet' ? 'mainnet' : 'testnet';
  const receiver = normalizeAccountId(input.receiver ?? '');
  const sender = input.sender ? normalizeAccountId(input.sender) || undefined : undefined;
  const amountNear = String(input.amountNear ?? '').trim().replace(',', '.');
  const amountYocto = parseNearToYocto(amountNear);
  return {
    network,
    sender,
    receiver,
    amountNear,
    amountYocto,
    amount: amountYocto ? yoctoToNearNumber(amountYocto) : NaN,
    memo: String(input.memo ?? '').slice(0, 2000),
    message: String(input.message ?? '').slice(0, 8000),
  };
}

/** Pure evaluation: request + facts + policy → result. Deterministic for a given `nowMs`. */
export function evaluatePayment(
  input: CheckInput,
  facts: AccountFacts,
  policyIn?: Partial<GuardPolicy>,
  nowMs: number = Date.now(),
): GuardResult {
  const req = normalizeRequest(input);
  const policy = resolvePolicy(policyIn);
  const ev = evaluateSignals({
    network: req.network,
    sender: req.sender,
    receiver: req.receiver,
    amount: req.amount,
    amountValid: req.amountYocto !== null,
    memo: req.memo,
    message: req.message,
    facts,
    policy,
    nowMs,
  });
  const reasons = rankSignals(ev.signals);
  const { decision, riskScore } = decide(reasons);
  const top = reasons.find((r) => r.effect !== 'trust' && r.effect !== 'info' && r.weight > 0);
  return {
    decision,
    riskScore,
    reasons,
    summary: summarize(decision, req.amountNear || '?', req.receiver || '?', top),
    advice: adviceFor(decision, ev.messageScan),
    safeReply: safeReplyFor(decision, ev.messageScan),
    facts,
    scamCheck: { message: scamSummary(ev.messageScan), memo: scamSummary(ev.memoScan) },
    request: {
      network: req.network,
      ...(req.sender ? { sender: req.sender } : {}),
      receiver: req.receiver,
      amountNear: req.amountNear,
      amountYocto: req.amountYocto,
      ...(req.memo ? { memo: req.memo } : {}),
      ...(req.message ? { message: req.message } : {}),
    },
    checkedAt: new Date(nowMs).toISOString(),
    engineVersion: ENGINE_VERSION,
  };
}

export interface CheckOptions {
  fetch?: FetchLike;
  policy?: Partial<GuardPolicy>;
  nowMs?: number;
  rpc?: RpcClient;
  indexer?: IndexerClient;
  skipIndexer?: boolean;
  rpcTimeoutMs?: number;
  indexerTimeoutMs?: number;
}

/** Full check: read-only NEAR lookups + pure evaluation. Never throws on network errors. */
export async function checkPayment(input: CheckInput, opts: CheckOptions = {}): Promise<GuardResult> {
  const req = normalizeRequest(input);
  let facts: AccountFacts;
  if (classifyAccountId(req.receiver) === 'invalid') {
    facts = { accountId: req.receiver, network: req.network, kind: 'invalid', exists: null, explorerUrl: explorerUrl(req.network, req.receiver), errors: [] };
  } else {
    const fo: FactsOptions = {
      network: req.network,
      fetch: opts.fetch,
      rpc: opts.rpc,
      indexer: opts.indexer,
      skipIndexer: opts.skipIndexer,
      rpcTimeoutMs: opts.rpcTimeoutMs,
      indexerTimeoutMs: opts.indexerTimeoutMs,
    };
    facts = await collectFacts(req.receiver, req.sender, fo);
  }
  return evaluatePayment(input, facts, opts.policy, opts.nowMs ?? Date.now());
}
