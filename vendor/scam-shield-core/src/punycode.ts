// Minimal RFC 3492 Punycode decoder (decode only) so the package has no
// runtime dependencies and works in browsers as well as Node.
const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let k = 0;
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  for (; delta > ((BASE - TMIN) * TMAX) >> 1; k += BASE) {
    delta = Math.floor(delta / (BASE - TMIN));
  }
  return Math.floor(k + ((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function basicToDigit(cp: number): number {
  if (cp >= 0x30 && cp < 0x3a) return cp - 22; // 0-9 -> 26-35
  if (cp >= 0x41 && cp < 0x5b) return cp - 0x41; // A-Z
  if (cp >= 0x61 && cp < 0x7b) return cp - 0x61; // a-z
  return BASE;
}

/** Decode a single punycode label (without the "xn--" prefix). Throws on invalid input. */
export function decodePunycodeLabel(input: string): string {
  const output: number[] = [];
  let n = INITIAL_N;
  let bias = INITIAL_BIAS;
  let i = 0;
  const basic = Math.max(input.lastIndexOf('-'), 0);
  for (let j = 0; j < basic; j++) {
    const c = input.charCodeAt(j);
    if (c >= 0x80) throw new Error('invalid punycode');
    output.push(c);
  }
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (idx >= input.length) throw new Error('invalid punycode');
      const digit = basicToDigit(input.charCodeAt(idx++));
      if (digit >= BASE) throw new Error('invalid punycode');
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const len = output.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);
    n += Math.floor(i / len);
    i %= len;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** Convert an ASCII (possibly xn--) hostname to Unicode. Invalid labels are left as-is. */
export function hostnameToUnicode(host: string): string {
  return host
    .split('.')
    .map((label) => {
      if (!label.toLowerCase().startsWith('xn--')) return label;
      try {
        return decodePunycodeLabel(label.slice(4).toLowerCase());
      } catch {
        return label;
      }
    })
    .join('.');
}
