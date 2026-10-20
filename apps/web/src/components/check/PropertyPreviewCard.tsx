import { useEffect, useState, type ReactNode } from 'react';
import { Bath, BedDouble, House, MapPin, UsersRound } from 'lucide-react';
import type { PropertyPreview } from './propertyPreview';

type PropertyPreviewCardProps = {
  property?: PropertyPreview | null;
  state?: 'loading' | 'error';
  footer?: ReactNode;
};
const loadedImageUrls = new Set<string>();
const imageLoadTimeoutMs = 7000;

function rememberLoadedImage(url: string) {
  loadedImageUrls.add(url);
  if (loadedImageUrls.size > 20)
    loadedImageUrls.delete(loadedImageUrls.values().next().value!);
}

function isSafeImageUrl(value?: string) {
  if (!value) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function formatPrice(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(currency === 'THB' ? 'th-TH' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}

export function PropertyPreviewCard({
  property,
  state,
  footer,
}: PropertyPreviewCardProps) {
  const safeImageUrl = isSafeImageUrl(property?.imageUrl)
    ? property?.imageUrl
    : undefined;
  const [imageState, setImageState] = useState<{
    url?: string;
    failed: boolean;
    loaded: boolean;
  }>(() => ({
    url: safeImageUrl,
    failed: false,
    loaded: Boolean(safeImageUrl && loadedImageUrls.has(safeImageUrl)),
  }));
  const imageFailed = imageState.url === safeImageUrl && imageState.failed;
  const imageLoaded = imageState.url === safeImageUrl && imageState.loaded;

  useEffect(() => {
    const alreadyLoaded = Boolean(
      safeImageUrl && loadedImageUrls.has(safeImageUrl),
    );
    setImageState((current) =>
      current.url === safeImageUrl
        ? current
        : { url: safeImageUrl, failed: false, loaded: alreadyLoaded },
    );
    if (!safeImageUrl || alreadyLoaded) return;
    const timeout = window.setTimeout(() => {
      setImageState((current) =>
        current.url === safeImageUrl && !current.loaded
          ? { url: safeImageUrl, failed: true, loaded: false }
          : current,
      );
    }, imageLoadTimeoutMs);
    return () => window.clearTimeout(timeout);
  }, [safeImageUrl]);

  const hasData = Boolean(
    property &&
    (property.title ||
      property.location ||
      property.propertyType ||
      safeImageUrl ||
      property.price.kind !== 'unknown'),
  );
  const hasSpecs =
    property?.bedrooms !== undefined ||
    property?.beds !== undefined ||
    property?.bathrooms !== undefined ||
    property?.guests !== undefined;

  if (state === 'error') {
    return (
      <article className="property-preview-card property-preview-card--state">
        <div className="property-preview-state-icon">
          <House size={22} aria-hidden="true" />
        </div>
        <strong>Property preview unavailable</strong>
        <p>You can still review and edit the details on this page.</p>
      </article>
    );
  }

  if (state === 'loading') {
    return (
      <article
        className="property-preview-card is-loading"
        aria-label="Loading property preview"
      >
        <div className="property-preview-image">
          <div
            className="property-preview-image-placeholder is-shimmer"
            aria-hidden="true"
          />
        </div>
        <div className="property-preview-content" aria-hidden="true">
          <div className="preview-skeleton-line" />
          <div className="preview-skeleton-line preview-skeleton-line--short" />
          <div className="preview-skeleton-line preview-skeleton-line--price" />
        </div>
      </article>
    );
  }

  return (
    <article
      className={`property-preview-card${!hasData ? ' is-empty' : ''}${footer ? ' results-property-card' : ''}`}
      aria-label={hasData ? 'Property listing preview' : 'Property preview'}
      data-property-preview-card
    >
      <div className="property-preview-image" data-preview-image>
        {safeImageUrl && !imageFailed ? (
          <>
            {!imageLoaded ? (
              <div
                className="property-preview-image-placeholder is-shimmer"
                aria-hidden="true"
              />
            ) : null}
            <img
              src={safeImageUrl}
              alt={
                property?.title
                  ? `Listing photo: ${property.title}`
                  : 'Property listing'
              }
              loading="eager"
              fetchPriority="high"
              decoding="async"
              onLoad={() => {
                rememberLoadedImage(safeImageUrl);
                setImageState({
                  url: safeImageUrl,
                  failed: false,
                  loaded: true,
                });
              }}
              onError={() => {
                loadedImageUrls.delete(safeImageUrl);
                setImageState({
                  url: safeImageUrl,
                  failed: true,
                  loaded: false,
                });
              }}
              className={imageLoaded ? 'is-loaded' : ''}
            />
          </>
        ) : (
          <div
            className="property-preview-image-placeholder"
            aria-hidden="true"
          >
            <House size={25} strokeWidth={1.4} />
          </div>
        )}
      </div>

      <div className="property-preview-content" data-preview-content>
        {property?.title ? (
          <h2 className="property-preview-title" data-preview-title>
            {property.title}
          </h2>
        ) : !hasData ? (
          <div className="preview-skeleton-line" aria-hidden="true" />
        ) : null}
        {property?.location ? (
          <p className="property-preview-location" data-preview-meta>
            <MapPin size={12} aria-hidden="true" />
            <span>{property.location}</span>
          </p>
        ) : null}

        {property?.price && property.price.kind !== 'unknown' ? (
          <div className="property-preview-price" data-preview-price>
            <strong>
              {formatPrice(property.price.amount, property.price.currency)}
            </strong>
            <span>
              {property.price.kind === 'stay_total'
                ? `for ${property.price.nights} nights`
                : 'per month'}
            </span>
          </div>
        ) : null}
        {hasSpecs ? (
          <>
            <hr className="property-preview-divider" aria-hidden="true" />
            <div className="property-preview-specs" data-preview-specs>
              {property?.bedrooms !== undefined ? (
                <span>
                  <BedDouble size={12} aria-hidden="true" /> {property.bedrooms}{' '}
                  bedrooms
                </span>
              ) : null}
              {property?.beds !== undefined ? (
                <span>
                  <BedDouble size={12} aria-hidden="true" /> {property.beds}{' '}
                  beds
                </span>
              ) : null}
              {property?.bathrooms !== undefined ? (
                <span>
                  <Bath size={12} aria-hidden="true" /> {property.bathrooms}{' '}
                  bathrooms
                </span>
              ) : null}
              {property?.guests !== undefined ? (
                <span>
                  <UsersRound size={12} aria-hidden="true" /> {property.guests}{' '}
                  guests
                </span>
              ) : null}
            </div>
          </>
        ) : null}
        {!hasData ? (
          <p className="property-preview-empty">
            Listing details will appear here.
          </p>
        ) : null}
      </div>
      {footer}
    </article>
  );
}
