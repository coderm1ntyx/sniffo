import * as React from 'react';
import { useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  FileText,
  Info,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EvidenceSummaryCard } from './EvidenceSummaryCard';
import { ResearchFindings } from './ResearchFindings';
import { EvidenceInspector } from './EvidenceInspector';
import { ReportDisclosure } from './ReportDisclosure';
import { UBotAssistant } from './UBotAssistant';
import {
  type EvidenceView,
  topRecommendations,
  scorePresentation,
} from './reviewInsights';
import { categoryLabels, type ReportPresentation } from './reportPresentation';

void React;

function FindingRow({
  finding,
  onInspect,
}: {
  finding: ReportPresentation['findings'][number];
  onInspect: (sourceId?: string) => void;
}) {
  const Icon =
    finding.category === 'confirmed_inconsistency'
      ? AlertCircle
      : finding.category === 'potential_warning_sign'
        ? AlertTriangle
        : Info;
  const summary = finding.description.split(
    / Reviewed evidence:| Evidence excerpt:| Evidence:/,
  )[0];
  return (
    <article className={`report-finding report-finding--${finding.category}`}>
      <ReportDisclosure
        className="report-finding-disclosure"
        iconOnly
        heading={
          <>
            <span className="report-finding-icon">
              <Icon size={18} aria-hidden="true" />
            </span>
            <span className="report-finding-heading">
              <span className="report-category">
                {categoryLabels[finding.category]}
              </span>
              <strong>{finding.title}</strong>
              <span className="report-finding-summary">
                {summary.split(/(?<=[.!?])\s/)[0]}
              </span>
            </span>
          </>
        }
      >
        <div className="report-finding-detail">
          <h3>Why this matters</h3>
          <p>{summary}</p>
          <div className="report-supporting-evidence">
            <h3>Supporting evidence</h3>
            {finding.evidence.length ? (
              finding.evidence.map((item, index) => (
                <div key={`${item.id}-${index}`}>
                  {item.fact && (
                    <blockquote>{item.fact.quotedEvidence}</blockquote>
                  )}
                  {item.source ? (
                    <button
                      type="button"
                      className="report-evidence-reference"
                      onClick={() => onInspect(item.source?.id)}
                    >
                      <FileText size={15} aria-hidden="true" />
                      <span>{item.source.name}</span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  ) : (
                    <p className="report-caption">
                      Supporting quotation unavailable · reference {item.id}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="report-caption">
                No supporting references were returned.
              </p>
            )}
          </div>
          <div className="report-action">
            <h3>Recommended action</h3>
            <p>{finding.recommendedAction}</p>
          </div>
        </div>
      </ReportDisclosure>
    </article>
  );
}
export function ReportSections({
  model,
  isDemo,
}: {
  model: ReportPresentation;
  isDemo: boolean;
}) {
  const [selected, setSelected] = useState(model.sources[0]?.id ?? '');
  const [view, setView] = useState<EvidenceView | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  function inspect(next: EvidenceView, sourceId?: string) {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (sourceId) setSelected(sourceId);
    setView((current) => (current === next && !sourceId ? null : next));
  }
  const score = scorePresentation(model);
  const unableToVerify = model.findings.filter(
    (finding) => finding.category === 'unable_to_verify',
  );
  const paymentEvidenceProvided = model.sources.some((source) =>
    [
      'conversation_text',
      'conversation_screenshot',
      'payment_information',
    ].includes(source.type),
  );
  return (
    <div className="report-content">
      <section
        className="report-main-result report-panel"
        aria-labelledby="main-result-title"
      >
        <div className="report-section-heading">
          <h2 id="main-result-title">Main verification result</h2>
        </div>
        <div className="main-result-score">
          <strong>
            {score.status === 'scored' ? score.value.toFixed(1) : '—'}
          </strong>
          <span>/10</span>
          <div>
            <h3>
              {score.status === 'insufficient_evidence'
                ? 'Insufficient evidence'
                : score.title}
            </h3>
            <p>
              {score.status === 'insufficient_evidence'
                ? "We couldn't assess this rental reliably from the information provided."
                : score.explanation}
            </p>
          </div>
        </div>
        {score.status === 'insufficient_evidence' && (
          <p className="main-result-missing">
            {paymentEvidenceProvided
              ? 'Some submitted information could not be independently reviewed or corroborated.'
              : 'No payment messages or written booking terms were provided for review.'}
          </p>
        )}
        {(unableToVerify.length > 0 ||
          model.partial ||
          !model.contextAvailable) && (
          <div className="main-result-limits">
            <strong>Still to verify</strong>
            <p>
              Host identity, property ownership, and authority to rent were not
              independently verified.
              {model.partial &&
                ' Some submitted information could not be fully reviewed.'}
              {!paymentEvidenceProvided &&
                ' Payment instructions could not be assessed without payment messages.'}
            </p>
            {unableToVerify.slice(0, 2).map((finding) => (
              <p key={finding.id}>{finding.description}</p>
            ))}
          </div>
        )}
        {isDemo && (
          <p className="report-caption">Fictional demonstration data.</p>
        )}
      </section>
      <section
        className="report-section report-found-section"
        aria-labelledby="findings-title"
        data-report-reveal
      >
        <div className="report-section-heading">
          <h2 id="findings-title">What Sniffo found</h2>
        </div>
        {model.findings.some(
          (finding) => finding.category !== 'unable_to_verify',
        ) ? (
          <div className="report-findings">
            {model.findings
              .filter((finding) => finding.category !== 'unable_to_verify')
              .map((finding) => (
                <FindingRow
                  key={finding.id}
                  finding={finding}
                  onInspect={(sourceId) => inspect('source', sourceId)}
                />
              ))}
          </div>
        ) : (
          <div className="report-panel report-neutral">
            <Info size={23} aria-hidden="true" />
            <div>
              <h3>No supported inconsistencies found</h3>
              <p>
                No matching inconsistency was established in the evidence
                reviewed.
              </p>
            </div>
          </div>
        )}
        <details className="report-evidence-accordion">
          <summary>Evidence reviewed ({model.sources.length})</summary>
          <EvidenceSummaryCard
            model={model}
            selected={selected}
            onSelect={setSelected}
            onInspect={inspect}
            hideHeading
          />
        </details>
      </section>
      <UBotAssistant model={model} />
      <ResearchFindings research={model.report.research} />
      {view && (
        <EvidenceInspector
          key={`${view}-${selected}`}
          model={model}
          sourceId={selected}
          view={view}
          onClose={() => setView(null)}
          returnFocus={returnFocus}
        />
      )}
      <section
        className="report-section report-panel report-next"
        aria-labelledby="next-title"
        data-report-reveal
      >
        <div className="report-section-heading">
          <h2 id="next-title">Before you pay</h2>
          <p>
            A few practical next steps can help you move forward with more
            confidence.
          </p>
        </div>
        {model.recommendations.length ? (
          <ol className="report-recommendations">
            {topRecommendations(model).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ol>
        ) : (
          <p>No specific recommendations were returned by this analysis.</p>
        )}
      </section>
      <section className="report-closing" data-report-reveal>
        <h2>Check another listing when you're ready.</h2>
        <p>Start a new verification flow for another property.</p>
        <Link to="/check?new=1" className="primary-button">
          Check another listing <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>
    </div>
  );
}
