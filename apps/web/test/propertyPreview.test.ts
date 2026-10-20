import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PropertyPreviewCard } from '../src/components/check/PropertyPreviewCard';
import { mapPropertyPreview } from '../src/components/check/propertyPreview';

test('preview binds listing image, listing facts, location, and stay total', () => {
  const property = mapPropertyPreview(
    {
      listingTitle: 'Luxury 2 bedroom - Infinity Pool - Gym',
      location: 'Yan Nawa, Bangkok, Thailand',
      bedroomCount: '2',
      bathroomCount: '2',
      currency: 'THB',
      monthlyRent: '',
    },
    {
      imageUrl: 'https://images.example/listing.jpg',
      beds: 2,
      guests: 3,
      price: { kind: 'stay_total', amount: 11886, currency: 'THB', nights: 5 },
      description: 'A real extracted description.',
    },
  );
  const html = renderToStaticMarkup(
    createElement(PropertyPreviewCard, { property }),
  );
  assert.match(html, /src="https:\/\/images\.example\/listing\.jpg"/);
  assert.match(html, /Luxury 2 bedroom/);
  assert.match(html, /Yan Nawa, Bangkok, Thailand/);
  assert.match(html, /2 bedrooms/);
  assert.match(html, /2 beds/);
  assert.match(html, /2 bathrooms/);
  assert.match(html, /3 guests/);
  assert.match(html, /11,886/);
  assert.match(html, /for 5 nights/);
  assert.equal(property.description, 'A real extracted description.');
});

test('preview renders intentional fallback when listing image is unavailable', () => {
  const html = renderToStaticMarkup(
    createElement(PropertyPreviewCard, {
      property: { title: 'Listing title', price: { kind: 'unknown' } },
    }),
  );
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /property-preview-image-placeholder/);
});
