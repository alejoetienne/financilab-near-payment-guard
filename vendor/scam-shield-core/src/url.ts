import { BRANDS, type Brand } from './brands.js';
import { levenshtein } from './normalize.js';
import { hostnameToUnicode } from './punycode.js';

export const RISKY_TLDS = new Set([
  'xyz', 'top', 'club', 'online', 'site', 'icu', 'buzz', 'live', 'click', 'link', 'rest',
  'monster', 'shop', 'tk', 'ml', 'ga', 'cf', 'gq', 'work', 'support', 'cyou', 'sbs', 'cfd',
  'win', 'bid', 'loan', 'vip', 'pw', 'su', 'country', 'stream', 'download', 'review', 'zip',
  'mov', 'quest', 'lol', 'today', 'fun', 'space', 'website', 'host', 'cam', 'beauty', 'hair',
]);

export const SHORTENERS = new Set([
  'bit.ly', 'tinyurl.com', 'cutt.ly', 'is.gd', 'ow.ly', 'rb.gy', 'shorturl.at', 'goo.gl',
  'tiny.cc', 's.id', 'acortar.link', 'bit.do', 'rebrand.ly', 't.ly', 'v.gd', 'shorturl.com',
  'bl.ink', 'lnkd.in', 'buff.ly', 'qrco.de', 'tny.im', 'urlz.fr', 'shrtco.de', 'u.to', 'x.gd',
]);

const KNOWN_TLDS = new Set([
  ...RISKY_TLDS,
  'com', 'net', 'org', 'ni', 'info', 'biz', 'app', 'io', 'co', 'me', 'ly', 'gy', 'at', 'id',
  'us', 'cc', 'to', 'do', 'gl', 'tv', 'es', 'mx', 'gt', 'hn', 'sv', 'cr', 'pa', 've', 'ar',
  'cl', 'pe', 'ec', 'bo', 'py', 'uy', 'br', 'page', 'dev', 'cloud', 'ru', 'cn', 'ws', 'asia',
  'mobi', 'store', 'lat', 'gob', 'edu', 'in', 'im', 'de', 'fr', 'uk', 'ai', 'gd', 'eu', 'tech',
  'services', 'digital', 'center', 'help', 'security', 'pro', 'one', 'global', 'world', 'news',
]);

const TWO_LEVEL_SUFFIXES = new Set([
  'com.ni', 'gob.ni', 'org.ni', 'net.ni', 'edu.ni', 'com.mx', 'com.gt', 'com.hn', 'com.sv',
  'co.cr', 'fi.cr', 'com.pa', 'com.co', 'com.ar', 'com.br', 'co.uk', 'com.pe', 'com.ve',
  'com.do', 'com.ec', 'com.bo', 'com.py', 'com.uy', 'com.es',
]);

export interface ParsedUrl {
  raw: string;
  /** Hostname as written (lowercased), may contain Unicode or xn-- labels. */
  host: string;
  /** Hostname converted to Unicode (punycode decoded). */
  unicodeHost: string;
  scheme: 'http' | 'https' | 'none';
  hasUserInfo: boolean;
  isIp: boolean;
  tld: string;
  /** Registrable domain, e.g. "banpro.com.ni". */
  registrable: string;
  isIdn: boolean;
  path: string;
}

