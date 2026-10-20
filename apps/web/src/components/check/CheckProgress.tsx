const steps = ['Listing', 'Analyze', 'Results'];

export function CheckProgress({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav
      className="check-progress"
      aria-label="Verification progress"
      data-check-reveal="eyebrow"
    >
      <div
        className={`progress-line${current === 3 ? ' is-complete' : ''}`}
        aria-hidden="true"
      >
        <span
          className={
            current === 3
              ? 'is-filled is-complete'
              : current > 1
                ? 'is-filled'
                : ''
          }
        />
      </div>
      <ol>
        {steps.map((label, index) => {
          const number = index + 1;
          const isCurrent = number === current;
          const isComplete = number < current;
          return (
            <li
              key={label}
              className={
                isCurrent ? 'is-current' : isComplete ? 'is-complete' : ''
              }
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span aria-hidden="true" />
              <b>{label}</b>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
