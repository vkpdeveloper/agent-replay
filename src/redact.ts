// Masks credentials before anything is laid out, so secrets never reach the
// replay data, the HTML file or the video. Biased toward over-masking: a hidden
// hash costs nothing, a leaked key costs a rotation.

export const MASK = "********";

const KNOWN_PREFIXES = [
  /\b(sk-ant-(?:api|admin|oat)\d*-)[A-Za-z0-9_-]{16,}/g,
  /\b(sk-(?:proj-|svcacct-|admin-)?)[A-Za-z0-9_-]{20,}/g,
  /\b(gh[pousr]_)[A-Za-z0-9]{20,}/g,
  /\b(github_pat_)[A-Za-z0-9_]{20,}/g,
  /\b(glpat-)[A-Za-z0-9_-]{20,}/g,
  /\b(xox[abposr]-)[A-Za-z0-9-]{10,}/g,
  /\b(xapp-)[A-Za-z0-9-]{10,}/g,
  /\b((?:AKIA|ASIA))[0-9A-Z]{16}\b/g,
  /\b(AIza)[0-9A-Za-z_-]{35}/g,
  /\b((?:sk|rk|pk)_(?:live|test)_)[0-9a-zA-Z]{10,}/g,
  /\b(whsec_)[0-9a-zA-Z]{16,}/g,
  /\b(npm_)[A-Za-z0-9]{36}\b/g,
  /\b(hf_)[A-Za-z0-9]{30,}/g,
  /\b(gsk_)[A-Za-z0-9]{30,}/g,
  /\b(xai-)[A-Za-z0-9]{30,}/g,
  /\b(r8_)[A-Za-z0-9]{30,}/g,
  /\b(dop_v1_)[a-f0-9]{40,}/g,
  /\b(SG\.)[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g,
  /\b(re_)[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}/g,
  /\b(sntrys_)[A-Za-z0-9+/=_-]{30,}/g,
];

const SENSITIVE_NAME =
  "[A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|passphrase|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|signing[_-]?key|encryption[_-]?key|credentials?|auth[_-]?key|session[_-]?key|cookie|dsn)[A-Za-z0-9_.-]*";

// NAME = "value" / name: 'value' / "name": "value"
const QUOTED_ASSIGNMENT = new RegExp(`(["']?\\b${SENSITIVE_NAME}["']?\\s*[:=]\\s*)(["'\`])([^"'\`\\n]{4,})\\2`, "gi");
// NAME=value / name: value (env files, CLI flags, YAML)
const BARE_ASSIGNMENT = new RegExp(`(\\b${SENSITIVE_NAME}\\s*[:=]\\s*)([^\\s"'\`,;{}()\\[\\]<>]{6,})`, "gi");
// --password value / --token=value
const FLAG = /(--?(?:password|passwd|pass|token|api-key|apikey|secret|auth|key)(?:=|\s+))([^\s"'`-][^\s"'`]{5,})/gi;
// Typed in a chat: "my password is hunter2", "the passcode was 1234"
const PROSE = /(\b(?:password|passwd|passcode|passphrase|pwd|pin)\s+(?:is|was|=)\s*:?\s*["'`]?)([^\s"'`]{4,})/gi;
// "use the password Hk!@#7731": no verb, so only a value with a digit or symbol, not "password reset".
const PROSE_BARE = /(\b(?:password|passwd|passcode|passphrase)\s+)((?=[^\s"'`]*[\d!@#$%^&*])[^\s"'`]{6,})/gi;
// "Hk!@#7731 is the password"
const PROSE_BEFORE = /(?<![^\s"'`])((?=[^\s"'`]*[\d!@#$%^&*])[^\s"'`]{6,})(\s+is\s+(?:the\s+|my\s+)?(?:password|passcode)\b)/gi;
// echo 'Hk!@#7731' | sudo -S ..., also through ssh
const SUDO_STDIN = /(\b(?:echo|printf(?:\s+'%s\\n')?)\s+)(["']?)([^\s"'|]+)\2(\s*\|[^\n]*\bsudo\s+-S)/g;
// A whole message that is one password-like word: the answer to "what is the password?"
const LONE_SECRET = /^(?=\S*[A-Za-z])(?=\S*\d)(?=\S*[!@#$%^&*])[^\s/.]{8,64}$/;

/**
 * Masks credentials in `text`. Values masked because of where they appear (after
 * "password is", in NAME=value, piped into sudo) are added to `found`, so
 * `redactDeep` can mask the same value where nothing around it says it is secret.
 */
export function redact(text: string, home?: string, found?: Set<string>): string {
  const hide = (value: string) => {
    found?.add(value);
    return MASK;
  };
  let out = text;
  if (home) out = out.split(home).join("~");

  out = out.replace(
    /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?(?:-----END \1PRIVATE KEY-----|$)/g,
    `-----BEGIN $1PRIVATE KEY-----\n${MASK}\n-----END $1PRIVATE KEY-----`,
  );
  for (const pattern of KNOWN_PREFIXES) out = out.replace(pattern, `$1${MASK}`);

  // JWTs and Authorization headers.
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, MASK);
  out = out.replace(/\b((?:authorization|proxy-authorization)\s*[:=]\s*["']?(?:bearer|basic|token|bot)?\s*)[^\s"',;]{8,}/gi, `$1${MASK}`);
  out = out.replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, `$1${MASK}`);

  // Credentials embedded in URLs: postgres://user:pass@host
  out = out.replace(/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@"']+:)([^\s@/"']+)@/gi, (_, lead: string, value: string) => `${lead}${hide(value)}@`);

  out = out.replace(QUOTED_ASSIGNMENT, (match, lead: string, quote: string, value: string) =>
    isMaskableQuoted(value) ? `${lead}${quote}${hide(value)}${quote}` : match,
  );
  out = out.replace(BARE_ASSIGNMENT, (match, lead: string, value: string) =>
    isMaskableBare(value) ? `${lead}${hide(value)}` : match,
  );
  out = out.replace(FLAG, (match, lead: string, value: string) => (isMaskableBare(value) ? `${lead}${hide(value)}` : match));
  out = out.replace(PROSE, (match, lead: string, value: string) => (value.includes(MASK) ? match : `${lead}${hide(value)}`));
  out = out.replace(PROSE_BARE, (match, lead: string, value: string) => (value.includes(MASK) ? match : `${lead}${hide(value)}`));
  out = out.replace(PROSE_BEFORE, (match, value: string, tail: string) => (value.includes(MASK) ? match : `${hide(value)}${tail}`));
  out = out.replace(SUDO_STDIN, (match, lead: string, quote: string, value: string, tail: string) =>
    value.includes(MASK) ? match : `${lead}${quote}${hide(value)}${quote}${tail}`,
  );
  if (!out.includes(MASK) && LONE_SECRET.test(out.trim())) return hide(out.trim());

  return maskHighEntropy(out);
}

function isMaskableQuoted(value: string): boolean {
  if (value.includes(MASK) || isPlaceholder(value) || /^[\d.,:\s-]+$/.test(value)) return false;
  // Prose such as `description: "the token used for uploads"` is not a secret.
  return value.trim().split(/\s+/).length <= 3;
}

function isMaskableBare(value: string): boolean {
  if (value.includes(MASK) || isPlaceholder(value) || /^\d+(\.\d+)?$/.test(value)) return false;
  // Code references (`process.env.TOKEN`, `user.password`, `getToken`) are not values.
  const identifier = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\??$/.test(value);
  return !identifier || /\d/.test(value);
}

function isPlaceholder(value: string): boolean {
  return /^(?:\$\{?[\w.]+\}?|\{\{.*\}\}|<[^>]+>|x{4,}|\*+|\.{3}|true|false|null|undefined|none|redacted|changeme|your[_-].*|example.*)$/i.test(
    value.trim(),
  );
}

// Long random-looking tokens with no known prefix (Cloudflare, Supabase, etc).
function maskHighEntropy(text: string): string {
  return text.replace(/(?<![A-Za-z0-9_+=/-])[A-Za-z0-9_+=-]{32,}(?![A-Za-z0-9_+=/-])/g, (token) => {
    if (/^[a-f0-9-]+$/i.test(token)) return token; // git SHAs, UUIDs, hex digests
    if (!/[a-z]/.test(token) || !/[A-Z]/.test(token) || !/\d/.test(token)) return token;
    if (/^[A-Za-z]+(?:[_-][A-Za-z0-9]+)+$/.test(token) && !/\d{3,}|[A-Z]{2,}\d|[a-z]\d[A-Z]/.test(token)) return token;
    if (mostlySorted(token)) return token; // flag lists such as `ls [-@ABCF...xy1%]`
    return entropy(token) >= 4 ? MASK : token;
  });
}

function mostlySorted(text: string): boolean {
  let ascending = 0;
  for (let i = 1; i < text.length; i++) if (text.charCodeAt(i) > text.charCodeAt(i - 1)) ascending++;
  return ascending / (text.length - 1) > 0.8;
}

function entropy(text: string): number {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * Returns a copy of `value` with `redact` applied to every string inside it, then
 * masks every value found secret anywhere in it wherever else it appears: a password
 * typed once as "my password is X" is also hidden where it was pasted bare.
 */
export function redactDeep<T>(value: T, home?: string): T {
  const found = new Set<string>();
  const redacted = walk(value, (text) => redact(text, home, found));
  // Short values ("admin", "1234") would mask ordinary words and numbers.
  const secrets = [...found].filter((secret) => secret.length >= 6 && !isPlaceholder(secret)).sort((a, b) => b.length - a.length);
  if (!secrets.length) return redacted as T;
  return walk(redacted, (text) => secrets.reduce((out, secret) => out.split(secret).join(MASK), text)) as T;
}

function walk(value: unknown, map: (text: string) => string): unknown {
  if (typeof value === "string") return map(value);
  if (Array.isArray(value)) return value.map((item) => walk(item, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, map)]));
  }
  return value;
}
