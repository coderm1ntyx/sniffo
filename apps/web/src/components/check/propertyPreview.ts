export type ListingPrice =
  | {
      kind: 'stay_total';
      amount: number;
      currency: string;
      nights: number;
    }
  | { kind: 'monthly_rent'; amount: number; currency: string }
  | { kind: 'unknown' };

export type PropertyPreview = {
  title?: string;
  location?: string;
  imageUrl?: string;
  propertyType?: string;
  price: ListingPrice;
  stayDates?: string;
  bedrooms?: number;
  beds?: number;
  bathrooms?: number;
  guests?: number;
  rating?: number;
  reviewCount?: number;
  description?: string;
};

export function mapPropertyPreview(
  values: Record<string, string>,
  supplemental?: PropertyPreview,
): PropertyPreview {
  const amount = values.monthlyRent?.trim()
    ? Number(values.monthlyRent.replaceAll(',', ''))
    : null;
  const price: ListingPrice =
    supplemental?.price.kind === 'stay_total'
      ? supplemental.price
      : amount !== null &&
          Number.isFinite(amount) &&
          amount >= 0 &&
          Boolean(values.currency?.trim())
        ? {
            kind: 'monthly_rent',
            amount,
            currency: values.currency.trim(),
          }
        : { kind: 'unknown' };
  const numericValue = (field: string) => {
    const value = values[field]?.trim();
    if (!value) return undefined;
    const number = Number(value.replaceAll(',', ''));
    return Number.isFinite(number) && number >= 0 ? number : undefined;
  };

  return {
    ...supplemental,
    title: values.listingTitle?.trim() || undefined,
    location: values.location?.trim() || undefined,
    propertyType: values.propertyType?.trim() || undefined,
    bedrooms: numericValue('bedroomCount'),
    bathrooms: numericValue('bathroomCount'),
    imageUrl: supplemental?.imageUrl,
    beds: supplemental?.beds,
    guests: supplemental?.guests,
    rating: supplemental?.rating,
    reviewCount: supplemental?.reviewCount,
    stayDates: supplemental?.stayDates,
    description: supplemental?.description,
    price,
  };
}
