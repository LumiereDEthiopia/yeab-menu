/**
 * Client-side JWT debugging utilities.
 *
 * Everything here runs entirely in the browser using the Web Crypto API —
 * tokens and secrets never leave the page.
 */

// ---------------------------------------------------------------------------
// Base64URL helpers
// ---------------------------------------------------------------------------

export function base64UrlToBytes(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// ---------------------------------------------------------------------------
// Algorithms
// ---------------------------------------------------------------------------

export type JwtAlgorithm =
  | 'none'
  | 'HS256' | 'HS384' | 'HS512'
  | 'RS256' | 'RS384' | 'RS512'
  | 'ES256' | 'ES384' | 'ES512';

export type AlgorithmKind = 'none' | 'hmac' | 'rsa' | 'ecdsa';

export const JWT_ALGORITHMS: { value: JwtAlgorithm; label: string; kind: AlgorithmKind }[] = [
  { value: 'none', label: 'none — unsigned token', kind: 'none' },
  { value: 'HS256', label: 'HS256 — HMAC + SHA-256', kind: 'hmac' },
  { value: 'HS384', label: 'HS384 — HMAC + SHA-384', kind: 'hmac' },
  { value: 'HS512', label: 'HS512 — HMAC + SHA-512', kind: 'hmac' },
  { value: 'RS256', label: 'RS256 — RSASSA-PKCS1-v1_5 + SHA-256', kind: 'rsa' },
  { value: 'RS384', label: 'RS384 — RSASSA-PKCS1-v1_5 + SHA-384', kind: 'rsa' },
  { value: 'RS512', label: 'RS512 — RSASSA-PKCS1-v1_5 + SHA-512', kind: 'rsa' },
  { value: 'ES256', label: 'ES256 — ECDSA P-256 + SHA-256', kind: 'ecdsa' },
  { value: 'ES384', label: 'ES384 — ECDSA P-384 + SHA-384', kind: 'ecdsa' },
  { value: 'ES512', label: 'ES512 — ECDSA P-521 + SHA-512', kind: 'ecdsa' },
];

export function algorithmKind(alg: JwtAlgorithm): AlgorithmKind {
  return JWT_ALGORITHMS.find((a) => a.value === alg)?.kind ?? 'hmac';
}

const HMAC_HASH: Partial<Record<JwtAlgorithm, string>> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

const EC_CURVE: Partial<Record<JwtAlgorithm, string>> = {
  ES256: 'P-256',
  ES384: 'P-384',
  ES512: 'P-521',
};

const EC_HASH: Partial<Record<JwtAlgorithm, string>> = {
  ES256: 'SHA-256',
  ES384: 'SHA-384',
  ES512: 'SHA-512',
};

const RSA_HASH: Partial<Record<JwtAlgorithm, string>> = {
  RS256: 'SHA-256',
  RS384: 'SHA-384',
  RS512: 'SHA-512',
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface ParsedJwt {
  raw: string;
  headerB64: string | null;
  payloadB64: string | null;
  signatureB64: string | null;
  signingInput: string | null;
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signatureBytes: Uint8Array | null;
  errors: string[];
  isWellFormed: boolean;
}

function decodeSegment(segment: string): unknown {
  return JSON.parse(bytesToUtf8(base64UrlToBytes(segment)));
}

export function parseJwt(token: string): ParsedJwt {
  const result: ParsedJwt = {
    raw: token,
    headerB64: null,
    payloadB64: null,
    signatureB64: null,
    signingInput: null,
    header: null,
    payload: null,
    signatureBytes: null,
    errors: [],
    isWellFormed: false,
  };

  const trimmed = token.trim();
  if (!trimmed) return result;

  const parts = trimmed.split('.');
  if (parts.length < 2 || parts.length > 3) {
    result.errors.push(
      `A compact JWT must have 2 or 3 dot-separated segments, but this one has ${parts.length}.`
    );
    return result;
  }

  const [headerB64, payloadB64, signatureB64 = null] = parts;
  result.headerB64 = headerB64;
  result.payloadB64 = payloadB64;
  result.signatureB64 = signatureB64;
  result.signingInput = `${headerB64}.${payloadB64}`;

  try {
    const decoded = decodeSegment(headerB64);
    if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
      result.header = decoded as Record<string, unknown>;
    } else {
      result.errors.push('The header (first segment) must decode to a JSON object.');
    }
  } catch {
    result.errors.push('The header (first segment) is not valid Base64URL-encoded JSON.');
  }

  try {
    const decoded = decodeSegment(payloadB64);
    if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
      result.payload = decoded as Record<string, unknown>;
    } else {
      result.errors.push('The payload (second segment) must decode to a JSON object.');
    }
  } catch {
    result.errors.push('The payload (second segment) is not valid Base64URL-encoded JSON.');
  }

  if (signatureB64 !== null && signatureB64.length > 0) {
    try {
      result.signatureBytes = base64UrlToBytes(signatureB64);
    } catch {
      result.errors.push('The signature (third segment) is not valid Base64URL.');
    }
  }

  if (result.header !== null && typeof result.header.alg !== 'string') {
    result.errors.push('The header is missing the required "alg" claim.');
  }

  result.isWellFormed = result.errors.length === 0 && result.header !== null && result.payload !== null;
  return result;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

export type SignatureStatus = 'verified' | 'invalid' | 'unsigned' | 'missing-key' | 'error' | 'invalid-token';

export interface VerificationResult {
  status: SignatureStatus;
  message?: string;
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  return base64UrlToBytes(body);
}

/**
 * JWT ECDSA signatures are raw `r || s` byte pairs, but the Web Crypto API
 * expects DER-encoded signatures — this converts between the two formats.
 */
function rawEcdsaSignatureToDer(raw: Uint8Array): Uint8Array {
  const half = raw.length / 2;
  const trim = (bytes: Uint8Array): number[] => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    const trimmed = Array.from(bytes.slice(start));
    return (trimmed[0] & 0x80) !== 0 ? [0, ...trimmed] : trimmed;
  };
  const r = trim(raw.slice(0, half));
  const s = trim(raw.slice(half));
  const bodyLength = 2 + r.length + 2 + s.length;
  return new Uint8Array([0x30, bodyLength, 0x02, r.length, ...r, 0x02, s.length, ...s]);
}

