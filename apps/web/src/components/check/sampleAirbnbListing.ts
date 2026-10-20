import type { PropertyPreview } from './propertyPreview';

type SampleAirbnbListing = PropertyPreview &
  Required<
    Pick<
      PropertyPreview,
      'title' | 'propertyType' | 'location' | 'bedrooms' | 'bathrooms'
    >
  >;

export const sampleAirbnbListing = {
  title: 'Luxury 2 bedroom - Infinity Pool - Gym',
  propertyType: 'Entire rental unit',
  location: 'Yan Nawa, Bangkok, Thailand',
  imageUrl:
    'https://a0.muscache.com/im/pictures/hosting/Hosting-1785549216267209394/original/41445b6f-0ced-4885-a886-76bb440724bf.png?im_w=1200',
  price: { kind: 'stay_total', amount: 11886, currency: 'THB', nights: 5 },
  stayDates: 'Oct 17–22, 2026',
  bedrooms: 2,
  beds: 2,
  bathrooms: 2,
  guests: 3,
  rating: 5,
  reviewCount: 3,
  description:
    "Modern two-bedroom apartment in Bangkok's Yan Nawa / Rama 3 area with a rooftop infinity pool, fitness center, and convenient access to local restaurants and attractions.",
} satisfies SampleAirbnbListing;
