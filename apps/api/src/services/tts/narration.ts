import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AnalysisResult } from '@sniffo/shared';

const MAX_SCRIPT_LENGTH = 400;
const TOKEN_TTL_MS = 15 * 60 * 1000;

const findingPhrases: Record<string, string> = {
  R01: 'payment was requested outside the booking platform',
  R02: 'a payment method that may be hard to reverse was requested',
  R03: 'payment was requested before a viewing or written terms',
  R04: 'the message applies pressure to pay quickly',
  R05: 'a payment or verification link needs independent checking',
  R06: 'price details differ between supplied sources',
  R07: 'location details differ between supplied sources',
  R08: 'property details differ between supplied sources',
  R09: 'fee details differ between supplied sources',
};

/** Redacts common personal and payment identifiers before text can be narrated. */
export function sanitizeNarrationText(value: string): string {
  const withoutControls = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
      ? ' '
      : character;
  }).join('');
  return withoutControls
    .replace(/(?:https?:\/\/|www\.)[^\s<>()]+/gi, 'a web link')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, 'an email address')
    .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, 'a phone number')
    .replace(
      /\b(?:account|bank|routing|promptpay|iban)[\s:#-]*[A-Z0-9-]{5,}\b/gi,
      'payment details',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

type NarratableReport = {
  findings: AnalysisResult['findings'];
  redFlagScore?: Pick<
    NonNullable<AnalysisResult['redFlagScore']>,
    'status' | 'valueOutOf10'
  >;
};

export function buildReportNarration(report: NarratableReport): string {
  const concerns = report.findings.filter(
    (finding) =>
      finding.category !== 'unable_to_verify' &&
      finding.ruleId !== 'R12' &&
      Boolean(finding.ruleId && findingPhrases[finding.ruleId]),
  );
  if (concerns.length) {
    const supported = concerns.filter(
      (finding) => finding.category === 'confirmed_inconsistency',
    ).length;
    const potential = concerns.length - supported;
    const count = concerns.length;
    const headline =
      supported && potential
        ? `${count} issues that need review`
        : supported
          ? `${count} supported ${count === 1 ? 'inconsistency' : 'inconsistencies'}`
          : `${count} potential ${count === 1 ? 'warning sign' : 'warning signs'}`;
    const descriptions = [
      ...new Set(
        concerns
          .map((finding) => findingPhrases[finding.ruleId!])
          .filter(Boolean),
      ),
    ].slice(0, 2);
    const detail = descriptions
      .map((description) => {
        const finding = concerns.find(
          (candidate) => findingPhrases[candidate.ruleId!] === description,
        );
        return finding?.category === 'confirmed_inconsistency'
          ? `The submitted sources show that ${description}.`
          : `A possible warning sign is that ${description}.`;
      })
      .join(' ');
    const script = `Sniffo found ${headline} in the supplied information. ${detail} This does not establish fraud or which source is correct. Review the cited evidence and verify the details before making any payment.`;
    return clampScript(script);
  }

  if (
    report.redFlagScore?.status !== 'scored' ||
    report.redFlagScore.valueOutOf10 === null
  )
    return clampScript(
      'Sniffo could not verify enough information to provide a reliable risk score. No conclusion about the property’s legitimacy can be made from the available evidence. Review the listing and verify payment instructions before sending money.',
    );

  return clampScript(
    'Sniffo did not detect warning signs in the information reviewed. This does not guarantee the listing is genuine. Review the available evidence and verify the property and payment details before sending money.',
  );
}

function clampScript(value: string): string {
  const sanitized = sanitizeNarrationText(value);
  if (sanitized.length <= MAX_SCRIPT_LENGTH) return sanitized;
  return sanitized.slice(0, MAX_SCRIPT_LENGTH - 1).trimEnd() + '.';
}

type NarrationTokenPayload = {
  v: 1;
  exp: number;
  nonce: string;
  transcript: string;
};

export function issueNarrationToken(
  transcript: string,
  secret: string,
  now = Date.now(),
): string {
  const safeTranscript = clampScript(transcript);
  const payload: NarrationTokenPayload = {
    v: 1,
    exp: now + TOKEN_TTL_MS,
    nonce: randomBytes(12).toString('base64url'),
    transcript: safeTranscript,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyNarrationToken(
  token: string,
  secret: string,
  now = Date.now(),
): string | null {
  if (token.length > 2048) return null;
  const [encoded, suppliedSignature, extra] = token.split('.');
  if (!encoded || !suppliedSignature || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(encoded).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(suppliedSignature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<NarrationTokenPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.exp !== 'number' ||
      payload.exp <= now ||
      typeof payload.nonce !== 'string' ||
      typeof payload.transcript !== 'string' ||
      payload.transcript.length < 1 ||
      payload.transcript.length > MAX_SCRIPT_LENGTH ||
      sanitizeNarrationText(payload.transcript) !== payload.transcript
    )
      return null;
    return payload.transcript;
  } catch {
    return null;
  }
}

export const narrationLimits = {
  maxCharacters: MAX_SCRIPT_LENGTH,
  tokenTtlMs: TOKEN_TTL_MS,
};
