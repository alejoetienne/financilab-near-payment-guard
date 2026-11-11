export type BrandKind = 'bank' | 'payment' | 'remittance' | 'messaging';

export interface Brand {
  id: string;
  name: string;
  kind: BrandKind;
  /** Regex (on normalized text) that detects the brand being mentioned. */
  mention: RegExp;
  /** Domains considered official (host equals or is a subdomain of these). */
  domains: string[];
  /** Tokens used to detect lookalike domains. */
  tokens: string[];
}

/**
 * Official domains are a best-effort allowlist for heuristics only. Always
 * verify against the institution's published channels before relying on it.
 */
export const BRANDS: Brand[] = [
  {
    id: 'bac',
    name: 'BAC Credomatic',
    kind: 'bank',
    mention: /\bbac\b|credomatic/,
    domains: ['baccredomatic.com', 'bac.net', 'credomatic.com'],
    tokens: ['baccredomatic', 'credomatic', 'bac'],
  },
  {
    id: 'banpro',
    name: 'Banpro',
    kind: 'bank',
    mention: /\bbanpro\b/,
    domains: ['banpro.com.ni', 'banprogrupopromerica.com.ni'],
    tokens: ['banpro'],
  },
  {
    id: 'lafise',
    name: 'LAFISE',
    kind: 'bank',
    mention: /\blafise\b/,
    domains: ['lafise.com', 'lafise.com.ni'],
    tokens: ['lafise'],
  },
  {
    id: 'bancentro',
    name: 'Bancentro',
    kind: 'bank',
    mention: /\bbancentro\b/,
    domains: ['bancentro.com.ni', 'lafise.com'],
    tokens: ['bancentro'],
  },
  {
    id: 'bdf',
    name: 'BDF',
    kind: 'bank',
    mention: /\bbdf\b|banco de finanzas/,
    domains: ['bdfnet.com', 'bdf.com.ni'],
    tokens: ['bdfnet'],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    kind: 'payment',
    mention: /\bpay\s?pal\b/,
    domains: ['paypal.com', 'paypal.me'],
    tokens: ['paypal'],
  },
  {
    id: 'westernunion',
    name: 'Western Union',
    kind: 'remittance',
    mention: /western\s?union/,
    domains: ['westernunion.com', 'wu.com'],
    tokens: ['westernunion'],
  },
  {
    id: 'remitly',
    name: 'Remitly',
    kind: 'remittance',
    mention: /\bremitly\b/,
    domains: ['remitly.com'],
    tokens: ['remitly'],
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    kind: 'messaging',
    mention: /\bwhats\s?app\b|\bwasap\b/,
    domains: ['whatsapp.com', 'wa.me', 'whatsapp.net'],
    tokens: ['whatsapp'],
  },
];

export const BRAND_BY_ID: Record<string, Brand> = Object.fromEntries(BRANDS.map((b) => [b.id, b]));
