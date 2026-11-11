export type Locale = 'es' | 'en';

export type Verdict = 'safe' | 'suspicious' | 'scam';

export type Category =
  | 'bank_impersonation'
  | 'payment_platform_impersonation'
  | 'remittance_fee'
  | 'crypto_investment'
  | 'prize_lottery'
  | 'fake_job'
  | 'whatsapp_number_swap'
  | 'account_takeover'
  | 'credential_theft'
  | 'phishing_link'
  | 'advance_fee'
  | 'none';

export type LlmProviderName = 'anthropic' | 'openai' | 'gemini' | 'none';

export interface AnalyzeInput {
  /** Message text (SMS, WhatsApp, email body, etc.). May be empty if only a URL is given. */
  text: string;
  /** Optional link to analyze in addition to any URLs found inside `text`. */
  url?: string;
  /** Preferred locale for the caller. Both languages are always returned. */
  locale?: Locale;
}

export interface Signal {
  id: string;
  /** Positive values raise risk (0-100 scale); negative values lower it. */
  weight: number;
  reasonEs: string;
  reasonEn: string;
}

export interface AnalysisResult {
  riskScore: number;
  verdict: Verdict;
  category: Category;
  signals: Signal[];
  explanationEs: string;
  explanationEn: string;
  adviceEs: string;
  adviceEn: string;
  llmUsed: boolean;
}

export interface LlmAssessment {
  riskScore: number;
  verdict: Verdict;
  category: Category;
  reasonEs: string;
  reasonEn: string;
}

export type FetchLike = (input: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

export interface AnalyzeOptions {
  /** Override provider; defaults to env SCAM_SHIELD_LLM, else 'none'. */
  llm?: LlmProviderName;
  /** Override the API key (otherwise read from the provider's env var). */
  apiKey?: string;
  /** Override the model name for the chosen provider. */
  model?: string;
  /** Weight of the LLM score when blending (0..1). Default 0.4. */
  llmWeight?: number;
  /** Request timeout in ms. Default 8000. */
  timeoutMs?: number;
  /** Custom fetch implementation (for tests or non-standard runtimes). */
  fetch?: FetchLike;
  /** Environment map; defaults to process.env when available. */
  env?: Record<string, string | undefined>;
  /** Skip the LLM entirely if rules are already this confident (score >= value or <= 100-value). Default: never skip. */
  skipLlmAboveConfidence?: number;
}
