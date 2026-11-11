/**
 * Lookalike / impersonation detection for NEAR account names.
 * Reuses scam-shield-core's `skeleton` (confusables + digit→letter folding)
 * and `levenshtein`, applied to account labels instead of domains.
 */
import { BRANDS as SCAM_SHIELD_BRANDS, levenshtein, skeleton } from './scamShield.js';
import type { KnownPayee, Network } from './types.js';

export interface NearBrand {
  id: string;
  name: string;
  /** Distinctive tokens (lowercase, no separators). Tokens < 4 chars only match exactly. */
  tokens: string[];
  /** Accounts that legitimately belong to the brand (best effort; verify before production). */
  official: string[];
}

/** Exchanges, NEAR ecosystem names and LATAM financial brands commonly impersonated. */
export const NEAR_BRANDS: NearBrand[] = [
  { id: 'binance', name: 'Binance', tokens: ['binance'], official: [] },
  { id: 'coinbase', name: 'Coinbase', tokens: ['coinbase'], official: [] },
  { id: 'kraken', name: 'Kraken', tokens: ['kraken'], official: [] },
  { id: 'okx', name: 'OKX', tokens: ['okx'], official: [] },
  { id: 'bybit', name: 'Bybit', tokens: ['bybit'], official: [] },
  { id: 'kucoin', name: 'KuCoin', tokens: ['kucoin'], official: [] },
  { id: 'bitget', name: 'Bitget', tokens: ['bitget'], official: [] },
  { id: 'airtm', name: 'AirTM', tokens: ['airtm'], official: [] },
  { id: 'tether', name: 'Tether / USDT', tokens: ['tether', 'usdt'], official: ['usdt.tether-token.near'] },
  { id: 'ref', name: 'Ref Finance', tokens: ['reffinance'], official: ['v2.ref-finance.near', 'ref-finance-101.testnet', 'ref-finance.near'] },
  { id: 'wnear', name: 'Wrapped NEAR', tokens: ['wrapnear'], official: ['wrap.near', 'wrap.testnet'] },
  { id: 'mynearwallet', name: 'MyNearWallet', tokens: ['mynearwallet'], official: [] },
  { id: 'meteor', name: 'Meteor Wallet', tokens: ['meteorwallet'], official: [] },
  { id: 'nearblocks', name: 'NearBlocks', tokens: ['nearblocks'], official: [] },
  { id: 'nearfoundation', name: 'NEAR Foundation', tokens: ['nearfoundation', 'nearsupport', 'nearsoporte'], official: [] },
  { id: 'sweat', name: 'Sweat Economy', tokens: ['sweatcoin', 'sweateconomy'], official: [] },
  { id: 'financilab', name: 'FinanciLab', tokens: ['financilab'], official: [] },
  // LATAM banks / remittances / payment platforms from scam-shield-core.
  ...SCAM_SHIELD_BRANDS.map((b) => ({ id: b.id, name: b.name, tokens: b.tokens, official: [] as string[] })),
];

export interface LookalikeHit {
  kind: 'brand_name' | 'brand_lookalike' | 'contact_lookalike';
  target: string;
  targetName: string;
  matchedPart: string;
  distance: number;
}

const SUFFIXES = ['.testnet', '.near'];

/** Account name without the network top-level suffix. */
export function stripSuffix(id: string): string {
  for (const s of SUFFIXES) if (id.endsWith(s)) return id.slice(0, -s.length);
  return id;
}

function parts(name: string): { raw: string; sk: string }[] {
  const out = new Map<string, string>();
  const labels = name.split('.');
  for (const label of labels) {
    out.set(label.replace(/[-_]/g, ''), skeleton(label.replace(/[-_]/g, '')));
    for (const p of label.split(/[-_]/)) if (p) out.set(p, skeleton(p));
  }
  const whole = name.replace(/[-_.]/g, '');
  out.set(whole, skeleton(whole));
  return [...out].map(([raw, sk]) => ({ raw, sk }));
}

/** Compare an account against impersonated brands. Returns the strongest hit. */
export function detectBrandLookalike(accountId: string): LookalikeHit | null {
  if (/^[0-9a-f]{64}$/.test(accountId) || /^0x[0-9a-f]{40}$/.test(accountId)) return null;
  if (NEAR_BRANDS.some((b) => b.official.includes(accountId))) return null;
  const name = stripSuffix(accountId);
  const ps = parts(name);
  let best: LookalikeHit | null = null;
  for (const brand of NEAR_BRANDS) {
    if (brand.official.includes(accountId)) continue;
    for (const token of brand.tokens) {
      for (const { raw, sk } of ps) {
        let hit: LookalikeHit | null = null;
        if (raw === token) {
          hit = { kind: 'brand_name', target: brand.id, targetName: brand.name, matchedPart: raw, distance: 0 };
        } else if (token.length >= 4) {
          if (sk === token || (sk.includes(token) && !raw.includes(token))) {
            hit = { kind: 'brand_lookalike', target: brand.id, targetName: brand.name, matchedPart: raw, distance: levenshtein(raw, token) };
          } else if (raw.includes(token)) {
            hit = { kind: 'brand_name', target: brand.id, targetName: brand.name, matchedPart: raw, distance: 0 };
          } else if (sk.length >= 4 && sk[0] === token[0] && Math.abs(sk.length - token.length) <= 1) {
            // Same first letter keeps dictionary words out ("finance" is not "binance").
            const d = levenshtein(sk, token);
            const max = token.length >= 7 ? 2 : 1;
            if (d > 0 && d <= max) {
              hit = { kind: 'brand_lookalike', target: brand.id, targetName: brand.name, matchedPart: raw, distance: d };
            }
          }
        }
        if (hit && (!best || (best.kind === 'brand_name' && hit.kind === 'brand_lookalike'))) best = hit;
      }
    }
  }
  return best;
}

/**
 * Address-poisoning / typo check against the user's own contacts:
 * `a1ice.testnet` vs `alice.testnet`, or an implicit account sharing the first
 * and last characters of a known implicit payee.
 */
export function detectContactLookalike(accountId: string, payees: KnownPayee[], network: Network): LookalikeHit | null {
  for (const p of payees) {
    if (p.network !== 'any' && p.network !== network) continue;
    const c = p.accountId;
    if (c === accountId) return null;
  }
  for (const p of payees) {
    if (p.network !== 'any' && p.network !== network) continue;
    const c = p.accountId;
    const implicit = (s: string) => /^[0-9a-f]{64}$/.test(s) || /^0x[0-9a-f]{40}$/.test(s);
    if (implicit(c) && implicit(accountId)) {
      if (c.slice(0, 4) === accountId.slice(0, 4) && c.slice(-4) === accountId.slice(-4)) {
        return { kind: 'contact_lookalike', target: c, targetName: p.label, matchedPart: accountId, distance: levenshtein(c, accountId) };
      }
      continue;
    }
    const a = stripSuffix(accountId);
    const b = stripSuffix(c);
    if (b.length < 4) continue;
    const sameSkeleton = skeleton(a) === skeleton(b);
    const d = levenshtein(a, b);
    const max = b.length >= 8 ? 2 : 1;
    if (sameSkeleton || d <= max) {
      return { kind: 'contact_lookalike', target: c, targetName: p.label, matchedPart: accountId, distance: d };
    }
  }
  return null;
}
