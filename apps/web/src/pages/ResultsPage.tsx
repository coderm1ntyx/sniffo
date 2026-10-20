import { useRef } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { ArrowLeft, ArrowRight, Info } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { CheckProgress } from '../components/check/CheckProgress';
import { ReportSections } from '../components/report/ReportSections';
import { ResultsPropertyCard } from '../components/report/ResultsPropertyCard';
import { mapReport } from '../components/report/reportPresentation';
import { sampleReport, sampleRequest } from '../components/report/sampleReport';
import artwork from '../assets/landing/hero-desktop.png';
import '../styles/check-flow.css';
import '../styles/report.css';
import '../styles/research.css';

gsap.registerPlugin(useGSAP, ScrollTrigger);

function reveal(
  timeline: gsap.core.Timeline,
  target: gsap.TweenTarget,
  from: gsap.TweenVars,
  position?: gsap.Position,
) {
  const { duration = 0.5, stagger, ease, ...motion } = from;
  timeline.fromTo(
    target,
    { ...motion, opacity: 0 },
    {
      x: 0,
      y: 0,
      yPercent: 0,
      scale: 1,
      opacity: 1,
      duration,
      stagger,
      ease,
    },
    position,
  );
}

export function ResultsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sample = params.get('sample') === '1';
  const root = useRef<HTMLDivElement>(null);
  const state = location.state as {
    report?: unknown;
    request?: unknown;
    isDemo?: boolean;
    listingImageUrl?: string;
    reviewDraft?: unknown;
    deepResearch?: boolean;
  } | null;
  const model = mapReport(
    sample ? sampleReport : state?.report,
    sample ? sampleRequest : state?.request,
  );
  const isDemo = sample || state?.isDemo === true;
  const hasInvalidReport = state?.report !== undefined && !model;
  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        root.current?.setAttribute('data-results-motion-ready', '');
        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
        reveal(intro, '.results-hero .check-progress', {
          y: 8,
          duration: 0.45,
        });
        reveal(
          intro,
          '[data-check-reveal="title"] [data-title-line]',
          {
            yPercent: 110,
            duration: 0.85,
            stagger: 0.1,
          },
          0.42,
        );
        reveal(
          intro,
          '.results-hero [data-check-reveal="copy"]',
          {
            y: 10,
            duration: 0.65,
          },
          0.35,
        );
        reveal(
          intro,
          '.results-hero .check-art',
          {
            x: 18,
            scale: 1.015,
            duration: 1.25,
          },
          0.28,
        );
        reveal(
          intro,
          '.results-property-card',
          { y: 12, scale: 0.99, duration: 0.75 },
          0.84,
        );
        reveal(
          intro,
          '.results-hero .report-sample-notice, .results-hero .report-back-link',
          { y: 7, duration: 0.45 },
          0.92,
        );
        reveal(
          intro,
          '.results-hero .results-empty',
          { y: 12, duration: 0.6 },
          0.78,
        );
        gsap.utils
          .toArray<HTMLElement>('[data-report-reveal]')
          .forEach((section) => {
            const timeline = gsap.timeline({
              scrollTrigger: {
                trigger: section,
                start: 'top 65%',
                once: true,
                invalidateOnRefresh: true,
              },
              defaults: { ease: 'power3.out' },
            });
            const overview = section.classList.contains('report-overview');
            if (overview) {
              reveal(timeline, section, { y: 12, duration: 0.65 });
            } else if (section.classList.contains('report-evidence')) {
              reveal(timeline, section, { y: 12, duration: 0.65 });
            } else if (section.classList.contains('report-next')) {
              reveal(timeline, section, { y: 12, duration: 0.65 });
            } else {
              reveal(
                timeline,
                section.querySelectorAll(
                  '.report-section-heading > *, .report-finding, .report-neutral > *, .report-source-select, .report-source-summary, .report-fact-grid > div, .report-coverage-line, .report-evidence-controls > *, .report-recommendations > *, .report-context-note, .report-notice, .report-caption, .report-closing > *',
                ),
                { y: 11, duration: 0.55, stagger: 0.09 },
              );
            }
          });
        return () => root.current?.removeAttribute('data-results-motion-ready');
      });
      return () => media.revert();
    },
    { scope: root, dependencies: [location.key], revertOnUpdate: true },
  );
  const description = !model
    ? hasInvalidReport
      ? 'We received a report in an unexpected format. Return to your property details and try the analysis again.'
      : 'Start a property check to see findings, supporting evidence and practical next steps here.'
    : isDemo
      ? 'Explore how Sniffo presents findings and their sources. This is fictional demonstration data, separate from a real property check.'
      : model.partial
        ? 'Some submitted sources could not be fully processed. Here is what the available evidence supports, and what still needs checking.'
        : model.findings.length
          ? 'We reviewed the information you submitted and highlighted what needs attention, what could not be verified, and what to check next.'
          : "We didn't find inconsistencies in the information reviewed. That doesn't guarantee the property is legitimate—here's what we could and couldn't verify.";
  return (
    <div ref={root} className="workflow-page results-workflow">
      <section
        className="check-layout check-layout--input results-hero"
        aria-labelledby="results-title"
      >
        <div className="check-copy">
          <CheckProgress current={3} />
          <h1 id="results-title" data-check-reveal="title">
            {model ? (
              <>
                <span className="results-title-mask">
                  <span data-title-line className="results-title-line">
                    Your verification
                  </span>
                </span>
                <br />
                <span className="results-title-mask">
                  <span
                    data-title-line
                    className="results-title-line results-title-line--accent"
                  >
                    review
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="results-title-mask">
                  <span
                    data-title-line
                    className="results-title-line results-title-line--accent"
                  >
                    A clearer view,
                  </span>
                </span>
                <br />
                <span className="results-title-mask">
                  <span data-title-line className="results-title-line">
                    starts here
                  </span>
                </span>
              </>
            )}
          </h1>
          <p className="check-intro" data-check-reveal="copy">
            {description}
          </p>
          {isDemo && (
            <p className="report-sample-notice" role="note">
              Sample report — fictional demonstration data.
            </p>
          )}
          {model && !isDemo && window.history.state?.idx > 0 && (
            <button
              type="button"
              className="report-back-link"
              onClick={() =>
                navigate('/check', {
                  state: {
                    reviewDraft: state?.reviewDraft,
                    deepResearch: state?.deepResearch,
                  },
                })
              }
            >
              <ArrowLeft size={16} aria-hidden="true" /> Back to property
              details
            </button>
          )}
          {!model && (
            <div
              className="results-empty"
              role={hasInvalidReport ? 'alert' : 'status'}
            >
              <Info size={22} aria-hidden="true" />
              <div>
                <h2>
                  {hasInvalidReport
                    ? 'This report could not be displayed'
                    : 'No property review yet'}
                </h2>
                <p>
                  {hasInvalidReport
                    ? 'Your previous inputs are available by going back to your check.'
                    : 'Results are shown only for the check you complete.'}
                </p>
                <Link className="primary-button" to="/check?new=1">
                  Start a property check{' '}
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
            </div>
          )}
        </div>
        <figure className="check-art check-art--review results-art">
          <img
            src={artwork}
            width="1536"
            height="1024"
            alt=""
            aria-hidden="true"
            fetchPriority="high"
            decoding="async"
          />
          {model && (
            <ResultsPropertyCard
              model={model}
              imageUrl={state?.listingImageUrl}
            />
          )}
        </figure>
      </section>
      {model && <ReportSections model={model} isDemo={isDemo} />}
    </div>
  );
}
