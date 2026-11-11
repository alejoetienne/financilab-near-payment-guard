/** Lowercase, strip diacritics (á→a, ñ→n) and collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Split text into rough sentences/clauses for context-sensitive rules. */
export function splitSentences(s: string): string[] {
  return s
    .split(/(?<=[.!?¡¿;\n])\s*|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = cur;
  }
  return prev[b.length]!;
}
