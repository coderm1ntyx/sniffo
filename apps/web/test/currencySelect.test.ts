import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CurrencySelect } from '../src/components/check/CurrencySelect';

const priceOptions = [
  { value: 'monthly_rent', label: 'Monthly Rent' },
  { value: 'nightly_rate', label: 'Nightly Rate' },
  { value: 'weekly_rate', label: 'Weekly Rate' },
  { value: 'stay_total', label: 'Total for stay' },
  { value: 'unknown', label: 'Other / Unknown' },
];

test('price type reuses the currency selector trigger and menu styling', () => {
  const currency = renderToStaticMarkup(
    createElement(CurrencySelect, {
      value: 'THB',
      labelledBy: 'currency-label',
      onChange() {},
    }),
  );
  const priceType = renderToStaticMarkup(
    createElement(CurrencySelect, {
      value: '',
      labelledBy: 'price-type-label',
      options: priceOptions,
      placeholder: 'Select price type',
      onChange() {},
    }),
  );

  for (const html of [currency, priceType]) {
    assert.match(html, /class="currency-select-trigger"/);
    assert.match(html, /class="currency-select-menu"/);
    assert.match(html, /class="currency-select-options"/);
    assert.match(html, /class="currency-select-option/);
  }
  assert.match(currency, /THB/);
  assert.match(priceType, /Select price type/);
  for (const { label } of priceOptions)
    assert.match(priceType, new RegExp(label));
  assert.doesNotMatch(priceType, /Search currencies/);
});