const TRAILING_PUNCT = /[)\]}>,.;:!?"'»”’]+$/;
const LEADING_PUNCT = /^[(\[{<"'«“‘¿¡]+/;

export function parseUrl(rawInput: string): ParsedUrl | null {
  let raw = rawInput.trim().replace(LEADING_PUNCT, '').replace(TRAILING_PUNCT, '');
  if (!raw) return null;
  let scheme: ParsedUrl['scheme'] = 'none';
  const m = /^(https?):\/\//i.exec(raw);
  let rest = raw;
  if (m) {
    scheme = m[1]!.toLowerCase() as 'http' | 'https';
    rest = raw.slice(m[0].length);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    return null; // other schemes (ftp, intent, etc.) are not handled
  }
  const cut = rest.search(/[/?#]/);
  let authority = cut === -1 ? rest : rest.slice(0, cut);
  const path = cut === -1 ? '' : rest.slice(cut);
  let hasUserInfo = false;
  if (authority.includes('@')) {
    hasUserInfo = true;
    authority = authority.slice(authority.lastIndexOf('@') + 1);
  }
  let host = authority.replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (!host) return null;
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const isIpv6 = host.includes(':');
  const isIp = isIpv4 || isIpv6;
  const labels = host.split('.');
  if (!isIp && labels.length < 2) return null;
  const tld = isIp ? '' : labels[labels.length - 1]!;
  const lastTwo = labels.slice(-2).join('.');
  const registrable = isIp
    ? host
    : TWO_LEVEL_SUFFIXES.has(lastTwo) && labels.length >= 3
      ? labels.slice(-3).join('.')
      : lastTwo;
  const unicodeHost = hostnameToUnicode(host);
  // eslint-disable-next-line no-control-regex
  const isIdn = /xn--/.test(host) || /[^\x00-\x7f]/.test(host);
  return { raw, host, unicodeHost, scheme, hasUserInfo, isIp, tld, registrable, isIdn, path };
}

/** Find URL-like tokens inside free text (with or without scheme). */
export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const token0 of text.split(/\s+/)) {
    const token = token0.replace(LEADING_PUNCT, '').replace(TRAILING_PUNCT, '');
    if (!token) continue;
    if (/^https?:\/\//i.test(token) || /^www\./i.test(token)) {
      out.push(token);
      continue;
    }
    if (token.includes('@') && !token.includes('/')) continue; // email address
    const m = /^([^\s/?#@]+)(?:[/?#:].*)?$/u.exec(token);
    if (!m) continue;
    const host = m[1]!.toLowerCase();
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && token.includes('/')) {
      out.push(token);
      continue;
    }
    const labels = host.split('.');
    if (labels.length < 2 || labels.some((l) => !l)) continue;
    const tld = labels[labels.length - 1]!;
    if (KNOWN_TLDS.has(tld) || tld.startsWith('xn--')) {
      if (labels.slice(0, -1).every((l) => /^[\p{L}\p{N}-]+$/u.test(l))) out.push(token);
    }
  }
  return [...new Set(out)];
}

// Confusable characters mapped to their Latin "skeleton".
const CONFUSABLES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ӏ: 'l', ԁ: 'd',
  ԛ: 'q', ѕ: 's', ԝ: 'w', һ: 'h', к: 'k', м: 'm', т: 't', в: 'b', н: 'h', п: 'n', г: 'r',
  α: 'a', ο: 'o', ρ: 'p', ν: 'v', τ: 't', ι: 'i', κ: 'k', ε: 'e', υ: 'u', β: 'b',
  ı: 'i', ɑ: 'a', ɡ: 'g', ł: 'l', ß: 'b',
  '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's',
};

/** Reduce a label to a Latin skeleton for lookalike comparison. */
export function skeleton(label: string): string {
  const base = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let out = '';
  for (const ch of base) out += CONFUSABLES[ch] ?? ch;
  return out.replace(/rn/g, 'm').replace(/vv/g, 'w');
}

export function isOfficialFor(parsed: ParsedUrl, brand: Brand): boolean {
  return brand.domains.some((d) => parsed.host === d || parsed.host.endsWith('.' + d));
}

export function isOfficialAny(parsed: ParsedUrl): Brand | undefined {
  return BRANDS.find((b) => isOfficialFor(parsed, b));
}

const SHORT_TOKEN_CONTEXT = /(nic|ni$|online|linea|seguro|segura|banca|app|web|login|verif|soporte|cliente|movil|pago|alerta|token|acceso)/;

/** Returns the brand a domain imitates (but does not belong to), if any. */
export function detectLookalike(parsed: ParsedUrl): Brand | undefined {
  if (parsed.isIp || isOfficialAny(parsed)) return undefined;
  const suffixLen = parsed.registrable.split('.').length - 1;
  const labels = parsed.unicodeHost.split('.');
  const nameLabels = labels.slice(0, labels.length - suffixLen);
  const parts = new Set<string>();
  for (const l of nameLabels) {
    const sk = skeleton(l);
    parts.add(sk);
    parts.add(sk.replace(/-/g, ''));
    for (const p of sk.split('-')) if (p) parts.add(p);
  }
  for (const brand of BRANDS) {
    for (const token of brand.tokens) {
      for (const part of parts) {
        if (part === token) return brand;
        if (token.length <= 3) {
          if (part.startsWith(token) && SHORT_TOKEN_CONTEXT.test(part.slice(token.length))) return brand;
          if (part.endsWith(token) && SHORT_TOKEN_CONTEXT.test(part.slice(0, -token.length))) return brand;
          continue;
        }
        if (part.includes(token)) return brand;
        if (part.length >= 4 && Math.abs(part.length - token.length) <= 2) {
          const maxDist = token.length >= 7 ? 2 : 1;
          if (levenshtein(part, token) <= maxDist) return brand;
        }
      }
    }
  }
  return undefined;
}
