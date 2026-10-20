import { PropertyPreviewCard } from '../check/PropertyPreviewCard';
import type { PropertyPreview } from '../check/propertyPreview';
import type { ReportPresentation } from './reportPresentation';

function propertyPreview(
  model: ReportPresentation,
  imageUrl?: string,
): PropertyPreview {
  const facts = model.report.propertyFacts;
  const extractedImage = model.facts.find(
    (fact) =>
      fact.fieldName === 'listingImage' &&
      typeof fact.normalizedValue === 'string',
  )?.normalizedValue;
  const listingSource = model.sources.find((source) =>
    [
      'listing_url',
      'listing_text',
      'listing_screenshot',
      'listing_pdf',
    ].includes(source.type),
  );
  const monthlyPrice = facts.prices?.find(
    (price) =>
      price.basis === 'monthly_rent' && (price.currency || price.rawCurrency),
  );
  const stayPrice = facts.prices?.find(
    (price) =>
      price.basis === 'stay_total' &&
      price.nights !== undefined &&
      (price.currency || price.rawCurrency),
  );
  const price: PropertyPreview['price'] =
    facts.monthlyRent !== null && facts.currency
      ? {
          kind: 'monthly_rent',
          amount: facts.monthlyRent,
          currency: facts.currency,
        }
      : monthlyPrice
        ? {
            kind: 'monthly_rent',
            amount: monthlyPrice.amount,
            currency: monthlyPrice.currency ?? monthlyPrice.rawCurrency!,
          }
        : stayPrice
          ? {
              kind: 'stay_total',
              amount: stayPrice.amount,
              currency: stayPrice.currency ?? stayPrice.rawCurrency!,
              nights: stayPrice.nights!,
            }
          : { kind: 'unknown' };

  return {
    title: facts.listingTitle ?? listingSource?.name ?? undefined,
    location: facts.location ?? facts.address ?? undefined,
    imageUrl:
      imageUrl ??
      (typeof extractedImage === 'string' ? extractedImage : undefined),
    propertyType: facts.propertyType ?? undefined,
    bedrooms: facts.bedroomCount ?? undefined,
    bathrooms: facts.bathroomCount ?? undefined,
    price,
  };
}

export function ResultsPropertyCard({
  model,
  imageUrl,
}: {
  model: ReportPresentation;
  imageUrl?: string;
}) {
  return <PropertyPreviewCard property={propertyPreview(model, imageUrl)} />;
}
