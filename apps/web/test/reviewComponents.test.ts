import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReviewScore } from '../src/components/report/ReviewScore';
import { EvidenceSummaryCard } from '../src/components/report/EvidenceSummaryCard';
import { mapReport } from '../src/components/report/reportPresentation';
import {
  sampleReport,
  sampleRequest,
} from '../src/components/report/sampleReport';

test('numeric score presentation labels the approved concern index without probability claims', () => {
  const html = renderToStaticMarkup(
    createElement(ReviewScore, {
      score: {
        status: 'scored',
        value: 4.2,
        title: 'Check payment terms',
        explanation: 'Conflicting deposit details.',
      },
    }),
  );
  assert.match(html, /4\.2/);
  assert.match(html, /\/10/);
  assert.match(html, /not a probability of fraud/);
});
test('insufficient score never renders a number', () => {
  const html = renderToStaticMarkup(
    createElement(ReviewScore, {
      score: {
        status: 'insufficient_evidence',
        title: 'Not enough evidence to score',
        explanation: 'Add another source.',
      },
    }),
  );
  assert.match(html, /Not enough evidence/);
  assert.doesNotMatch(html, /\/10/);
});
test('evidence summary has accessible modal controls and no raw text dump', () => {
  const model = mapReport(sampleReport, sampleRequest)!;
  const html = renderToStaticMarkup(
    createElement(EvidenceSummaryCard, {
      model,
      selected: 'example-listing',
      onSelect() {},
      onInspect() {},
    }),
  );
  assert.equal((html.match(/aria-haspopup="dialog"/g) ?? []).length, 2);
  assert.equal((html.match(/lucide-chevron-down/g) ?? []).length, 0);
  assert.doesNotMatch(html, /<details|<summary/);
  assert.doesNotMatch(html, /Monthly rent: THB 18,000/);
  assert.match(html, /View source evidence/);
  assert.match(html, /About this review/);
});
