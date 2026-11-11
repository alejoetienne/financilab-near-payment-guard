/**
 * DRY-RUN signer. It only builds an *unsigned* description of a NEAR transfer.
 *
 * There is no key material anywhere in this project: no private key is loaded,
 * read, generated or accepted; nothing is signed; nothing is broadcast.
 * See README → "Production design" for how a real deployment would sign with a
 * function-call key scoped to a guarded vault contract.
 */

export interface UnsignedTransfer {
  /** Always true: this object is a description, not a signed transaction. */
  dryRun: true;
  signed: false;
  broadcast: false;
  network: 'testnet' | 'mainnet';
  signerId: string | null;
  receiverId: string;
  actions: Array<{ type: 'Transfer'; deposit: string; depositNear: string }>;
  /** App-level note. NEAR `Transfer` actions carry no memo on-chain. */
  memo?: string;
  /** Guard verdict this transfer was prepared under. */
  guard: { decision: string; riskScore: number; checkedAt: string; approvedByHuman: boolean };
  note: string;
}

export interface TransferSigner {
  readonly kind: 'dry-run';
  prepareTransfer(args: {
    network: 'testnet' | 'mainnet';
    signerId?: string;
    receiverId: string;
    amountYocto: string;
    amountNear: string;
    memo?: string;
    guard: UnsignedTransfer['guard'];
  }): UnsignedTransfer;
}

export class DryRunSigner implements TransferSigner {
  readonly kind = 'dry-run' as const;
  /** Every transfer this signer was asked to prepare (for audits and tests). */
  readonly prepared: UnsignedTransfer[] = [];

  prepareTransfer(args: Parameters<TransferSigner['prepareTransfer']>[0]): UnsignedTransfer {
    const tx: UnsignedTransfer = {
      dryRun: true,
      signed: false,
      broadcast: false,
      network: args.network,
      signerId: args.signerId ?? null,
      receiverId: args.receiverId,
      actions: [{ type: 'Transfer', deposit: args.amountYocto, depositNear: args.amountNear }],
      ...(args.memo ? { memo: args.memo } : {}),
      guard: args.guard,
      note: 'DRY-RUN: unsigned transfer description. Not signed, not broadcast. Hand it to a wallet (or a guarded vault contract) for the human to sign.',
    };
    this.prepared.push(tx);
    return tx;
  }
}
