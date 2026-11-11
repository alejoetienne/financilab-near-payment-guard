import { ADVICE, buildExplanation } from './content.js';
import { buildContext, runRules, type RuleHit } from './rules.js';
import type { AnalysisResult, AnalyzeInput, Category, Signal, Verdict } from './types.js';

export const THRESHOLDS = { scam: 60, suspicious: 25 } as const;

export function verdictFor(score: number): Verdict {
  if (score >= THRESHOLDS.scam) return 'scam';
  if (score >= THRESHOLDS.suspicious) return 'suspicious';
  return 'safe';
}

/** Noisy-OR combination of positive weights, then negative weights subtract. */
export function combineScore(signals: Pick<Signal, 'weight'>[]): number {
  let keep = 1;
  let neg = 0;
  for (const s of signals) {
    if (s.weight > 0) keep *= 1 - Math.min(s.weight, 99) / 100;
    else neg += s.weight;
  }
  const score = Math.round(100 * (1 - keep) + neg);
  return Math.max(0, Math.min(100, score));
}

export function pickCategory(hits: RuleHit[]): Category {
  const totals = new Map<Category, number>();
  for (const h of hits) {
    if (!h.category || h.weight <= 0) continue;
    totals.set(h.category, (totals.get(h.category) ?? 0) + h.weight);
  }
  // Specific scam scripts beat generic categories when present.
  const generic = new Set<Category>(['phishing_link', 'credential_theft']);
  let best: Category = 'none';
  let bestScore = 0;
  for (const [cat, total] of totals) {
    const adj = generic.has(cat) ? total * 0.6 : total;
    if (adj > bestScore) {
      best = cat;
      bestScore = adj;
    }
  }
  return best;
}

export function finalize(
  score: number,
  category: Category,
  signals: Signal[],
  llmUsed: boolean,
  extra?: { es?: string; en?: string },
): AnalysisResult {
  const verdict = verdictFor(score);
  const cat: Category = verdict === 'safe' ? 'none' : category === 'none' ? 'phishing_link' : category;
  const advice = ADVICE[cat];
  let explanationEs = buildExplanation(verdict, cat, signals, 'es');
  let explanationEn = buildExplanation(verdict, cat, signals, 'en');
  if (extra?.es) explanationEs += ` Análisis IA: ${extra.es}`;
  if (extra?.en) explanationEn += ` AI analysis: ${extra.en}`;
  return {
    riskScore: score,
    verdict,
    category: cat,
    signals,
    explanationEs,
    explanationEn,
    adviceEs: advice.es,
    adviceEn: advice.en,
    llmUsed,
  };
}

/** Synchronous, fully offline rules-only analysis. */
export function analyzeRules(input: AnalyzeInput): AnalysisResult {
  const text = typeof input?.text === 'string' ? input.text : '';
  const ctx = buildContext({ text, url: input?.url, locale: input?.locale });
  const hits = runRules(ctx);
  const score = combineScore(hits);
  const signals: Signal[] = hits.map(({ id, weight, reasonEs, reasonEn }) => ({ id, weight, reasonEs, reasonEn }));
  return finalize(score, pickCategory(hits), signals, false);
}
