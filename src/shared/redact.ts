/**
 * UI21 R02: single tested redaction boundary for user-visible ERROR text.
 *
 * Applied to every error payload that reaches the renderer (failed model run,
 * bridge/RPC command errors, disconnect banners, catalog/thinking reads).
 * NEVER applied to normal assistant answers or the user's own prompt.
 *
 * This is a conservative best-effort filter, not a universal secret scanner:
 * known credential shapes are removed precisely, and long letter+digit
 * identifiers of unknown shape are removed as well, so an unrecognised token
 * cannot pass through raw. Error text is rendered as plain text (never parsed
 * as Markdown or HTML).
 */

const MAX_LEN = 300;
const FALLBACK = 'Генерация завершилась с ошибкой';

/** Ordered [pattern, replacement]; order matters (scheme before value). */
const RULES: ReadonlyArray<readonly [RegExp, string | ((...m: string[]) => string)]> = [
  // Provider key shapes with their real separators (GitHub uses `_`).
  [/\b(?:sk|pk|rk)-[A-Za-z0-9._-]{6,}/g, '[redacted]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{6,}/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{6,}/g, '[redacted]'],
  [/\bglpat-[A-Za-z0-9_-]{6,}/g, '[redacted]'],
  [/\bxox[abposr]-[A-Za-z0-9-]{6,}/g, '[redacted]'],
  // HTTP auth schemes: drop the credential, not just the scheme word.
  [/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 [redacted]'],
  // `key: value` / `key=value` credentials incl. JSON-quoted and camelCase
  // forms: {"api_key":"…"}, "apiKey": "…", {'client_secret': '…'},
  // accessToken=…, password: …
  [
    /(["']?)(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization|proxy-authorization)\1\s*[:=]\s*(["']?)[^\s"',;}]+/gi,
    (_m, _q1, name: string) => `${name}: [redacted]`,
  ],
  // Conservative catch-all: long identifiers mixing letters and digits are
  // treated as credentials — an unrecognised token shape must not leak.
  [/\b(?=[A-Za-z0-9_-]{32,}\b)(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g, '[redacted]'],
];

/** Best-effort path shapes; explicitly not a claim to catch every path. */
const PATH_PATTERN =
  /(?:[A-Za-z]:[\\/][^\s"'`]+)|(?:\/(?:home|mnt|Users|root|var|etc|tmp|opt|srv|usr|proc|sys|dev|private|Applications)\/[^\s"'`]*)/g;

/** Render-safe error text for the DOM: redacted, control-stripped, bounded. */
export function redactSecrets(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') return FALLBACK;
  // eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point
  let text = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ');
  for (const [pattern, replacement] of RULES) {
    text = typeof replacement === 'string' ? text.replace(pattern, replacement) : text.replace(pattern, replacement);
  }
  text = text.replace(PATH_PATTERN, '[path]').trim();
  if (text.length > MAX_LEN) text = `${text.slice(0, MAX_LEN)}…`;
  return text === '' ? FALLBACK : text;
}
