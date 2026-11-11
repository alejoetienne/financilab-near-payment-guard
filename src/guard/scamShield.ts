/**
 * Bridge to our pre-hackathon MIT library scam-shield-core (vendored, unmodified,
 * in /vendor/scam-shield-core). Offline rules engine, zero dependencies.
 */
export {
  analyzeRules,
  draftSafeReply,
  educationTip,
  skeleton,
  BRANDS,
  CATEGORY_LABELS,
} from '../../vendor/scam-shield-core/src/index.js';
export type { AnalysisResult, Category } from '../../vendor/scam-shield-core/src/index.js';
export { levenshtein, normalizeText } from '../../vendor/scam-shield-core/src/normalize.js';

import type { AnalysisResult as _AR, Category as _Cat } from '../../vendor/scam-shield-core/src/index.js';

const LINK_SIGNAL = /domain|link|url|tld|http|ip_host|shortener/;

/**
 * scam-shield-core files any non-safe message without a specific script under
 * `phishing_link`. When the text has no link at all, report it as uncategorized
 * so we don't tell users "do not open the link" about a message without links.
 */
export function effectiveCategory(r: _AR): _Cat {
  if (r.category === 'phishing_link' && !r.signals.some((s) => s.weight > 0 && LINK_SIGNAL.test(s.id))) return 'none';
  return r.category;
}
