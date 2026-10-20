import * as React from 'react';
import { ExternalLink, FileText, Info } from 'lucide-react';
import { sourceLabels, type ReportPresentation } from './reportPresentation';
import { cleanSourceUrl } from './evidencePresentation';
import {
  type EvidenceView,
  evidenceViewLabels,
  displayFact,
  keySourceFacts,
} from './reviewInsights';

void React;
export function EvidenceSummaryCard({
  model,
  selected,
  onSelect,
  onInspect,
  hideHeading = false,
}: {
  model: ReportPresentation;
  selected: string;
  onSelect: (id: string) => void;
  onInspect: (view: EvidenceView) => void;
  hideHeading?: boolean;
}) {
  const source = model.sources.find((s) => s.id === selected);
  const url = cleanSourceUrl(source?.originalUrl ?? null);
  const facts = keySourceFacts(model, selected);
  return (
    <section
      className="report-panel report-evidence"
      aria-labelledby="evidence-title"
      data-report-reveal
    >
      {!hideHeading && (
        <div className="report-section-heading">
          <h2 id="evidence-title">Evidence reviewed</h2>
        </div>
      )}
      {model.sources.length > 1 && (
        <label className="report-source-select">
          Source
          <select
            value={selected}
            onChange={(event) => onSelect(event.target.value)}
          >
            {model.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {source ? (
        <div className="report-source-summary">
          <p className="report-caption">{sourceLabels[source.type]}</p>
          <h3 title={source.name}>{source.name}</h3>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer">
              Original source <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
        </div>
      ) : (
        <p>Original source context unavailable.</p>
      )}
      <dl className="report-fact-grid">
        {facts.map((fact) => (
          <div key={fact.id}>
            <dt>{fact.fieldName.replace(/([A-Z])/g, ' $1')}</dt>
            <dd>{displayFact(fact.normalizedValue)}</dd>
          </div>
        ))}
      </dl>
      {!facts.length && (
        <p className="report-caption">
          No key property facts extracted from this source. Inspect the supplied
          text below.
        </p>
      )}
      <div className="report-evidence-controls">
        {(Object.keys(evidenceViewLabels) as EvidenceView[]).map((view) => {
          const Icon = view === 'limits' ? Info : FileText;
          return (
            <button
              type="button"
              key={view}
              onClick={() => onInspect(view)}
              aria-haspopup="dialog"
              aria-controls="report-evidence-inspector"
            >
              <Icon size={16} aria-hidden="true" />
              <span>{evidenceViewLabels[view]}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
