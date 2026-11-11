/**
 * guardedTransfer: the only path an agent has to "send" NEAR.
 *
 *   deny         → the signer is never called; status "refused"
 *   needs_human  → waits for an explicit human approval callback; without it, status "awaiting_human"
 *   allow        → the dry-run signer prepares an unsigned transfer; status "prepared"
 */
import { checkPayment, type CheckOptions } from '../guard/engine.js';
import type { Bilingual, CheckInput, GuardResult } from '../guard/types.js';
import type { TransferSigner, UnsignedTransfer } from './signer.js';

export type WrapperStatus = 'refused' | 'awaiting_human' | 'rejected_by_human' | 'prepared';

export interface GuardedTransferResult {
  status: WrapperStatus;
  guard: GuardResult;
  unsignedTransfer: UnsignedTransfer | null;
  /** Human-readable explanation of what the wrapper did. */
  action: Bilingual;
  log: Array<{ at: string; event: string; detail?: string }>;
}

export interface GuardedTransferOptions extends CheckOptions {
  signer: TransferSigner;
  /**
   * Called only when the guard says `needs_human`. Must reflect an explicit
   * human decision (UI button, chat confirmation). Never let the agent answer it.
   */
  requestHumanApproval?: (guard: GuardResult) => Promise<boolean>;
  /** Optional precomputed guard result (e.g. from the HTTP API). */
  guardResult?: GuardResult;
  clock?: () => Date;
}

export const WRAPPER_ACTIONS: Record<WrapperStatus, Bilingual> = {
  refused: { es: 'Firma rechazada: el guardián bloqueó el pago. No se preparó ninguna transacción.', en: 'Signing refused: the guard denied the payment. No transaction was prepared.' },
  awaiting_human: { es: 'Esperando aprobación humana. No se preparó ninguna transacción todavía.', en: 'Waiting for human approval. No transaction has been prepared yet.' },
  rejected_by_human: { es: 'La persona rechazó el pago. No se preparó ninguna transacción.', en: 'The human rejected the payment. No transaction was prepared.' },
  prepared: { es: 'Transacción sin firmar preparada (dry-run). Nada fue firmado ni enviado a la red.', en: 'Unsigned transaction prepared (dry-run). Nothing was signed or broadcast.' },
};

export async function guardedTransfer(input: CheckInput, opts: GuardedTransferOptions): Promise<GuardedTransferResult> {
  const clock = opts.clock ?? (() => new Date());
  const log: GuardedTransferResult['log'] = [];
  const note = (event: string, detail?: string) => log.push({ at: clock().toISOString(), event, ...(detail ? { detail } : {}) });

  note('guard.check', `${input.amountNear} NEAR → ${input.receiver} (${input.network ?? 'testnet'})`);
  const guard = opts.guardResult ?? (await checkPayment(input, opts));
  note('guard.result', `${guard.decision} (risk ${guard.riskScore}/100): ${guard.reasons.filter((r) => r.weight > 0).map((r) => r.id).join(', ') || 'no risk signals'}`);

  const finish = (status: WrapperStatus, tx: UnsignedTransfer | null): GuardedTransferResult => {
    note(`wrapper.${status}`, WRAPPER_ACTIONS[status].en);
    return { status, guard, unsignedTransfer: tx, action: WRAPPER_ACTIONS[status], log };
  };

  if (guard.decision === 'deny') return finish('refused', null);

  let approvedByHuman = false;
  if (guard.decision === 'needs_human') {
    if (!opts.requestHumanApproval) return finish('awaiting_human', null);
    note('human.approval_requested', guard.summary.en);
    const ok = await opts.requestHumanApproval(guard);
    note('human.approval_response', ok ? 'approved' : 'rejected');
    if (!ok) return finish('rejected_by_human', null);
    approvedByHuman = true;
  }

  if (!guard.request.amountYocto) return finish('refused', null); // defensive; invalid amounts are denied anyway
  const tx = opts.signer.prepareTransfer({
    network: guard.request.network,
    signerId: guard.request.sender,
    receiverId: guard.request.receiver,
    amountYocto: guard.request.amountYocto,
    amountNear: guard.request.amountNear,
    memo: guard.request.memo,
    guard: { decision: guard.decision, riskScore: guard.riskScore, checkedAt: guard.checkedAt, approvedByHuman },
  });
  return finish('prepared', tx);
}
