# scam-shield-core

Spanish-first scam detector for payment links and messages in **Nicaragua and Latin America**.

- **Offline rules engine** (zero runtime dependencies, works in Node ≥ 18 and browsers) that explains every decision in Spanish and English.
- **Optional LLM layer** (Anthropic, OpenAI or Gemini via `fetch`) blended with the rules. Any failure falls back to rules only.
- Helpers for **safe replies** and **education tips**.

> ⚠️ Heuristic tool. It reduces risk but cannot guarantee a message is safe. Official domains listed in `src/brands.ts` are a best-effort allowlist; verify them before production use.

## What it detects

| Area | Examples |
| --- | --- |
| Brand impersonation | Fake BAC Credomatic, Banpro, LAFISE, Bancentro, BDF, PayPal, Western Union, Remitly messages; brand named but link points elsewhere |
| Malicious links | Lookalike/typosquat domains (`banpr0`, `paypa1`, `lafisse`), punycode/IDN homoglyphs (Cyrillic `а`), risky TLDs (`.xyz`, `.top`, `.click`…), URL shorteners, raw IP hosts, `http://` only, `user@host` tricks |
| Data theft | Requests for OTP/PIN/token/codes, card number/CVV/expiry, username/password (ignores protective phrases like *"nunca le pediremos su PIN"*) |
| Pressure | *"Su cuenta será bloqueada"*, *"en las próximas 24 horas"*, *"actividad inusual"* |
| Scam scripts | Crypto/investment doubling, remittance "retained, pay a fee to release", prize/lottery, fake jobs (likes, tasks, sign-up fees), WhatsApp "new number" + money requests, WhatsApp code hijack, fake refunds, held packages |

## Install

```bash
npm install scam-shield-core
```

## Usage

```ts
import { analyze, analyzeRules, draftSafeReply, educationTip } from 'scam-shield-core';

// Sync, offline, deterministic
const r = analyzeRules({ text: 'Banpro: su cuenta será bloqueada. Confirme su PIN en https://banpr0.top' });
r.verdict;       // 'scam'
r.riskScore;     // 0-100
r.category;      // 'bank_impersonation'
r.signals;       // [{ id: 'lookalike_domain', weight: 60, reasonEs, reasonEn }, ...]
r.explanationEs; // "Muy probablemente es una estafa (suplantación de banco). ..."
r.adviceEn;      // "Do not open the link or share codes. Call your bank ..."

// Async: rules + optional LLM (falls back to rules if not configured)
const r2 = await analyze({ text: 'Hola mamá, este es mi nuevo número...', url: 'https://…', locale: 'es' });
r2.llmUsed;      // true only when an LLM answered successfully

draftSafeReply(r2, 'es'); // "Antes de enviar dinero te voy a llamar a tu número de siempre..."
educationTip(r2.category, 'en');
```

### Result

```ts
{
  riskScore: number;               // 0-100
  verdict: 'safe' | 'suspicious' | 'scam';  // scam >= 60, suspicious >= 25
  category: Category;              // e.g. 'bank_impersonation', 'remittance_fee', 'fake_job', 'none'
  signals: { id; weight; reasonEs; reasonEn }[];
  explanationEs; explanationEn; adviceEs; adviceEn: string;
  llmUsed: boolean;
}
```

Scoring: positive signal weights are combined with a noisy-OR (`1 - Π(1 - w/100)`), protective signals (official domains, "never share your code" warnings) subtract.

## LLM layer (optional)

Configured by environment variables, or by `opts` on `analyze()`:

| Variable | Purpose |
| --- | --- |
| `SCAM_SHIELD_LLM` | `anthropic` \| `openai` \| `gemini` \| `none` (default `none`) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | Provider key |
| `SCAM_SHIELD_ANTHROPIC_MODEL` / `SCAM_SHIELD_OPENAI_MODEL` / `SCAM_SHIELD_GEMINI_MODEL` | Model override (defaults: `claude-haiku-5-5`, `gpt-4o-mini`, `gemini-2.5-flash`) |

```ts
await analyze(input, {
  llm: 'anthropic',        // override env
  apiKey: '…',
  model: '…',
  llmWeight: 0.4,          // final = 0.6 * rules + 0.4 * llm
  timeoutMs: 8000,
  fetch: customFetch,      // for tests / special runtimes
  env: { … },              // instead of process.env
  skipLlmAboveConfidence: 90, // skip the call when rules are already ≥90 or ≤10
});
```

- The model must return JSON (`riskScore`, `verdict`, `category`, `reasonEs`, `reasonEn`); it is validated and clamped.
- Missing key, HTTP error, timeout, or invalid JSON → **rules-only result** (`llmUsed: false`).
- When the rules already say `scam` with strong evidence (weight ≥ 50), the LLM cannot pull the result below the scam threshold. This protects against prompt injection hidden inside the message.
- Privacy: with an LLM enabled, the message text and URL are sent to that provider. Keep the default (`none`) for fully offline use.

## Development

```bash
npm install
npm test        # vitest
npm run build   # tsc → dist/ (ESM + .d.ts)
npm run eval    # rules-only accuracy, per-class precision/recall, confusion matrix
npm run eval -- --verbose path/to/other.jsonl
```

`data/samples.jsonl` holds 60 **synthetic** labeled examples (27 scam, 13 suspicious, 20 safe, including legitimate bank notifications). None are real messages. The rules were developed together with this set, so its score overstates real-world accuracy. Evaluate on your own held-out data before drawing conclusions. Format, one per line:

```json
{"id":"s001","label":"scam","text":"…","url":"optional","synthetic":true}
```

### Layout

```
src/
  index.ts      public exports
  analyze.ts    analyze() — rules + LLM blending + fallback
  engine.ts     analyzeRules(), scoring, verdicts, categories
  rules.ts      text & URL rules → signals
  url.ts        URL extraction/parsing, lookalike & homoglyph detection
  punycode.ts   dependency-free punycode decoder
  brands.ts     brands, mention patterns, official domains
  llm.ts        Anthropic / OpenAI / Gemini adapters (fetch)
  content.ts    explanations & advice (es/en)
  helpers.ts    draftSafeReply, educationTip
```

## License

MIT © 2026 Alejandro Arana / FinanciLab
