import type { ResearchResult } from '@sniffo/shared';
import { normalize } from '../verification/claims.js';
import type { Identity, PropertyProfile } from './profile.js';

export function compareProfiles(
  a: PropertyProfile,
  b: PropertyProfile,
  identity: Identity,
): ResearchResult['comparisons'] {
  const eligible = ['exact_listing', 'likely_same_property'].includes(identity);
  const comparisons: ResearchResult['comparisons'] = [];
  for (const field of [
    'location',
    'address',
    'propertyType',
    'bedroomCount',
    'bathroomCount',
    'maxGuests',
    'bedCount',
    'areaSquareMeters',
    'depositAmount',
    'price',
  ]) {
    const left = a.facts.find((f) => f.fieldName === field),
      right = b.facts.find((f) => f.fieldName === field);
    if (!left && !right) continue;
    const base = {
      field,
      sourceId: a.source.id,
      candidateId: b.source.id,
      sourceQuote: left?.quotedEvidence ?? '',
      candidateQuote: right?.quotedEvidence ?? '',
    };
    if (!eligible || !left || !right) {
      comparisons.push({
        ...base,
        status: 'unable_to_verify',
        explanation: !eligible
          ? 'Property identity is not confirmed; this is a research lead.'
          : 'One source does not disclose this field.',
      });
      continue;
    }
    if (
      a.transaction === 'unknown' ||
      a.transaction !== b.transaction ||
      (a.privacy && b.privacy && a.privacy !== b.privacy)
    ) {
      comparisons.push({
        ...base,
        status: 'not_comparable',
        explanation: 'Transaction or accommodation context does not match.',
      });
      continue;
    }
    const x = normalize(
        typeof left.normalizedValue === 'object'
          ? JSON.stringify(left.normalizedValue)
          : left.normalizedValue,
      ),
      y = normalize(
        typeof right.normalizedValue === 'object'
          ? JSON.stringify(right.normalizedValue)
          : right.normalizedValue,
      );
    if (field === 'price' || field === 'depositAmount') {
      const p = a.prices.find(
          (p) =>
            p.role !== 'original' &&
            (field !== 'depositAmount' || p.basis === 'deposit'),
        ),
        q = b.prices.find(
          (p) =>
            p.role !== 'original' &&
            (field !== 'depositAmount' || p.basis === 'deposit'),
        );
      const compatible =
        p &&
        q &&
        p.currency &&
        p.currency === q.currency &&
        p.basis !== 'unknown' &&
        p.basis === q.basis &&
        p.basisExplicit &&
        q.basisExplicit &&
        p.includesFees !== undefined &&
        p.includesFees !== null &&
        p.includesFees === q.includesFees &&
        p.unitId &&
        p.unitId === q.unitId &&
        p.roomVariant === q.roomVariant &&
        !p.discountPresent &&
        !q.discountPresent &&
        p.role !== 'ambiguous' &&
        q.role !== 'ambiguous' &&
        (p.basis === 'monthly_rent' ||
          (p.checkIn &&
            p.checkOut &&
            p.checkIn === q.checkIn &&
            p.checkOut === q.checkOut &&
            p.guestCount &&
            p.guestCount === q.guestCount));
      comparisons.push({
        ...base,
        status: !compatible
          ? 'not_comparable'
          : p.amount === q.amount
            ? 'corroborated'
            : 'potential_inconsistency',
        explanation: !compatible
          ? 'Price, fee inclusion, unit or booking context is not fully comparable. Dynamic offers and deposits require confirmation.'
          : 'Comparable advertised prices; differences are leads for confirmation and do not automatically affect scoring.',
      });
      continue;
    }
    if (
      field === 'propertyType' &&
      (a.category === 'unknown' || b.category === 'unknown')
    )
      comparisons.push({
        ...base,
        status: 'not_comparable',
        explanation: 'Property category is not sufficiently clear.',
      });
    else if (x === y || (field === 'propertyType' && a.category === b.category))
      comparisons.push({
        ...base,
        status: 'corroborated',
        explanation:
          'The two source claims agree. Matching advertisements do not establish ownership or truth.',
      });
    else if (['location', 'address'].includes(field))
      comparisons.push({
        ...base,
        status:
          x.includes(y) || y.includes(x)
            ? 'corroborated'
            : 'potential_inconsistency',
        explanation:
          'Location detail may vary in precision; confirm the exact address independently.',
      });
    else
      comparisons.push({
        ...base,
        status: 'confirmed_inconsistency',
        explanation:
          'Explicit field claims differ in sources strongly identifying the same property. This confirms a claim difference, not fraud.',
      });
  }
  return comparisons;
}
