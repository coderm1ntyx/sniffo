import { useRef } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { Info } from 'lucide-react';
import type { ScorePresentation } from './reviewInsights';

gsap.registerPlugin(useGSAP);

export function ReviewScore({
  score,
  animationDelay = 0.12,
}: {
  score: ScorePresentation;
  animationDelay?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const progress = root.current?.querySelector<SVGCircleElement>(
        '[data-score-progress]',
      );
      if (!progress || score.status !== 'scored') return;
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      const circumference = 2 * Math.PI * 40;
      gsap.fromTo(
        progress,
        { strokeDashoffset: circumference },
        {
          strokeDashoffset: circumference * (1 - score.value / 10),
          duration: reduced ? 0 : 0.9,
          delay: reduced ? 0 : animationDelay,
          ease: 'power2.out',
          overwrite: true,
        },
      );
    },
    {
      scope: root,
      dependencies: [score.status === 'scored' ? score.value : score.status],
      revertOnUpdate: true,
    },
  );

  return (
    <div
      ref={root}
      className={`report-score${score.status === 'scored' ? ' report-score--rated' : ''}`}
    >
      <div
        className="report-score-symbol"
        role="img"
        aria-label={
          score.status === 'scored'
            ? `Red Flag Score ${score.value.toFixed(1)} out of 10: ${score.title}`
            : score.title
        }
      >
        <svg
          className="report-score-ring"
          viewBox="0 0 100 100"
          aria-hidden="true"
        >
          <circle className="report-score-track" cx="50" cy="50" r="40" />
          {score.status === 'scored' && (
            <circle
              data-score-progress
              className="report-score-progress"
              cx="50"
              cy="50"
              r="40"
            />
          )}
        </svg>
        {score.status === 'scored' ? (
          <span className="report-score-value">
            <b>{score.value.toFixed(1)}</b>
            <small>/10</small>
          </span>
        ) : (
          <Info className="report-score-info" size={22} aria-hidden="true" />
        )}
      </div>
      <div className="report-score-copy">
        <h3>{score.title}</h3>
        <p>{score.explanation}</p>
        {score.status === 'scored' && (
          <p className="report-score-note">
            Rule-based concern index · not a probability of fraud.
          </p>
        )}
      </div>
    </div>
  );
}