export async function verifyJwtSignature(
  rawToken: string,
  algorithm: JwtAlgorithm,
  key: string,
  keyIsBase64Url: boolean
): Promise<VerificationResult> {
  const parsed = parseJwt(rawToken);
  if (!parsed.isWellFormed || !parsed.signingInput) {
    return { status: 'invalid-token', message: 'The token is not a well-formed JWT.' };
  }

  const headerAlg = typeof parsed.header?.alg === 'string' ? (parsed.header.alg as JwtAlgorithm) : null;
  if (headerAlg && headerAlg !== algorithm) {
    return {
      status: 'error',
      message: `The token header declares "${headerAlg}" but you are verifying with "${algorithm}". Select "${headerAlg}" from the algorithm dropdown.`,
    };
  }

  if (algorithm === 'none') {
    if (!parsed.signatureB64) return { status: 'unsigned' };
    return {
      status: 'invalid',
      message: 'Algorithm "none" requires an empty signature, but this token has one.',
    };
  }

  if (!parsed.signatureBytes || parsed.signatureBytes.length === 0) {
    return { status: 'invalid', message: 'The token has no signature to verify.' };
  }

  const trimmedKey = key.trim();
  if (!trimmedKey) return { status: 'missing-key' };

  const data = utf8ToBytes(parsed.signingInput);
  const signature = parsed.signatureBytes;

  try {
    if (algorithm.startsWith('HS')) {
      const hash = HMAC_HASH[algorithm];
      if (!hash) return { status: 'error', message: `Unsupported algorithm: ${algorithm}` };
      const keyBytes = keyIsBase64Url ? base64UrlToBytes(trimmedKey) : utf8ToBytes(trimmedKey);
      if (keyBytes.length === 0) return { status: 'missing-key' };
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes as BufferSource,
        { name: 'HMAC', hash },
        false,
        ['verify']
      );
      const ok = await crypto.subtle.verify('HMAC', cryptoKey, signature as BufferSource, data as BufferSource);
      return { status: ok ? 'verified' : 'invalid' };
    }

    if (algorithm.startsWith('RS')) {
      const hash = RSA_HASH[algorithm];
      if (!hash) return { status: 'error', message: `Unsupported algorithm: ${algorithm}` };
      const cryptoKey = await crypto.subtle.importKey(
        'spki',
        pemToBytes(trimmedKey) as BufferSource,
        { name: 'RSASSA-PKCS1-v1_5', hash },
        false,
        ['verify']
      );
      const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature as BufferSource, data as BufferSource);
      return { status: ok ? 'verified' : 'invalid' };
    }

    if (algorithm.startsWith('ES')) {
      const curve = EC_CURVE[algorithm];
      const hash = EC_HASH[algorithm];
      if (!curve || !hash) return { status: 'error', message: `Unsupported algorithm: ${algorithm}` };
      const cryptoKey = await crypto.subtle.importKey(
        'spki',
        pemToBytes(trimmedKey) as BufferSource,
        { name: 'ECDSA', namedCurve: curve },
        false,
        ['verify']
      );
      const der = rawEcdsaSignatureToDer(signature);
      const ok = await crypto.subtle.verify(
        { name: 'ECDSA', hash },
        cryptoKey,
        der as BufferSource,
        data as BufferSource
      );
      return { status: ok ? 'verified' : 'invalid' };
    }

    return { status: 'error', message: `Unsupported algorithm: ${algorithm}` };
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Verification failed.',
    };
  }
}

