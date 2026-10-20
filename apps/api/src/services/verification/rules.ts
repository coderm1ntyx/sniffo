import { domainToUnicode } from 'node:url';
import { getDomain } from 'tldts';
import type { EvidenceSource, Finding, PriceRecord } from '@sniffo/shared';
import { stableId } from '../evidenceIntegrity.js';
import {
  LIMITS,
  normalize,
  type Claim,
  type ClaimContext,
  type Statement,
} from './claims.js';

export const actions: Record<string, string> = {
  R01: 'Keep payment within the original booking platform. Contact platform support before transferring money.',
  R02: 'Avoid irreversible payment methods until you independently verify the recipient and written rental terms.',
  R03: 'Request a written agreement and verify the property and payment recipient before sending funds.',
  R04: 'Do not let a payment deadline prevent verification. Ask for time to review the terms.',
  R05: 'Open the booking platform directly rather than using the supplied payment or verification link.',
  R06: 'Ask for an itemized price breakdown for the same dates, guest count, currency, and fee basis.',
  R07: 'Confirm the exact property location through an independent source before paying.',
  R08: 'Ask the host to clarify the same unit’s configuration and update the written agreement.',
  R09: 'Request an itemized list of mandatory fees and deposit conditions.',
  R12: 'Add independent confirmation or written booking terms to improve verification coverage.',
};
type RuleId = NonNullable<Finding['ruleId']>;
export type RuleEvaluation = {
  findings: Finding[];
  comparisonCount: number;
  linksProcessed: number;
  limited: boolean;
  evaluations: Record<string, number>;
};
export function runRules(
  claims: Claim[],
  statements: Statement[],
  contexts: Map<string, ClaimContext>,
  sources: EvidenceSource[],
): RuleEvaluation {
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let comparisonCount = 0;
  let linksProcessed = 0;
  let limited = false;
  const evaluations = Object.fromEntries(
    ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R12'].map(
      (r) => [r, 0],
    ),
  );
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const fingerprints = new Map(
    sources.map((s) => [
      s.id,
      stableId(
        normalize(s.extractedText),
        s.normalizedFacts?.map((f) => [
          f.fieldName,
          f.normalizedValue,
          f.quotedEvidence,
        ]),
      ),
    ]),
  );
  function emit(
    ruleId: RuleId,
    title: string,
    description: string,
    refs: Claim[],
    statement?: Statement,
    severity: Finding['severity'] = 'high',
    field?: string,
  ) {
    const category =
      ruleId === 'R12'
        ? 'unable_to_verify'
        : ['R06', 'R07', 'R08', 'R09'].includes(ruleId)
          ? 'confirmed_inconsistency'
          : 'potential_warning_sign';
    refs = refs.slice(0, 12);
    const evidence: NonNullable<Finding['evidence']> = refs.map((c) => ({
      sourceId: c.sourceId,
      factId: c.factId,
      quote: c.quote,
      structuredPath: c.structuredPath,
      claimId: c.id,
    }));
    if (statement)
      evidence.push({
        sourceId: statement.source.id,
        quote: statement.quote,
        factId: undefined,
        structuredPath: undefined,
        claimId: undefined,
      });
    const key = stableId(
      ruleId,
      field ?? '',
      evidence.map((e) => normalize(e.quote)).sort(),
    );
    if (seen.has(key)) return;
    if (findings.length >= LIMITS.findings - 1) {
      limited = true;
      return;
    }
    seen.add(key);
    const issueGroup = statement
      ? `payment-${stableId(statement.issueKey ?? normalize(statement.quote))}`
      : `comparison-${stableId(ruleId === 'R08' ? 'property' : field, ruleId === 'R08' ? [...new Set(evidence.map((e) => e.sourceId))].sort() : evidence.map((e) => normalize(e.quote)).sort())}`;
    const quotes = statement
      ? ` Evidence: “${statement.quote}” (line ${statement.line}).`
      : refs
          .map(
            (c) =>
              ` ${sourceMap.get(c.sourceId)?.name ?? 'Evidence'}: ${formatValue(c.normalizedValue)} based on “${c.quote}”.`,
          )
          .join('');
    findings.push({
      id: `finding-${key}`,
      ruleId,
      category,
      severity,
      title,
      description: description + quotes,
      referencedEvidence: [...new Set(evidence.map((e) => e.sourceId))],
      referencedFactIds: [
        ...new Set(refs.flatMap((c) => (c.factId ? [c.factId] : []))),
      ],
      evidence,
      affectedField: field,
      issueGroup,
      recommendedAction: actions[ruleId]!,
    });
  }
  for (const statement of statements) {
    if (!statement.actionable) continue;
    const q = statement.quote;
    const request =
      /\b(?:pay|send|transfer|wire|deposit|payment (?:must|is required)|upload|verify|must (?:use|buy)|buy .{0,20}gift)\b|โอน|จ่าย|ชำระ|ส่ง.*เงิน|送金|支払|払って|입금|송금|결제|转账|付款|支付/.test(
        q.toLowerCase(),
      );
    if (!request) continue;
    const directInstruction =
      /\b(?:please|must|send|pay|transfer|wire|buy|use|upload|verify|deposit (?:is|must)|payment (?:is required|must))\b|โอน|จ่าย|ชำระ|送金|支払|払って|입금|송금|결제|转账|付款|支付/i.test(
        q,
      );
    if (
      !directInstruction ||
      /\b(?:optional|can also|may choose|may pay|can pay|if preferred|available after signing)\b/i.test(
        q,
      )
    )
      continue;
    evaluations.R01!++;
    const platform = statement.context.platform;
    const bypass =
      /outside\s+(?:airbnb|booking\.com|agoda|the (?:booking )?platform)|(?:don['’]t|do not|cancel|avoid|instead of).{0,45}(?:through|on|using)?\s*(?:airbnb|booking\.com|agoda)|(?:book|booking).{0,35}(?:airbnb|booking\.com|agoda).{0,65}(?:directly|privately)|(?:platform|airbnb).{0,35}(?:broken|not working).{0,80}(?:bank|direct)|(?:pay|send|transfer).{0,55}(?:directly|privately|my bank account|whatsapp).{0,35}(?:instead|outside)|(?:airbnb|แพลตฟอร์ม).{0,30}(?:นอก|โดยตรง)|(?:โอน|จ่าย).{0,35}นอก.{0,20}(?:airbnb|แพลตฟอร์ม)|(?:Airbnb|エアビー).{0,20}外.{0,30}(?:送金|支払)|(?:에어비앤비|Airbnb).{0,20}(?:밖|외부).{0,30}(?:송금|결제)|(?:Airbnb|爱彼迎).{0,20}(?:外|绕过).{0,30}(?:转账|付款)/i.test(
        q,
      );
    const contextualDirect =
      platform &&
      /(?:pay|transfer|send).{0,45}(?:me directly|me privately|my bank account)|(?:โอน|จ่าย).{0,20}โดยตรง/i.test(
        q,
      );
    if ((bypass || contextualDirect) && platform)
      emit(
        'R01',
        'Payment requested outside the booking platform',
        'The source requests bypassing the established booking channel, which can reduce payment protections. This is a warning sign, not a finding of fraud.',
        [],
        statement,
        'critical',
        'paymentChannel',
      );
    evaluations.R02!++;
    const risky =
      /gift cards?|crypto(?:currency)?|bitcoin|USDT|western union|moneygram|บัตรของขวัญ|คริปโต|暗号資産|暗号通貨|ギフトカード|기프트\s*카드|암호화폐|礼品卡|加密货币/i.test(
        q,
      );
    const suspiciousTransfer =
      /wire|bank transfer|remittance|transfer|cash/i.test(q) &&
      /no receipt|won['’]t (?:give|provide).{0,10}receipt|unrelated (?:third.party|account)|friend['’]?s account|irreversible|cannot be reversed/i.test(
        q,
      );
    if (risky || suspiciousTransfer)
      emit(
        'R02',
        'High-risk payment method requested',
        'The source requests an unusually difficult-to-reverse payment or an unrelated recipient. Verify the transaction before paying.',
        [],
        statement,
        risky ? 'high' : 'medium',
        'paymentMethod',
      );
    evaluations.R03!++;
    const withheld =
      /(?:pay|send|transfer|deposit).{0,75}before (?:i (?:show|send|provide)|(?:a |the )?(?:viewing|seeing|agreement|contract|property details|verification))|(?:agreement|contract|receipt|full address|proof of ownership).{0,60}(?:only|provided|sent|shared|available).{0,35}after.{0,35}(?:pay|payment|transfer|deposit)|(?:won['’]t|will not|no).{0,35}(?:show|provide|viewing|details|agreement).{0,45}(?:until|unless).{0,30}(?:pay|transfer)|(?:pay|send|transfer).{0,60}(?:no viewing|no verification)|(?:pay|send).{0,50}(?:now|holding fee).{0,40}no viewing/i.test(
        q,
      );
    if (withheld)
      emit(
        'R03',
        'Payment requested before a viewing',
        'Payment is made a condition of reviewing the property or written terms. Standard platform prepayment alone is not treated as suspicious.',
        [],
        statement,
        'high',
        'verificationBeforePayment',
      );
    evaluations.R04!++;
    const deadline =
      /(?:within|in|have)\s+(?:\d+|one|an?|thirty|sixty)\s*(?:minutes?|hours?)|immediately|right now|pay now|lose (?:the|this|your) (?:room|booking|unit)|no time (?:for|to)|do not ask questions|ภายใน.{0,15}(?:นาที|ชั่วโมง)|เดี๋ยวนี้|今すぐ|\d+分以内|1時間以内|지금|한 시간|\d+분 이내|立即|马上|一小时|\d+分钟/i.test(
        q,
      );
    const normal =
      /check.in closes|office closes|free cancellation|promotional|discount expires|arrival time|cancellation policy/i.test(
        q,
      );
    if (deadline && !normal)
      emit(
        'R04',
        'Payment demand uses a coercive deadline',
        'A short payment deadline or refusal to allow questions can prevent reasonable verification.',
        [],
        statement,
        'medium',
        'paymentDeadline',
      );
    evaluations.R05!++;
    const links = q.match(/(?:https?:\/\/|www\.)[^\s<>"”]+/giu) ?? [];
    for (const raw of links) {
      if (linksProcessed >= LIMITS.links) {
        limited = true;
        break;
      }
      linksProcessed++;
      const link = raw.replace(/[),.;!?]+$/, '');
      let url: URL;
      try {
        url = new URL(link.startsWith('www.') ? `https://${link}` : link);
      } catch {
        continue;
      }
      if (
        !/pay|deposit|verif|upload|passport|identity|ชำระ|โอน|ยืนยัน|支払|送金|결제|송금|付款|支付/i.test(
          q,
        )
      )
        continue;
      const host = url.hostname.toLowerCase().replace(/\.$/, '');
      const domain = getDomain(host, { allowPrivateDomains: true });
      const unicode = domainToUnicode(host);
      const official =
        domain && ['airbnb.com', 'booking.com', 'agoda.com'].includes(domain);
      const shortener =
        domain &&
        ['bit.ly', 'tinyurl.com', 't.co', 'shorturl.at', 'is.gd'].includes(
          domain,
        );
      const brandText = unicode
        .replace(/[аɑ]/g, 'a')
        .replace(/[іı]/g, 'i')
        .replace(/[оο]/g, 'o')
        .replace(/[еε]/g, 'e')
        .replace(/[Ьь]/g, 'b');
      const brand = /airbnb|booking|agoda/.test(host + ' ' + brandText);
      const claimedOfficial =
        /official|platform payment|airbnb payment|booking\.com payment|agoda payment/i.test(
          q,
        );
      const bad =
        (!official && (brand || shortener || (claimedOfficial && platform))) ||
        Boolean(url.username || url.password) ||
        url.protocol !== 'https:';
      if (bad)
        emit(
          'R05',
          'Check the payment or verification link',
          `The payment destination ${host} ${brand && !official ? 'resembles or names a booking platform without using its official registered domain' : shortener ? 'conceals its destination behind a short link' : 'uses an unsafe scheme, embedded credentials, or conflicts with the claimed official channel'}. The destination was not visited.`,
          [],
          statement,
          (brand && !official) || (claimedOfficial && !official)
            ? 'critical'
            : 'high',
          'paymentLink',
        );
    }
  }
  const trusted = claims.filter((c) => c.provenance !== 'user_assertion');
  const groups = new Map<string, Claim[]>();
  for (const c of trusted) {
    const key =
      c.field === 'price'
        ? `price:${(c.normalizedValue as PriceRecord).basis}`
        : c.field;
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  // Each field is bounded by the shared global comparison budget. Once exhausted, report partial coverage.
  function pairs(group: Claim[], evaluate: (a: Claim, b: Claim) => void) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) {
        if (comparisonCount >= LIMITS.comparisons) {
          limited = true;
          return;
        }
        comparisonCount++;
        const a = group[i]!;
        const b = group[j]!;
        if (a.sourceId === b.sourceId || !sameUnit(a.context, b.context))
          continue;
        if (fingerprints.get(a.sourceId) === fingerprints.get(b.sourceId))
          continue;
        evaluate(a, b);
      }
  }
  const money = trusted.filter((c) => c.field === 'price');
  const conflicts = new Map<string, Claim[]>();
  const record = (key: string, a: Claim, b: Claim) =>
    conflicts.set(key, [
      ...new Map(
        [...(conflicts.get(key) ?? []), a, b].map((c) => [c.id, c]),
      ).values(),
    ]);
  for (const [key, group] of groups) {
    if (key.startsWith('price:')) {
      const basis = key.slice(6);
      if (
        ![
          'monthly_rent',
          'nightly_rate',
          'weekly_rate',
          'stay_total',
          'deposit',
          'cleaning_fee',
          'service_fee',
          'other_fee',
        ].includes(basis)
      )
        continue;
      const ruleId = [
        'deposit',
        'cleaning_fee',
        'service_fee',
        'other_fee',
      ].includes(basis)
        ? 'R09'
        : 'R06';
      pairs(group, (a, b) => {
        evaluations[ruleId]!++;
        const left = a.normalizedValue as PriceRecord;
        const right = b.normalizedValue as PriceRecord;
        if (!comparablePrices(left, right, a.context, b.context)) return;
        const range = (c: Claim, price: PriceRecord) => {
          const val = (field: string) =>
            trusted.find((f) => f.sourceId === c.sourceId && f.field === field)
              ?.normalizedValue;
          return price.basis === 'monthly_rent'
            ? [
                Number(val('monthlyRentMin') ?? price.amount),
                Number(val('monthlyRentMax') ?? price.amount),
              ]
            : [price.amount, price.amount];
        };
        const [al, ah] = range(a, left);
        const [bl, bh] = range(b, right);
        if (
          Math.round(ah! * 100) + 100 < Math.round(bl! * 100) ||
          Math.round(bh! * 100) + 100 < Math.round(al! * 100)
        )
          record(`${ruleId}:${basis}`, a, b);
      });
    } else if (
      key.startsWith('amenity:') ||
      [
        'bedroomCount',
        'bathroomCount',
        'bedCount',
        'maxGuests',
        'privacyType',
        'bookingType',
        'propertyType',
        'roomType',
      ].includes(key)
    ) {
      pairs(group, (a, b) => {
        evaluations.R08!++;
        if (a.context.scope !== 'unit' || b.context.scope !== 'unit') return;
        // A private room's larger property's counts and unspecified hotel variants are ambiguous.
        if (
          a.context.privacy === 'private room' ||
          b.context.privacy === 'private room'
        ) {
          if (
            key !== 'privacyType' &&
            key !== 'bookingType' &&
            !(a.context.unitId && b.context.unitId)
          )
            return;
        }
        const left = detailValue(a.normalizedValue, key);
        const right = detailValue(b.normalizedValue, key);
        if (!left || !right || left === right) return;
        if (
          key === 'propertyType' &&
          (!['apartment', 'house', 'hotel'].includes(left) ||
            !['apartment', 'house', 'hotel'].includes(right))
        )
          return;
        record(`R08:${key}`, a, b);
      });
    } else if (['city', 'country', 'address'].includes(key)) {
      pairs(group, (a, b) => {
        evaluations.R07!++;
        if (
          a.context.addressRole === 'business' ||
          b.context.addressRole === 'business'
        )
          return;
        const countries: Record<string, string> = {
          th: 'thailand',
          thai: 'thailand',
          ไทย: 'thailand',
          ประเทศไทย: 'thailand',
          us: 'united states',
          usa: 'united states',
          'united states of america': 'united states',
          uk: 'united kingdom',
          gb: 'united kingdom',
          jp: 'japan',
          日本: 'japan',
          kr: 'south korea',
          대한민국: 'south korea',
          cn: 'china',
          中国: 'china',
        };
        const av =
          key === 'country'
            ? (countries[normalize(a.normalizedValue)] ??
              normalize(a.normalizedValue))
            : normalize(a.normalizedValue);
        const bv =
          key === 'country'
            ? (countries[normalize(b.normalizedValue)] ??
              normalize(b.normalizedValue))
            : normalize(b.normalizedValue);
        if (!av || !bv || av === bv || av.includes(bv) || bv.includes(av))
          return;
        const cities = (s: string) =>
          s
            .match(/bangkok|chiang mai|tokyo|osaka|seoul|busan|london|paris/gi)
            ?.map(normalize) ?? [];
        const ac = cities(av);
        const bc = cities(bv);
        const explicitCityConflict =
          ac.length === 1 && bc.length === 1 && ac[0] !== bc[0];
        const streetA = av.match(/^(\d+) (.+)/);
        const streetB = bv.match(/^(\d+) (.+)/);
        const streetConflict =
          streetA &&
          streetB &&
          streetA[2] === streetB[2] &&
          streetA[1] !== streetB[1];
        if (
          key === 'country' ||
          key === 'city' ||
          explicitCityConflict ||
          streetConflict
        )
          record(`R07:${key}`, a, b);
      });
    }
  }
  // Location labels may contain a district and parent city: compare only recognized city claims.
  const locations = trusted
    .filter((c) => ['location', 'address', 'city'].includes(c.field))
    .map((c) => {
      const city = normalize(c.normalizedValue).match(
        /\b(bangkok|chiang mai|tokyo|osaka|seoul|busan|london|paris)\b/,
      )?.[1];
      return city ? { ...c, normalizedValue: city } : null;
    })
    .filter((c) => c !== null);
  pairs(locations, (a, b) => {
    if (
      a.context.addressRole !== 'business' &&
      b.context.addressRole !== 'business' &&
      a.normalizedValue !== b.normalizedValue
    )
      record('R07:location', a, b);
  });
  for (const [policyField, basis] of [
    ['depositPolicy', 'deposit'],
    ['cleaningPolicy', 'cleaning_fee'],
  ] as const) {
    for (const policy of trusted.filter((c) => c.field === policyField)) {
      pairs(
        [
          policy,
          ...money.filter(
            (c) => (c.normalizedValue as PriceRecord).basis === basis,
          ),
        ],
        (a, b) => {
          if (a.field !== policyField) return;
          evaluations.R09!++;
          const price = b.normalizedValue as PriceRecord;
          if (
            policyField === 'depositPolicy' &&
            price.feeType === 'holding_deposit'
          )
            return;
          if (
            price.amount <= 0 ||
            !price.mandatory ||
            price.recurring !== 'one_time'
          )
            return;
          if (
            policyField === 'cleaningPolicy' &&
            !/additional|extra|excluded|excluding/i.test(b.quote)
          )
            return;
          record(`R09:${basis}`, a, b);
        },
      );
    }
  }
  for (const [key, refs] of conflicts) {
    const [rule, field] = key.split(':') as [RuleId, string];
    const label =
      field === 'monthly_rent'
        ? 'monthly rent'
        : field === 'deposit'
          ? 'deposit'
          : field === 'address'
            ? 'address'
            : field
                .replace(/([A-Z])/g, ' $1')
                .replaceAll('_', ' ')
                .toLowerCase();
    // One location issue can be discovered from multiple normalized levels.
    if (rule === 'R07' && findings.some((f) => f.ruleId === 'R07')) continue;
    emit(
      rule,
      `Different ${label} details`,
      'Comparable claims in the submitted evidence disagree. This establishes an inconsistency between those claims, not which source is true.',
      refs,
      undefined,
      'high',
      field,
    );
  }
  return { findings, comparisonCount, linksProcessed, limited, evaluations };
}
export function sameUnit(a: ClaimContext, b: ClaimContext) {
  if (a.ambiguousProperty || b.ambiguousProperty) return false;
  if (a.unitId && b.unitId && a.unitId !== b.unitId) return false;
  if (a.roomVariant !== b.roomVariant && (a.roomVariant || b.roomVariant))
    return false;
  if (
    (a.rentalType === 'hotel' || b.rentalType === 'hotel') &&
    (!a.roomVariant || !b.roomVariant)
  )
    return false;
  return true;
}
export function comparablePrices(
  a: PriceRecord,
  b: PriceRecord,
  ac: ClaimContext,
  bc: ClaimContext,
) {
  if (
    !a.basisExplicit ||
    !b.basisExplicit ||
    a.basis !== b.basis ||
    !a.currency ||
    a.currency !== b.currency
  )
    return false;
  if (
    a.role === 'original' ||
    b.role === 'original' ||
    a.role === 'ambiguous' ||
    b.role === 'ambiguous' ||
    a.estimate ||
    b.estimate
  )
    return false;
  for (const field of [
    'checkIn',
    'checkOut',
    'guestCount',
    'unitId',
    'roomVariant',
  ] as const)
    if (
      a[field] !== b[field] &&
      (a[field] !== undefined || b[field] !== undefined)
    )
      return false;
  if (a.includesFees !== b.includesFees) return false;
  if (
    a.basis === 'stay_total' &&
    (!a.nights ||
      a.nights !== b.nights ||
      !a.checkIn ||
      !a.checkOut ||
      a.includesFees === null ||
      b.includesFees === null)
  )
    return false;
  if (
    ['deposit', 'cleaning_fee', 'service_fee', 'other_fee'].includes(a.basis) &&
    (a.mandatory !== b.mandatory ||
      a.recurring !== b.recurring ||
      a.feeType !== b.feeType)
  )
    return false;
  return sameUnit(ac, bc);
}
function detailValue(value: unknown, field: string) {
  const text = normalize(value);
  if (field === 'propertyType') {
    if (/apartment|condo|flat|entire rental unit/.test(text))
      return 'apartment';
    if (/house|villa/.test(text)) return 'house';
    if (/hotel|serviced apartment/.test(text)) return 'hotel';
  }
  return text
    .replace(/\broom\b/g, '')
    .replace(/entire home|entire rental unit/g, 'entire place')
    .trim();
}
function formatValue(value: unknown): string {
  if (value && typeof value === 'object' && 'amount' in value) {
    const p = value as PriceRecord;
    return `${p.currency ?? ''} ${p.amount.toLocaleString('en-US')} (${p.basis})`;
  }
  return String(value);
}
