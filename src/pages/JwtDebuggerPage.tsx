import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eraser,
  Focus,
  KeyRound,
  Loader2,
  ShieldCheck,
  ShieldX,
  Sparkles,
  XCircle,
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  type ClaimInfo,
  EXAMPLE_JWT_SECRET,
  JWT_ALGORITHMS,
  type JsonTokenType,
  type JwtAlgorithm,
  algorithmKind,
  claimsBreakdownToText,
  explainClaims,
  generateExampleJwt,
  parseJwt,
  tokenizeJson,
  verifyJwtSignature,
  type VerificationResult,
} from '../lib/jwt';

/** The classic jwt.io sample — pre-loaded like the official debugger. */
const EXAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.KMUFsIDTnFmyG3nMiGM6H9FNFUROf3wh7SmqJp-QV30';

const JSON_TOKEN_CLASSES: Record<JsonTokenType, string> = {
  key: 'text-rose-600',
  string: 'text-emerald-700',
  number: 'text-blue-600',
  boolean: 'text-purple-600',
  null: 'text-purple-600',
  plain: 'text-gray-400',
};

type ChipTone = 'good' | 'bad' | 'warn' | 'muted';

const CHIP_TONE_CLASSES: Record<ChipTone, string> = {
  good: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  bad: 'border-red-200 bg-red-50 text-red-600',
  warn: 'border-amber-200 bg-amber-50 text-amber-600',
  muted: 'border-gray-200 bg-gray-50 text-gray-500',
};

function CopyButton({ text, label = 'Copy', disabled }: { text: string; label?: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement('textarea');
      fallback.value = text;
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand('copy');
      document.body.removeChild(fallback);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 transition-all hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40',
        copied && 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:text-emerald-600'
      )}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

function StatusChip({ tone, icon, children }: { tone: ChipTone; icon: ReactNode; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider',
        CHIP_TONE_CLASSES[tone]
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Colorized header / payload / signature segments rendered behind the textarea. */
function TokenSegments({ token }: { token: string }) {
  if (!token) return null;
  const parts = token.split('.');
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          <span className={i === 0 ? 'text-rose-500' : i === 1 ? 'text-violet-500' : 'text-sky-500'}>{part}</span>
          {i < parts.length - 1 && <span className="text-gray-400">.</span>}
        </span>
      ))}
    </>
  );
}

function JsonBlock({ json }: { json: string }) {
  if (!json) {
    return <p className="p-5 text-xs italic text-gray-400">Nothing to decode yet — paste a token above.</p>;
  }
  return (
    <pre className="custom-scrollbar max-h-64 overflow-auto p-5 font-mono text-xs leading-relaxed">
      {tokenizeJson(json).map((token, i) => (
        <span key={i} className={JSON_TOKEN_CLASSES[token.type]}>
          {token.text}
        </span>
      ))}
    </pre>
  );
}

function ClaimsBreakdown({ claims }: { claims: ClaimInfo[] }) {
  if (claims.length === 0) {
    return <p className="text-xs italic text-gray-400">No claims to break down yet.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {claims.map((claim) => (
        <div key={claim.key} className="border-l-2 border-[#cba864]/50 pl-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <code className="font-mono text-xs font-bold text-gray-900">{claim.key}</code>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#b08d4f]">{claim.label}</span>
          </div>
          <div className="mt-0.5 break-all font-mono text-[11px] text-gray-700">{claim.display}</div>
          {claim.timeNote && (
            <div
              className={cn(
                'mt-0.5 text-[11px] font-semibold',
                claim.timeNoteTone === 'good' && 'text-emerald-600',
                claim.timeNoteTone === 'warn' && 'text-amber-600',
                claim.timeNoteTone === 'bad' && 'text-red-600'
              )}
            >
              {claim.timeNote}
            </div>
          )}
          <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{claim.description}</p>
        </div>
      ))}
    </div>
  );
}