// ---------------------------------------------------------------------------
// Example token generation
// ---------------------------------------------------------------------------

export const EXAMPLE_JWT_SECRET = 'a-string-secret-at-least-256-bits-long';

export async function generateExampleJwt(): Promise<{
  token: string;
  secret: string;
  algorithm: JwtAlgorithm;
}> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const iat = Math.floor(Date.now() / 1000);
  const payload = { sub: '1234567890', name: 'John Doe', admin: true, iat, exp: iat + 60 * 60 * 24 };

  const signingInput = `${bytesToBase64Url(utf8ToBytes(JSON.stringify(header)))}.${bytesToBase64Url(
    utf8ToBytes(JSON.stringify(payload))
  )}`;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    utf8ToBytes(EXAMPLE_JWT_SECRET) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, utf8ToBytes(signingInput) as BufferSource);

  return {
    token: `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`,
    secret: EXAMPLE_JWT_SECRET,
    algorithm: 'HS256',
  };
}

// ---------------------------------------------------------------------------
// Claims breakdown
// ---------------------------------------------------------------------------

export interface ClaimInfo {
  key: string;
  label: string;
  description: string;
  display: string;
  timeNote?: string;
  timeNoteTone?: 'good' | 'warn' | 'bad';
}

const REGISTERED_CLAIMS: Record<string, { label: string; description: string }> = {
  alg: { label: 'Algorithm', description: 'The algorithm used to sign the token.' },
  typ: { label: 'Token Type', description: 'The media type of the token — usually "JWT".' },
  kid: { label: 'Key ID', description: 'A hint for which key was used to sign the token.' },
  iss: { label: 'Issuer', description: 'Identifies who issued and signed this token.' },
  sub: { label: 'Subject', description: 'Identifies the user or entity this token is about.' },
  aud: { label: 'Audience', description: 'Identifies who this token is intended for.' },
  exp: { label: 'Expiration Time', description: 'The token must not be accepted after this moment.' },
  nbf: { label: 'Not Before', description: 'The token must not be accepted before this moment.' },
  iat: { label: 'Issued At', description: 'The moment this token was created.' },
  jti: { label: 'JWT ID', description: 'A unique identifier for this token.' },
};

function formatEpochDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  });
}

function formatRelativeTime(targetMs: number, nowMs: number): string {
  const diff = Math.abs(targetMs - nowMs);
  const minutes = Math.round(diff / 60_000);
  const hours = Math.round(diff / 3_600_000);
  const days = Math.round(diff / 86_400_000);
  const span = days >= 2 ? `${days} days` : hours >= 2 ? `${hours} hours` : `${minutes} minutes`;
  return targetMs > nowMs ? `in ${span}` : `${span} ago`;
}

export function explainClaims(claims: Record<string, unknown>): ClaimInfo[] {
  const now = Date.now();
  return Object.entries(claims).map(([key, value]) => {
    const registered = REGISTERED_CLAIMS[key];
    const isEpochDate = ['exp', 'nbf', 'iat'].includes(key) && typeof value === 'number';

    let display: string;
    if (typeof value === 'string') display = `"${value}"`;
    else if (typeof value === 'object' && value !== null) display = JSON.stringify(value);
    else display = String(value);

    let timeNote: string | undefined;
    let timeNoteTone: 'good' | 'warn' | 'bad' | undefined;
    if (isEpochDate) {
      display = `${String(value)} — ${formatEpochDate(value as number)}`;
      if (key === 'exp') {
        const expired = (value as number) * 1000 < now;
        timeNote = expired
          ? `Expired — this token expired ${formatRelativeTime((value as number) * 1000, now)}`
          : `Valid — expires ${formatRelativeTime((value as number) * 1000, now)}`;
        timeNoteTone = expired ? 'bad' : 'good';
      } else if (key === 'nbf') {
        const notYet = (value as number) * 1000 > now;
        timeNote = notYet
          ? `Not yet valid — becomes valid ${formatRelativeTime((value as number) * 1000, now)}`
          : `Valid — became valid ${formatRelativeTime((value as number) * 1000, now)}`;
        timeNoteTone = notYet ? 'warn' : 'good';
      }
    }

    return {
      key,
      label: registered?.label ?? 'Custom Claim',
      description:
        registered?.description ??
        'A private claim agreed between the issuer and the consumer — not part of the registered set.',
      display,
      timeNote,
      timeNoteTone,
    };
  });
}

export function claimsBreakdownToText(claims: ClaimInfo[]): string {
  return claims
    .map((c) => {
      const lines = [`${c.key} (${c.label}): ${c.display}`];
      if (c.timeNote) lines.push(`  ${c.timeNote}`);
      lines.push(`  ${c.description}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// JSON syntax highlighting tokens (for the decoded panels)
// ---------------------------------------------------------------------------

export type JsonTokenType = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'plain';

export interface JsonToken {
  text: string;
  type: JsonTokenType;
}

const JSON_TOKEN_RE =
  /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;

export function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  JSON_TOKEN_RE.lastIndex = 0;
  while ((match = JSON_TOKEN_RE.exec(json)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: json.slice(lastIndex, match.index), type: 'plain' });
    }
    const text = match[0];
    let type: JsonTokenType = 'plain';
    if (text.startsWith('"')) {
      const rest = json.slice(JSON_TOKEN_RE.lastIndex);
      type = /^\s*:/.test(rest) ? 'key' : 'string';
    } else if (/^-?\d/.test(text)) {
      type = 'number';
    } else if (text === 'true' || text === 'false') {
      type = 'boolean';
    } else if (text === 'null') {
      type = 'null';
    }
    tokens.push({ text, type });
    lastIndex = JSON_TOKEN_RE.lastIndex;
  }
  if (lastIndex < json.length) {
    tokens.push({ text: json.slice(lastIndex), type: 'plain' });
  }
  return tokens;
}




