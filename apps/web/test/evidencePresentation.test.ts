import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evidenceFieldLabel,
  cleanSourceUrl,
  formatCurrencyCode,
  formatEvidenceDate,
  formatEvidenceValue,
  groupSourceEvidenceFacts,
  sourcePlatformLabel,
} from '../src/components/report/evidencePresentation';

test('formats common extracted evidence values for the summary', () => {
  assert.equal(
    formatCurrencyCode({ serverDeterminedCurrency: 'THB' }),
    'THB — Thai Baht',
  );
  assert.equal(formatEvidenceDate('2026-10-31'), 'Oct 31, 2026');
  assert.equal(
    formatEvidenceValue(
      { checkIn: '2026-10-31', checkOut: '2026-11-05', nights: 5 },
      'bookingContext',
    ),
    'Oct 31, 2026 – Nov 5, 2026 · 5 nights',
  );
});

test('humanizes source fact labels and keeps long URLs out of summary values', () => {
  assert.equal(evidenceFieldLabel('review Count'), 'Reviews');
  assert.equal(evidenceFieldLabel('booking Context'), 'Booking dates');
  assert.equal(evidenceFieldLabel('house Rule'), 'House rules');
  assert.equal(
    formatEvidenceValue('https://www.airbnb.com/rooms/123?check_in=2026-10-31'),
    null,
  );
  assert.equal(
    formatEvidenceValue(
      'https://www.airbnb.com/rooms/123?check_in=2026-10-31&check_out=2026-11-05',
      'bookingContext',
    ),
    'Oct 31, 2026 – Nov 5, 2026',
  );
  assert.equal(
    sourcePlatformLabel('Property listing', 'https://www.airbnb.com/rooms/123'),
    'Airbnb [Property listing]',
  );
  assert.equal(
    cleanSourceUrl(
      'https://www.airbnb.com/rooms/123?check_in=2026-10-31&check_out=2026-11-05&amenities%5B%5D=8&source_impression_id=abc&utm_campaign=demo&listing_id=123',
    ),
    'https://www.airbnb.com/rooms/123?listing_id=123',
  );
});

test('groups large photo, amenity, and house-rule collections without discarding items', () => {
  const facts = [
    ...Array.from({ length: 45 }, (_, index) => ({
      id: `photo-${index}`,
      sourceId: 'listing',
      fieldName: 'listingImage',
      normalizedValue: `https://images.example/${index}.jpg`,
      quotedEvidence: `Photo ${index}`,
    })),
    ...Array.from({ length: 60 }, (_, index) => ({
      id: `amenity-${index}`,
      sourceId: 'listing',
      fieldName: 'amenity',
      normalizedValue: `Amenity ${index}`,
      quotedEvidence: `Amenity ${index}`,
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `rule-${index}`,
      sourceId: 'listing',
      fieldName: 'house Rule',
      normalizedValue: `Rule ${index}`,
      quotedEvidence: `Rule ${index}`,
    })),
  ];

  const grouped = groupSourceEvidenceFacts(facts);
  assert.equal(grouped.photos.length, 45);
  assert.equal(grouped.amenities.length, 60);
  assert.equal(grouped.rules.length, 5);
  assert.equal(grouped.photos[0]?.url, 'https://images.example/0.jpg');
});
