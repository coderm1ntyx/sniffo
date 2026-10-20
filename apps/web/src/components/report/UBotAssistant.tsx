import * as React from 'react';
import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { ReportPresentation } from './reportPresentation';
import { scorePresentation } from './reviewInsights';

void React;

const questions = [
  'Summarise my report',
  'What should I check before paying?',
] as const;

function responseFor(model: ReportPresentation, question: string) {
  const score = scorePresentation(model);
  const listings =
    model.report.research?.searchResults?.filter(
      (item) =>
        item.classification !== 'original_listing' &&
        item.classification !== 'unrelated_listing' &&
        item.identity !== 'exact_listing' &&
        item.identity !== 'unrelated',
    ) ?? [];
  const concerns = model.findings.filter(
    (finding) => finding.category !== 'unable_to_verify',
  );
  const payment = model.findings.filter((finding) =>
    /payment|pay|deposit|transfer|cash|crypto|wire|off[- ]platform/i.test(
      `${finding.title} ${finding.description} ${finding.recommendedAction}`,
    ),
  );
  const externalNote = listings.length
    ? ` Research returned ${listings.length} external listing candidate${listings.length === 1 ? '' : 's'}, but these are not verified matches.`
    : '';

  if (question === 'Summarise my report') {
    const opening =
      score.status === 'scored'
        ? `Your report has a concern score of ${score.value}/10 (${score.title.toLowerCase()}).`
        : `${score.title}: ${score.explanation}`;
    const details = concerns.length
      ? concerns
          .map((finding) => `${finding.title}: ${finding.description}`)
          .join(' ')
      : 'No supported inconsistencies were established in the reviewed evidence.';
    return `${opening} ${details}${externalNote} This review does not verify ownership or authority to rent.`;
  }
  if (question === 'What should I check before paying?') {
    const actions = [
      ...payment.map(
        (finding) =>
          `${finding.title}: ${finding.description} Recommended action: ${finding.recommendedAction}`,
      ),
      ...model.recommendations,
    ];
    const unique = [...new Set(actions)].slice(0, 4);
    return `${unique.length ? unique.join(' ') : 'Confirm the rental terms and payment recipient independently, and review the evidence and any items marked unable to verify.'}${externalNote} Do not send money until you have independently confirmed the person’s authority to rent.`;
  }
  if (score.status === 'insufficient_evidence')
    return `There is no meaningful score because the available evidence is insufficient for a reliable assessment. ${score.explanation} A missing score does not mean the offer is safe.`;
  if (score.status === 'unavailable')
    return `There is no score for this report. ${score.explanation} The available information does not support a meaningful assessment.`;
  if (score.status === 'scored')
    return `The report's concern score is ${score.value}/10. ${model.report.redFlagScore?.explanation ?? score.explanation} It is a signal based on reviewed evidence, not a probability or proof of fraud.`;
  return `There is no score for this report. ${score.explanation} The available information does not support a meaningful assessment.`;
}

export function UBotAssistant({ model }: { model: ReportPresentation }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const question =
    scorePresentation(model).status === 'scored'
      ? 'Why did I get this score?'
      : 'Why is there no score?';
  return (
    <section
      className="ubot-assistant report-panel"
      aria-labelledby="ubot-title"
    >
      <div className="ubot-heading">
        <p className="report-kicker">
          Demo mode — live U-Bot integration planned.
        </p>
        <h2 id="ubot-title">U-Bot Rental Assistant</h2>
      </div>
      <div className="ubot-questions" aria-label="Ask about your report">
        {[...questions, question].map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setSelected(item);
              setAnswer(responseFor(model, item));
            }}
          >
            {item}
          </button>
        ))}
      </div>
      {selected && (
        <div className="ubot-conversation" aria-live="polite">
          <p className="ubot-user">
            <MessageCircle size={15} aria-hidden="true" />
            {selected}
          </p>
          <p className="ubot-answer">
            <span>{answer}</span>
          </p>
        </div>
      )}
    </section>
  );
}
