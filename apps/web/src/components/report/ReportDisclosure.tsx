import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

/** GSAP owns the panel height; React owns state, semantics and content. */
export function ReportDisclosure({
  heading,
  children,
  className = '',
  iconOnly = false,
}: {
  heading: ReactNode;
  children: ReactNode;
  className?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const reduced = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches;
      gsap.to('[data-disclosure-panel]', {
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
        duration: reduced ? 0 : 0.24,
        ease: 'power2.out',
        overwrite: true,
      });
      gsap.to('[data-disclosure-chevron]', {
        rotate: open ? 180 : 0,
        duration: reduced ? 0 : 0.2,
        overwrite: true,
      });
    },
    { scope: root, dependencies: [open] },
  );
  return (
    <div ref={root} className={`report-disclosure-component ${className}`}>
      <button
        type="button"
        className="report-disclosure-button"
        id={`${id}-button`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen(!open)}
      >
        {heading}
        <span className="report-chevron">
          {!iconOnly && (
            <span className="sr-only">{open ? 'Collapse' : 'Expand'}</span>
          )}
          <ChevronDown data-disclosure-chevron size={17} aria-hidden="true" />
        </span>
      </button>
      <div
        id={`${id}-panel`}
        className="report-disclosure-panel"
        data-disclosure-panel
        inert={!open}
        aria-hidden={!open}
        role="region"
        aria-labelledby={`${id}-button`}
      >
        <div className="report-disclosure-body">{children}</div>
      </div>
    </div>
  );
}