function DecodedPanel({ title, json, claims }: { title: string; json: string; claims: ClaimInfo[] }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em]">{title}</h2>
        <CopyButton text={json} disabled={!json} />
      </div>
      <JsonBlock json={json} />
      <div className="border-t border-gray-100 px-5 py-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400">Claims Breakdown</h3>
          <CopyButton text={claimsBreakdownToText(claims)} disabled={claims.length === 0} />
        </div>
        <ClaimsBreakdown claims={claims} />
      </div>
    </motion.section>
  );
}
export default function JwtDebuggerPage() {
  const [token, setToken] = useState(EXAMPLE_TOKEN);
  const [algorithm, setAlgorithm] = useState<JwtAlgorithm>('HS256');
  const [autoFocusEnabled, setAutoFocusEnabled] = useState(false);
  const [secret, setSecret] = useState(EXAMPLE_JWT_SECRET);
  const [secretIsBase64Url, setSecretIsBase64Url] = useState(false);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const tokenInputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const parsed = useMemo(() => parseJwt(token), [token]);
  const kind = algorithmKind(algorithm);
  const keyNoun = kind === 'hmac' ? 'secret' : 'public key';

  const headerJson = parsed.header ? JSON.stringify(parsed.header, null, 2) : '';
  const payloadJson = parsed.payload ? JSON.stringify(parsed.payload, null, 2) : '';
  const headerClaims = useMemo(() => (parsed.header ? explainClaims(parsed.header) : []), [parsed.header]);
  const payloadClaims = useMemo(() => (parsed.payload ? explainClaims(parsed.payload) : []), [parsed.payload]);

  const trimmedToken = token.trim();
  const tokenEmpty = trimmedToken.length === 0;
  const segmentCount = tokenEmpty ? 0 : trimmedToken.split('.').length;

  const timeWarnings = useMemo(() => {
    const warnings: { text: string; tone: 'warn' | 'bad' }[] = [];
    const payload = parsed.payload;
    if (payload && typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      warnings.push({ text: 'This token has expired.', tone: 'bad' });
    }
    if (payload && typeof payload.nbf === 'number' && payload.nbf * 1000 > Date.now()) {
      warnings.push({ text: 'Not valid yet (nbf is in the future).', tone: 'warn' });
    }
    return warnings;
  }, [parsed.payload]);

  // Verify the signature (async, Web Crypto) whenever token / algorithm / key changes.
  useEffect(() => {
    if (tokenEmpty) {
      setVerification(null);
      setIsVerifying(false);
      return;
    }
    let cancelled = false;
    setIsVerifying(true);
    verifyJwtSignature(trimmedToken, algorithm, secret, secretIsBase64Url)
      .then((result) => {
        if (!cancelled) setVerification(result);
      })
      .catch(() => {
        if (!cancelled) setVerification({ status: 'error', message: 'Verification failed.' });
      })
      .finally(() => {
        if (!cancelled) setIsVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trimmedToken, tokenEmpty, algorithm, secret, secretIsBase64Url]);

  // Auto-select the algorithm declared in the token header (like jwt.io).
  useEffect(() => {
    const headerAlg = parsed.header && typeof parsed.header.alg === 'string' ? parsed.header.alg : null;
    if (headerAlg && JWT_ALGORITHMS.some((a) => a.value === headerAlg) && headerAlg !== algorithm) {
      setAlgorithm(headerAlg as JwtAlgorithm);
    }
  }, [parsed.header, algorithm]);

  // Focus the token box when auto-focus is enabled.
  useEffect(() => {
    if (autoFocusEnabled) tokenInputRef.current?.focus();
  }, [autoFocusEnabled]);

  const handleGenerateExample = async () => {
    setIsGenerating(true);
    try {
      const example = await generateExampleJwt();
      setToken(example.token);
      setSecret(example.secret);
      setAlgorithm(example.algorithm);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleTokenScroll = () => {
    if (highlightRef.current && tokenInputRef.current) {
      highlightRef.current.scrollTop = tokenInputRef.current.scrollTop;
      highlightRef.current.scrollLeft = tokenInputRef.current.scrollLeft;
    }
  };

  const tokenStatusChip = tokenEmpty
    ? null
    : parsed.isWellFormed
      ? (
          <StatusChip tone="good" icon={<CheckCircle2 size={13} />}>
            Valid JWT
          </StatusChip>
        )
      : (
          <StatusChip tone="bad" icon={<XCircle size={13} />}>
            Invalid JWT
          </StatusChip>
        );

  const signatureChip = (() => {
    if (tokenEmpty) return null;
    if (isVerifying) {
      return (
        <StatusChip tone="muted" icon={<Loader2 size={13} className="animate-spin" />}>
          Verifying…
        </StatusChip>
      );
    }
    if (!verification) return null;
    switch (verification.status) {
      case 'verified':
        return (
          <StatusChip tone="good" icon={<ShieldCheck size={13} />}>
            Signature Verified
          </StatusChip>
        );
      case 'unsigned':
        return (
          <StatusChip tone="muted" icon={<ShieldCheck size={13} />}>
            Unsigned (alg: none)
          </StatusChip>
        );
      case 'missing-key':
        return (
          <StatusChip tone="muted" icon={<KeyRound size={13} />}>
            Enter the {keyNoun} to verify
          </StatusChip>
        );
      case 'invalid':
        return (
          <StatusChip tone="bad" icon={<ShieldX size={13} />}>
            Signature Not Verified
          </StatusChip>
        );
      case 'invalid-token':
        return (
          <StatusChip tone="bad" icon={<ShieldX size={13} />}>
            Invalid token
          </StatusChip>
        );
      case 'error':
        return (
          <StatusChip tone="warn" icon={<ShieldX size={13} />}>
            Verification error
          </StatusChip>
        );
      default:
        return null;
    }
  })();

  const keyStatus = (() => {
    if (kind === 'none') {
      return { tone: 'muted' as ChipTone, text: 'The "none" algorithm is unsigned — there is no secret.' };
    }
    if (!secret.trim()) {
      return {
        tone: 'muted' as ChipTone,
        text: `Optional — enter the ${keyNoun} used to sign the JWT to verify its signature.`,
      };
    }
    if (isVerifying || !verification) return null;
    if (verification.status === 'verified') {
      return { tone: 'good' as ChipTone, text: `Valid ${keyNoun} — signature matches.` };
    }
    if (verification.status === 'invalid') {
      return { tone: 'bad' as ChipTone, text: `Invalid ${keyNoun} — the signature does not match.` };
    }
    if (verification.status === 'error') {
      return { tone: 'warn' as ChipTone, text: verification.message ?? 'Could not verify the signature.' };
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-[#f9f8f6] text-[#121212]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 transition-colors hover:text-[#121212]"
        >
          <ArrowLeft size={14} />
          Back to Lumiere
        </Link>

        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mt-8 text-center"
        >
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#121212] text-[#cba864] shadow-lg">
            <Braces size={26} />
          </div>
          <h1 className="luxury-text text-4xl font-bold tracking-tight sm:text-5xl">JWT Debugger</h1>
          <p className="mt-3 text-sm text-gray-500">
            Paste a JWT below that you'd like to decode, validate, and verify.
          </p>
          <div className="mx-auto mt-5 h-[2px] w-40 bg-gradient-to-r from-transparent via-[#cba864] to-transparent" />
          <p className="mt-4 text-[11px] text-gray-400">
            100% client-side — tokens and secrets never leave your browser.
          </p>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <label
              htmlFor="jwt-algorithm"
              className="block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400"
            >
              Select signing algorithm
            </label>
            <div className="relative mt-2">
              <select
                id="jwt-algorithm"
                value={algorithm}
                onChange={(e) => setAlgorithm(e.target.value as JwtAlgorithm)}
                className="w-full appearance-none rounded-xl border border-gray-200 bg-white py-3 pl-4 pr-10 text-sm font-semibold shadow-sm outline-none transition-colors focus:border-[#cba864] sm:w-96"
              >
                {JWT_ALGORITHMS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerateExample}
            disabled={isGenerating}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#cba864] px-5 py-3 text-xs font-bold uppercase tracking-[0.15em] text-white shadow-lg shadow-[#cba864]/30 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-[#cba864]/40 disabled:translate-y-0 disabled:opacity-60"
          >
            {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Generate example
          </button>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Encoded Token</h2>
              {tokenStatusChip}
              {timeWarnings.map((warning) => (
                <StatusChip key={warning.text} tone={warning.tone} icon={<XCircle size={13} />}>
                  {warning.text}
                </StatusChip>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-gray-500">
              <input
                type="checkbox"
                checked={autoFocusEnabled}
                onChange={(e) => setAutoFocusEnabled(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#cba864]"
              />
              <Focus size={12} />
              Enable auto-focus
            </label>
          </div>

          <div className="relative">
            <pre
              ref={highlightRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed"
            >
              <TokenSegments token={token} />
            </pre>
            <textarea
              ref={tokenInputRef}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onScroll={handleTokenScroll}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
              className="custom-scrollbar relative h-40 w-full resize-none whitespace-pre-wrap break-all bg-transparent p-4 font-mono text-xs leading-relaxed text-transparent caret-gray-900 outline-none placeholder:text-gray-400 selection:bg-[#cba864]/25"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3">
            <div className="flex items-center gap-2 text-[11px] text-gray-400">
              <span>
                {segmentCount} segment{segmentCount === 1 ? '' : 's'}
              </span>
              <span>·</span>
              <span>{trimmedToken.length} characters</span>
            </div>
            <div className="flex items-center gap-2">
              <CopyButton text={token} disabled={tokenEmpty} />
              <button
                type="button"
                onClick={() => {
                  setToken('');
                  setSecret('');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 transition-all hover:border-red-200 hover:text-red-500"
              >
                <Eraser size={12} />
                Clear
              </button>
            </div>
          </div>

          {parsed.errors.length > 0 && (
            <ul className="space-y-1.5 border-t border-red-100 bg-red-50/60 px-5 py-3">
              {parsed.errors.map((error) => (
                <li key={error} className="flex items-start gap-2 text-[11px] font-medium text-red-600">
                  <XCircle size={13} className="mt-0.5 flex-shrink-0" />
                  {error}
                </li>
              ))}
            </ul>
          )}
        </motion.section>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <DecodedPanel title="Decoded Header" json={headerJson} claims={headerClaims} />
          <DecodedPanel title="Decoded Payload" json={payloadJson} claims={payloadClaims} />
        </div>

        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.15em]">JWT Signature Verification</h2>
              {signatureChip}
            </div>
            {kind === 'hmac' && (
              <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold text-gray-500">
                <input
                  type="checkbox"
                  checked={secretIsBase64Url}
                  onChange={(e) => setSecretIsBase64Url(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[#cba864]"
                />
                Base64URL Encoded
              </label>
            )}
          </div>

          <div className="px-5 py-4">
            {kind === 'none' ? (
              <p className="text-xs text-gray-500">
                The "none" algorithm does not use a key — this token is unsigned.
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-500">
                  {kind === 'hmac'
                    ? '(Optional) Enter the secret used to sign the JWT below:'
                    : '(Optional) Paste the PEM public key used to sign the JWT below:'}
                </p>
                <label
                  htmlFor="jwt-key"
                  className="mb-1.5 mt-3 block text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400"
                >
                  {kind === 'hmac' ? 'Secret' : 'Public Key (PEM)'}
                </label>
                {kind === 'hmac' ? (
                  <input
                    id="jwt-key"
                    type="text"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full rounded-xl border border-gray-200 bg-[#f9f8f6] px-4 py-2.5 font-mono text-xs outline-none transition-colors focus:border-[#cba864]"
                  />
                ) : (
                  <textarea
                    id="jwt-key"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    spellCheck={false}
                    rows={5}
                    placeholder="-----BEGIN PUBLIC KEY-----&#10;…&#10;-----END PUBLIC KEY-----"
                    className="custom-scrollbar w-full resize-y rounded-xl border border-gray-200 bg-[#f9f8f6] p-4 font-mono text-xs outline-none transition-colors focus:border-[#cba864]"
                  />
                )}
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                  {keyStatus ? (
                    <p
                      className={cn(
                        'text-[11px] font-semibold',
                        keyStatus.tone === 'good' && 'text-emerald-600',
                        keyStatus.tone === 'bad' && 'text-red-600',
                        keyStatus.tone === 'warn' && 'text-amber-600',
                        keyStatus.tone === 'muted' && 'text-gray-400'
                      )}
                    >
                      {keyStatus.text}
                    </p>
                  ) : (
                    <span />
                  )}
                  <div className="flex items-center gap-2">
                    <CopyButton text={secret} disabled={!secret} />
                    <button
                      type="button"
                      onClick={() => setSecret('')}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 transition-all hover:border-red-200 hover:text-red-500"
                    >
                      <Eraser size={12} />
                      Clear
                    </button>
                  </div>
                </div>
                {verification?.status === 'error' && verification.message && keyStatus?.tone !== 'warn' && (
                  <p className="mt-2 text-[11px] font-medium text-amber-600">{verification.message}</p>
                )}
              </>
            )}
          </div>
        </motion.section>

        <footer className="mt-10 text-center text-[11px] leading-relaxed text-gray-400">
          Decoding and signature verification run entirely in your browser via the Web Crypto API.
          <br />
          Nothing is ever sent to a server.
        </footer>
      </div>
    </div>
  );
}

