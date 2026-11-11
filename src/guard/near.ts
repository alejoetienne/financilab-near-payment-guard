/** NEAR account-id and amount helpers (pure, no network). */
import type { AccountKind, Network } from './types.js';

const NAMED_RE = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT_RE = /^[0-9a-f]{64}$/;
const ETH_IMPLICIT_RE = /^0x[0-9a-f]{40}$/;

/** Trim and lowercase user input (NEAR account ids are always lowercase). */
export function normalizeAccountId(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}

/**
 * Classify an account id per NEAR rules
 * (https://docs.near.org/protocol/account-id): 2-64 chars, lowercase
 * alphanumerics separated by `-`, `_` or `.`.
 */
export function classifyAccountId(id: string): AccountKind {
  if (IMPLICIT_RE.test(id)) return 'implicit';
  if (ETH_IMPLICIT_RE.test(id)) return 'eth_implicit';
  if (id.length < 2 || id.length > 64) return 'invalid';
  return NAMED_RE.test(id) ? 'named' : 'invalid';
}

/** Network an account id suffix implies, if any (".near" → mainnet, ".testnet" → testnet). */
export function impliedNetwork(id: string): Network | null {
  if (id.endsWith('.testnet') || id === 'testnet') return 'testnet';
  if (id.endsWith('.near') || id === 'near') return 'mainnet';
  return null;
}

export function explorerUrl(network: Network, accountId: string): string {
  const host = network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  return `${host}/address/${encodeURIComponent(accountId)}`;
}

export const YOCTO_DECIMALS = 24;

/**
 * Parse a NEAR amount ("1.5", 2, "0,25") into yoctoNEAR as a decimal string.
 * Returns null for invalid, negative or over-precise values. Uses BigInt, no floats.
 */
export function parseNearToYocto(amount: string | number): string | null {
  let s = typeof amount === 'number' ? (Number.isFinite(amount) ? amount.toString() : '') : String(amount ?? '');
  s = s.trim().replace(',', '.');
  if (/e/i.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    s = n.toFixed(YOCTO_DECIMALS).replace(/\.?0+$/, '');
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? '';
  if (frac.length > YOCTO_DECIMALS) return null;
  const yocto = BigInt(whole) * 10n ** 24n + BigInt((frac + '0'.repeat(YOCTO_DECIMALS)).slice(0, YOCTO_DECIMALS) || '0');
  return yocto.toString();
}

/** Format yoctoNEAR as a human NEAR string with up to `maxDecimals` decimals. */
export function formatYoctoToNear(yocto: string | bigint, maxDecimals = 4): string {
  const v = typeof yocto === 'bigint' ? yocto : BigInt(yocto);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / 10n ** 24n;
  const frac = (abs % 10n ** 24n).toString().padStart(YOCTO_DECIMALS, '0').slice(0, maxDecimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole.toString()}${frac ? '.' + frac : ''}`;
}

/** yocto string → float NEAR (only for comparisons against policy limits, never for transfers). */
export function yoctoToNearNumber(yocto: string): number {
  return Number(BigInt(yocto) / 10n ** 18n) / 1e6;
}

export const EMPTY_CODE_HASH = '11111111111111111111111111111111';

/** Extract NEAR-looking account ids mentioned in free text. */
export function extractAccountIds(text: string): string[] {
  const out = new Set<string>();
  const re = /\b([a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)*\.(?:testnet|near))\b|\b([0-9a-f]{64})\b|\b(0x[0-9a-f]{40})\b/gi;
  for (const m of (text ?? '').matchAll(re)) out.add((m[1] ?? m[2] ?? m[3] ?? '').toLowerCase());
  out.delete('');
  return [...out];
}

/** Extract amounts written as "40 NEAR", "Ⓝ 2.5", "2,5 near" from free text. */
export function extractNearAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /(?:(\d+(?:[.,]\d+)?)\s*(?:near\b|Ⓝ))|(?:Ⓝ\s*(\d+(?:[.,]\d+)?))/gi;
  for (const m of (text ?? '').matchAll(re)) {
    const n = Number((m[1] ?? m[2] ?? '').replace(',', '.'));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
