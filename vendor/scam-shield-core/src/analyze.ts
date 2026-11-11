import { THRESHOLDS, analyzeRules, finalize } from './engine.js';
import { buildUserPrompt, callLlm, resolveProvider } from './llm.js';
import type { AnalysisResult, AnalyzeInput, AnalyzeOptions, Category, Signal } from './types.js';

export { analyzeRules };

/**
 * Analyze a message/link. Uses the rules engine and, when configured
 * (SCAM_SHIELD_LLM + API key, or `opts.llm`), blends in an LLM assessment.
 * Any LLM error, timeout, invalid output or missing key falls back to rules only.
 */
export async function analyze(input: AnalyzeInput, opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
  const rules = analyzeRules(input);
  const provider = resolveProvider(opts);
  if (!provider) return rules;
  if (opts.skipLlmAboveConfidence !== undefined) {
    const c = opts.skipLlmAboveConfidence;
    if (rules.riskScore >= c || rules.riskScore <= 100 - c) return rules;
  }
  try {
    const prompt = buildUserPrompt(input.text ?? '', input.url, rules.signals);
    const llm = await callLlm(provider, prompt, opts);
    const w = Math.max(0, Math.min(1, opts.llmWeight ?? 0.4));
    let score = Math.round((1 - w) * rules.riskScore + w * llm.riskScore);
    // Strong deterministic evidence (OTP request, lookalike domain, ...) cannot be
    // talked down by the model; this also blunts prompt injection inside the message.
    const strong = rules.signals.some((s) => s.weight >= 50);
    if (strong && rules.verdict === 'scam') score = Math.max(score, THRESHOLDS.scam);
    const category: Category = rules.category !== 'none' ? rules.category : llm.category;
    const signals: Signal[] = [
      ...rules.signals,
      {
        id: `llm_${provider.name}`,
        weight: 0,
        reasonEs: llm.reasonEs || `Evaluación del modelo: ${llm.riskScore}/100.`,
        reasonEn: llm.reasonEn || `Model assessment: ${llm.riskScore}/100.`,
      },
    ];
    return finalize(score, category, signals, true, { es: llm.reasonEs, en: llm.reasonEn });
  } catch {
    return rules;
  }
}
