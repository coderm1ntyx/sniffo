import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { EvidenceSource, ExtractedFact } from '@sniffo/shared';
import { X, ExternalLink, Star } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { evidenceViewLabels, type EvidenceView } from './reviewInsights';
import {
  safeSourceUrl,
  sourceLabels,
  type ReportPresentation,
} from './reportPresentation';
import {
  evidenceCurrencyCode,
  evidenceFieldKey,
  evidenceFieldLabel,
  cleanSourceUrl,
  formatEvidenceDate,
  formatEvidenceValue,
  groupSourceEvidenceFacts,
  sourcePlatformLabel,
} from './evidencePresentation';

function EvidencePhoto({
  url,
  index,
  eager,
}: {
  url: string;
  index: number;
  eager: boolean;
}) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>(
    'loading',
  );

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`report-photo${status === 'loading' ? ' is-loading' : ''}${status === 'loaded' ? ' is-loaded' : ''}${status === 'error' ? ' is-error' : ''}`}
      aria-label={`Open property photo ${index + 1}`}
    >
      <img
        src={url}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager && index === 0 ? 'high' : 'auto'}
        decoding="async"
        alt={`Property photo ${index + 1}`}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </a>
  );
}

function SourceEvidenceContent({
  source,
  facts,
}: {
  source?: EvidenceSource;
  facts: ExtractedFact[];
}) {
  const [showAllPhotos, setShowAllPhotos] = useState(false);
  const [showAllAmenities, setShowAllAmenities] = useState(false);
  const [showAllRules, setShowAllRules] = useState(false);
  const findFact = (...names: string[]) =>
    facts.find((fact) =>
      names.some(
        (name) => evidenceFieldKey(name) === evidenceFieldKey(fact.fieldName),
      ),
    );
  const titleFact = findFact('listingTitle', 'propertyTitle', 'title');
  const listingTitle =
    (titleFact &&
      formatEvidenceValue(titleFact.normalizedValue, titleFact.fieldName)) ||
    source?.name ||
    'Listing evidence';
  const { photos, amenities, rules } = groupSourceEvidenceFacts(facts);
  const locationFact = findFact('location', 'address', 'neighborhood', 'city');
  const currencyFact = findFact('currency', 'priceCurrency');
  const currencyCode = currencyFact
    ? evidenceCurrencyCode(currencyFact.normalizedValue)
    : undefined;
  const priceFact = findFact(
    'price',
    'monthlyRent',
    'nightlyPrice',
    'totalPrice',
    'priceAmount',
  );
  const priceValue = priceFact
    ? formatEvidenceValue(priceFact.normalizedValue, priceFact.fieldName)
    : null;
  const formattedPrice =
    priceValue && currencyCode && typeof priceFact?.normalizedValue === 'number'
      ? `${currencyCode} ${Number(priceFact.normalizedValue).toLocaleString('en')}`
      : priceValue;
  const propertyDetails = [
    ['propertyType', 'accommodationType'],
    ['bedroomCount', 'bedCount'],
    'bathroomCount',
    'maxGuests',
    'guestCapacity',
  ].flatMap((fields) => {
    const fact = Array.isArray(fields) ? findFact(...fields) : findFact(fields);
    const value =
      fact && formatEvidenceValue(fact.normalizedValue, fact.fieldName);
    return fact && value
      ? [
          {
            field: fact.fieldName,
            label: evidenceFieldLabel(fact.fieldName),
            value,
          },
        ]
      : [];
  });
  const rating = findFact('rating', 'ratingAverage', 'overallRating');
  const reviewCount = findFact('reviewCount', 'ratingCount', 'ratingsCount');
  const ratingValue = rating
    ? (() => {
        const value = formatEvidenceValue(
          rating.normalizedValue,
          rating.fieldName,
        );
        const numericValue = Number(rating.normalizedValue);
        return value && Number.isFinite(numericValue)
          ? numericValue.toLocaleString('en', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 2,
            })
          : value;
      })()
    : null;
  const reviewSummary =
    reviewCount &&
    (() => {
      const value = formatEvidenceValue(
        reviewCount.normalizedValue,
        reviewCount.fieldName,
      );
      return value
        ? `${value} ${Number(value) === 1 ? 'review' : 'reviews'}`
        : null;
    })();
  const ratingSummary =
    ratingValue && reviewSummary
      ? `${ratingValue} (${reviewSummary})`
      : ratingValue || reviewSummary;
  const bookingContext = findFact('bookingContext');
  const checkIn = findFact('checkIn', 'arrival');
  const checkOut = findFact('checkOut', 'departure');
  const bookingContextSummary = bookingContext
    ? formatEvidenceValue(bookingContext.normalizedValue, 'bookingContext')
    : null;
  const bookingContextParts = bookingContextSummary?.split(' · ');
  const bookingDates = bookingContextParts?.[1]
    ? `${bookingContextParts[0]} (${bookingContextParts.slice(1).join(' · ')})`
    : bookingContextSummary ||
      [
        checkIn && formatEvidenceDate(String(checkIn.normalizedValue ?? '')),
        checkOut && formatEvidenceDate(String(checkOut.normalizedValue ?? '')),
      ]
        .filter(Boolean)
        .join(' – ');
  const platform = source
    ? sourcePlatformLabel(sourceLabels[source.type], source.originalUrl)
    : 'Source unavailable';
  const displaySourceUrl = cleanSourceUrl(source?.originalUrl ?? null);
  const capturedSourceUrl = source?.originalUrl
    ? safeSourceUrl(source.originalUrl)
    : undefined;

  return (
    <>
      <div className="report-source-heading">
        <div>
          <h3>{listingTitle}</h3>
        </div>
        {displaySourceUrl && (
          <a href={displaySourceUrl} target="_blank" rel="noopener noreferrer">
            Original source <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
      {capturedSourceUrl && capturedSourceUrl !== displaySourceUrl && (
        <details className="report-source-url-details">
          <summary>Original captured URL</summary>
          <a href={capturedSourceUrl} target="_blank" rel="noopener noreferrer">
            Open the complete source link with its original parameters
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </details>
      )}
      <dl className="report-evidence-summary-grid">
        <div>
          <dt>Source / platform</dt>
          <dd>{platform}</dd>
        </div>
        {locationFact &&
          formatEvidenceValue(
            locationFact.normalizedValue,
            locationFact.fieldName,
          ) && (
            <div>
              <dt>Location</dt>
              <dd>
                {formatEvidenceValue(
                  locationFact.normalizedValue,
                  locationFact.fieldName,
                )}
              </dd>
            </div>
          )}
        {formattedPrice && (
          <div>
            <dt>
              {priceFact ? evidenceFieldLabel(priceFact.fieldName) : 'Price'}
            </dt>
            <dd>{formattedPrice}</dd>
          </div>
        )}
        {propertyDetails.length > 0 && (
          <div className="report-property-details-item">
            <dt>Property details</dt>
            <dd className="report-property-details">
              {propertyDetails.map((detail) => (
                <span className="report-property-detail" key={detail.field}>
                  <span className="report-property-detail-label">
                    {detail.label}
                  </span>
                  <span className="report-property-detail-value">
                    {detail.value}
                  </span>
                </span>
              ))}
            </dd>
          </div>
        )}
        {ratingSummary && (
          <div>
            <dt>Rating and reviews</dt>
            <dd className="report-rating-summary">
              {ratingValue && (
                <Star size={15} fill="currentColor" aria-hidden="true" />
              )}
              {ratingSummary}
            </dd>
          </div>
        )}
        {bookingDates && (
          <div>
            <dt>Booking dates</dt>
            <dd>{bookingDates}</dd>
          </div>
        )}
      </dl>
      {photos.length > 0 && (
        <section
          className="report-evidence-group"
          aria-labelledby="source-photos-title"
        >
          <div className="report-evidence-group-heading">
            <h3 id="source-photos-title">Property photos</h3>
            <span>{photos.length}</span>
          </div>
          <div className="report-photo-grid">
            {(showAllPhotos ? photos : photos.slice(0, 3)).map(
              (photo, index) => (
                <EvidencePhoto
                  key={photo.url}
                  url={photo.url}
                  index={index}
                  eager={!showAllPhotos && index < 3}
                />
              ),
            )}
          </div>
          {photos.length > 3 && (
            <button
              type="button"
              className="report-evidence-more"
              onClick={() => setShowAllPhotos(!showAllPhotos)}
            >
              {showAllPhotos
                ? 'Show fewer photos'
                : `+${photos.length - 3} more photos`}
            </button>
          )}
        </section>
      )}
      {amenities.length > 0 && (
        <section
          className="report-evidence-group"
          aria-labelledby="source-amenities-title"
        >
          <div className="report-evidence-group-heading">
            <h3 id="source-amenities-title">Amenities</h3>
            <span>{amenities.length}</span>
          </div>
          <div className="report-amenity-chips">
            {(showAllAmenities ? amenities : amenities.slice(0, 6)).map(
              (amenity) => (
                <span key={amenity}>{amenity}</span>
              ),
            )}
          </div>
          {amenities.length > 6 && (
            <button
              type="button"
              className="report-evidence-more"
              onClick={() => setShowAllAmenities(!showAllAmenities)}
            >
              {showAllAmenities
                ? 'Show fewer amenities'
                : `Show all ${amenities.length} amenities`}
            </button>
          )}
        </section>
      )}
      {rules.length > 0 && (
        <section
          className="report-evidence-group"
          aria-labelledby="source-rules-title"
        >
          <div className="report-evidence-group-heading">
            <h3 id="source-rules-title">House rules</h3>
            <span>{rules.length}</span>
          </div>
          <ul className="report-house-rules">
            {(showAllRules ? rules : rules.slice(0, 4)).map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          {rules.length > 4 && (
            <button
              type="button"
              className="report-evidence-more"
              onClick={() => setShowAllRules(!showAllRules)}
            >
              {showAllRules
                ? 'Show fewer rules'
                : `Show all ${rules.length} rules`}
            </button>
          )}
        </section>
      )}
    </>
  );
}

function reviewLimitations(model: ReportPresentation) {
  const limitations = model.report.riskAssessment?.limitations ?? [];
  const readableSources = model.sources.filter(
    (item) =>
      item.extractionStatus === 'complete' &&
      item.evidenceKind !== 'user_assertion',
  );
  const distinctSources = new Set(
    readableSources.map((item) =>
      (item.extractedText ?? '').replace(/\s+/g, ' ').trim().toLowerCase(),
    ),
  );
  const hasPaymentMessages = model.sources.some((item) =>
    [
      'conversation_text',
      'conversation_screenshot',
      'payment_information',
    ].includes(item.type),
  );
  const concise = [
    'Property ownership, host identity, and listing images were not independently verified.',
  ];

  if (distinctSources.size < 2) {
    concise.push(
      'Only one independently readable source was available, so independent corroboration is missing.',
    );
  } else {
    concise.push(
      'Comparisons assume all submitted sources refer to the same property and current offer.',
    );
  }
  if (!hasPaymentMessages) {
    concise.push(
      'No payment messages were submitted, so payment instructions could not be reviewed.',
    );
  }
  if (model.partial) {
    concise.push(
      'Some submitted sources could not be fully read; findings use the available evidence.',
    );
  }
  if (
    limitations.some((item) =>
      /unsupported scripts|language checks cover/i.test(item),
    )
  ) {
    concise.push(
      'Automated language checks are limited for some text in these sources.',
    );
  }
  if (
    limitations.some((item) => /no rental agreement was supplied/i.test(item))
  ) {
    concise.push(
      'No rental agreement was supplied; confirm lease and deposit terms in writing.',
    );
  }
  if (model.sources.some((item) => item.evidenceKind === 'user_assertion')) {
    concise.push(
      'Manually entered details are treated as claims and do not independently corroborate a source.',
    );
  }
  if (model.sources.some((item) => item.fileProvenance?.method === 'ai')) {
    concise.push(
      'Document quotes come from extracted text; the original image and layout were not independently verified.',
    );
  }

  return concise;
}

function reviewSummary(model: ReportPresentation) {
  const sourceCount = model.sources.length;
  const inconsistencyCount = model.findings.filter(
    (finding) => finding.category === 'confirmed_inconsistency',
  ).length;
  const warningCount = model.findings.filter(
    (finding) => finding.category === 'potential_warning_sign',
  ).length;
  const findingSummary = [
    inconsistencyCount > 0
      ? `${inconsistencyCount} supported ${inconsistencyCount === 1 ? 'inconsistency' : 'inconsistencies'}`
      : null,
    warningCount > 0
      ? `${warningCount} potential ${warningCount === 1 ? 'warning sign' : 'warning signs'}`
      : null,
  ].filter((item): item is string => item !== null);

  return `Reviewed ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}. ${findingSummary.length ? `Found ${findingSummary.join(' and ')}.` : 'No supported inconsistencies or warning signs found.'}`;
}

export function EvidenceInspector({
  model,
  sourceId,
  view,
  onClose,
  returnFocus,
}: {
  model: ReportPresentation;
  sourceId: string;
  view: EvidenceView;
  onClose: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const root = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const source = model.sources.find((s) => s.id === sourceId);
  const facts = model.facts.filter((f) => f.sourceId === sourceId);
  useGSAP(
    () => {
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
        gsap.from(root.current, {
          opacity: 0,
          y: 6,
          duration: 0.2,
          clearProps: 'opacity,transform',
        });
    },
    { scope: root, dependencies: [view, sourceId], revertOnUpdate: true },
  );
  useLayoutEffect(() => {
    const dialog = root.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  function close() {
    onClose();
    window.requestAnimationFrame(() =>
      returnFocus.current?.focus({ preventScroll: true }),
    );
  }
  return createPortal(
    <dialog
      ref={root}
      id="report-evidence-inspector"
      className="report-panel report-inspector"
      aria-labelledby="inspector-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="report-inspector-header">
        <h2 id="inspector-title">{evidenceViewLabels[view]}</h2>
        <button
          ref={closeButton}
          type="button"
          className="report-icon-button"
          onClick={close}
          aria-label="Close evidence details"
        >
          <X size={19} />
        </button>
      </div>
      <div className="report-inspector-content">
        {view === 'source' && (
          <SourceEvidenceContent source={source} facts={facts} />
        )}
        {view === 'limits' && (
          <>
            <p className="report-review-summary">{reviewSummary(model)}</p>
            <section className="report-review-limits">
              <ul className="report-limit-list">
                {reviewLimitations(model).map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
