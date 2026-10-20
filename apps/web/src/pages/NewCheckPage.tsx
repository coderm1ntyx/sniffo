import { useEffect, useReducer, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FileText,
  Link as LinkIcon,
  LoaderCircle,
  MessageSquareText,
} from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import '../styles/research.css';
import gsap from 'gsap';
import {
  AnalysisRequestSchema,
  EvidenceSourceSchema,
  ExtractedFactSchema,
  type EvidenceSource,
  type ExtractedFact,
  type ResearchStage,
} from '@sniffo/shared';
import {
  analyzeVerification,
  extractListingUrl,
  extractText,
} from '../lib/api';
import { AmountInput } from '../components/check/AmountInput';
import { normalizeCountInput } from '../components/check/inputSanitizers';
import { CurrencySelect } from '../components/check/CurrencySelect';
import {
  mapPropertyPreview,
  type PropertyPreview,
} from '../components/check/propertyPreview';
import { sampleAirbnbListing } from '../components/check/sampleAirbnbListing';
import { PropertyPreviewCard } from '../components/check/PropertyPreviewCard';
import {
  buildAnalysisEvidence,
  applyReviewValueOverrides,
  changedReviewValues,
  currencyForFacts,
  displayPropertyType,
  extractionResponseIsCurrent,
  hasReliableListingPrice,
  hasPriceBasisEvidence,
  hydrateDescription,
  listingDetailsFromFacts,
  preserveEnteredAddress,
  priceBasisFromFacts,
  priceValueKey,
  stayNightsFromListing,
  valuesFromFacts,
  type CurrencyProvenance,
  type PriceBasis,
  type ReviewValues,
} from '../components/check/reviewEvidence';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { CheckProgress } from '../components/check/CheckProgress';
import stepTwoArtwork from '../assets/landing/hero-desktop.png';
import '../styles/check-flow.css';

type Values = ReviewValues;
type InputFlow = {
  status: 'input';
  mode: 'url' | 'manual';
  url: string;
  description: string;
  manualPriceBasis: PriceBasis;
  priceBasisEdited: boolean;
  manualValues: Values;
  userEdits: Partial<Values>;
  error: string | null;
};
type ReviewData = {
  mode: 'url' | 'manual';
  url: string;
  description: string;
  originalDescription: string;
  priceBasis: PriceBasis;
  originalPriceBasis: PriceBasis;
  priceBasisProvenance: CurrencyProvenance;
  originalPriceBasisProvenance: CurrencyProvenance;
  currencyProvenance: CurrencyProvenance;
  originalCurrencyProvenance: CurrencyProvenance;
  stayNights?: number;
  bookingContext?: {
    checkIn?: string;
    checkOut?: string;
    nights?: number;
    adults?: number;
    children?: number;
    infants?: number;
    pets?: number;
    guestCount?: number;
    totalGuests?: number;
    currency?: string;
    locale?: string;
  };
  source: EvidenceSource;
  facts: ExtractedFact[];
  originalValues: Values;
  values: Values;
  messages: string;
  error: string | null;
  demo?: boolean;
  preview?: PropertyPreview;
  listingImage?: {
    url: string;
    source: 'og:image' | 'twitter:image' | 'json_ld' | 'airbnb_public_data';
    extractionMethod: 'metadata' | 'json_ld' | 'embedded_json';
  };
  extractionWarnings?: string[];
  titleIsFallback?: boolean;
  descriptionIsFallback?: boolean;
};
type FlowState =
  | InputFlow
  | (Omit<InputFlow, 'status' | 'mode' | 'error'> & {
      status: 'extracting';
      mode: 'url';
      requestId: number;
    })
  | ({ status: 'review' } & ReviewData)
  | ({ status: 'analyzing' } & ReviewData);
type Action =
  | { type: 'patch-input'; patch: Partial<InputFlow> }
  | { type: 'extracting'; url: string; requestId: number }
  | { type: 'input-error'; message: string }
  | { type: 'review'; data: ReviewData }
  | { type: 'patch-review'; patch: Partial<ReviewData> }
  | { type: 'analyzing' }
  | { type: 'analysis-error'; message: string }
  | { type: 'back-to-input' };

const initialValues: Values = {
  listingTitle: '',
  propertyType: '',
  location: '',
  address: '',
  monthlyRent: '',
  listingPrice: '',
  currency: '',
  depositAmount: '',
  bedroomCount: '',
  bathroomCount: '',
  bedCount: '',
  maxGuests: '',
  hostName: '',
  stayNights: '',
  houseRule: '',
  amenity: '',
};
const fieldLabels: Record<string, string> = {
  listingTitle: 'Property title',
  propertyType: 'Property type',
  location: 'Location',
  address: 'Address',
  monthlyRent: 'Monthly rent',
  currency: 'Currency',
  depositAmount: 'Deposit',
  bedroomCount: 'Bedrooms',
  bathroomCount: 'Bathrooms',
  listingPrice: 'Price',
  priceBasis: 'Price type',
  bedCount: 'Beds',
  maxGuests: 'Maximum guests',
  hostName: 'Host',
  stayNights: 'Stay duration',
  stayDuration: 'Stay duration',
  houseRule: 'House rules',
  amenity: 'Amenities',
};
const numericFields = new Set([
  'monthlyRent',
  'listingPrice',
  'depositAmount',
  'bedroomCount',
  'bathroomCount',
  'bedCount',
  'maxGuests',
  'stayNights',
]);
const reviewFieldOrder = [
  'listingTitle',
  'propertyType',
  'location',
  'monthlyRent',
  'currency',
  'priceBasis',
  'bedroomCount',
  'bathroomCount',
] as const;
const priceBasisOptions = [
  { value: 'monthly_rent', label: 'Monthly Rent' },
  { value: 'nightly_rate', label: 'Nightly Rate' },
  { value: 'weekly_rate', label: 'Weekly Rate' },
  { value: 'stay_total', label: 'Total for stay' },
  { value: 'unknown', label: 'Other / Unknown' },
];

function priceLabel(basis: PriceBasis, preview?: PropertyPreview) {
  if (basis === 'monthly_rent') return 'Monthly Rent';
  if (basis === 'nightly_rate') return 'Nightly Rate';
  if (basis === 'weekly_rate') return 'Weekly Rate';
  if (basis === 'stay_total') {
    const nights =
      preview?.price.kind === 'stay_total' ? preview.price.nights : undefined;
    return `Total for stay${nights ? ` (${nights} nights)` : ''}`;
  }
  return 'Other / Unknown';
}

function stayDatesFromUrl(url: string) {
  try {
    const params = new URL(url).searchParams;
    const checkIn = params.get('check_in');
    const checkOut = params.get('check_out');
    return checkIn && checkOut ? `${checkIn} – ${checkOut}` : undefined;
  } catch {
    return undefined;
  }
}

function reducer(state: FlowState, action: Action): FlowState {
  switch (action.type) {
    case 'patch-input':
      return state.status === 'input'
        ? { ...state, ...action.patch, error: null }
        : state;
    case 'extracting':
      return {
        status: 'extracting',
        mode: 'url',
        url: action.url,
        description: state.status === 'input' ? state.description : '',
        manualPriceBasis:
          state.status === 'input' ? state.manualPriceBasis : 'unknown',
        priceBasisEdited:
          state.status === 'input' ? state.priceBasisEdited : false,
        manualValues:
          state.status === 'input' ? state.manualValues : { ...initialValues },
        userEdits: state.status === 'input' ? state.userEdits : {},
        requestId: action.requestId,
      };
    case 'input-error':
      return state.status === 'extracting'
        ? {
            status: 'input',
            mode: 'url',
            url: state.url,
            description: state.description,
            manualPriceBasis: state.manualPriceBasis,
            priceBasisEdited: state.priceBasisEdited,
            manualValues: state.manualValues,
            userEdits: state.userEdits,
            error: action.message,
          }
        : state.status === 'input'
          ? { ...state, error: action.message }
          : state;
    case 'review':
      return { status: 'review', ...action.data };
    case 'patch-review':
      return state.status === 'review' || state.status === 'analyzing'
        ? { ...state, ...action.patch, error: null }
        : state;
    case 'analyzing':
      return state.status === 'review'
        ? { ...state, status: 'analyzing', error: null }
        : state;
    case 'analysis-error':
      return state.status === 'analyzing'
        ? { ...state, status: 'review', error: action.message }
        : state;
    case 'back-to-input':
      return state.status === 'review' || state.status === 'analyzing'
        ? {
            status: 'input',
            mode: state.mode,
            url: state.url,
            description: state.description,
            manualPriceBasis: state.priceBasis,
            priceBasisEdited: state.priceBasis !== state.originalPriceBasis,
            manualValues: state.values,
            userEdits: changedReviewValues(state.values, state.originalValues),
            error: null,
          }
        : state;
  }
}

function previewSupplement(
  facts: ExtractedFact[],
  listingImage?: ReviewData['listingImage'],
  description?: string | null,
  stayDates?: string,
): PropertyPreview {
  const factValue = (name: string) =>
    facts.find((fact) => fact.fieldName === name)?.normalizedValue;
  const prices = facts
    .filter((fact) => fact.fieldName === 'price')
    .map(
      (fact) =>
        fact.normalizedValue as {
          amount?: number;
          currency?: string | null;
          basis?: string;
          nights?: number;
        },
    );
  const stay = prices.find(
    (price) => price.basis === 'stay_total' && Number.isFinite(price.amount),
  );
  const monthly = prices.find(
    (price) => price.basis === 'monthly_rent' && Number.isFinite(price.amount),
  );
  const chosen = stay ?? monthly;
  return {
    title:
      typeof factValue('listingTitle') === 'string'
        ? String(factValue('listingTitle'))
        : undefined,
    location: undefined,
    imageUrl: listingImage?.url,
    description: description || undefined,
    stayDates,
    beds:
      typeof factValue('bedCount') === 'number'
        ? Number(factValue('bedCount'))
        : undefined,
    guests:
      typeof factValue('maxGuests') === 'number'
        ? Number(factValue('maxGuests'))
        : undefined,
    price:
      chosen?.amount !== undefined && chosen.currency
        ? ({
            kind: stay ? 'stay_total' : 'monthly_rent',
            amount: chosen.amount,
            currency: chosen.currency,
            ...(stay ? { nights: chosen.nights ?? 1 } : {}),
          } as PropertyPreview['price'])
        : { kind: 'unknown' },
  };
}

function factsFromManualValues(
  values: Values,
  sourceId: string,
  priceBasis: PriceBasis,
) {
  const facts: ExtractedFact[] = [];
  const add = (fieldName: string, value: unknown, quote: string) => {
    facts.push(
      ExtractedFactSchema.parse({
        id: `manual-${fieldName}-${crypto.randomUUID()}`,
        sourceId,
        fieldName,
        normalizedValue: value,
        quotedEvidence: quote,
      }),
    );
  };

  for (const fieldName of [
    'listingTitle',
    'propertyType',
    'location',
    'address',
    'bedroomCount',
    'bathroomCount',
    'bedCount',
    'maxGuests',
    'hostName',
  ]) {
    const value = values[fieldName]?.trim();
    if (!value) continue;
    const normalizedValue = numericFields.has(fieldName)
      ? Number(value)
      : value;
    add(fieldName, normalizedValue, `${fieldLabels[fieldName]}: ${value}`);
  }

  for (const fieldName of ['houseRule', 'amenity']) {
    const entries = (values[fieldName] ?? '')
      .split(/\n+/)
      .map((value) => value.trim())
      .filter(Boolean);
    for (const value of entries)
      add(fieldName, value, `${fieldLabels[fieldName]}: ${value}`);
  }

  const currency = values.currency?.trim().toUpperCase() ?? '';
  if (currency) add('currency', currency, `Currency: ${currency}`);

  const deposit = values.depositAmount?.trim();
  if (deposit) {
    add('depositAmount', Number(deposit), `Deposit: ${deposit}`);
    if (currency)
      add('depositCurrency', currency, `Deposit currency: ${currency}`);
  }

  const priceAmount = values[priceValueKey(priceBasis)]?.trim() ?? '';
  const stayNights = Number(values.stayNights);
  if (priceBasis !== 'unknown')
    add('priceBasis', priceBasis, `Price type: ${priceLabel(priceBasis)}`);
  if (priceAmount) {
    const price = {
      amount: Number(priceAmount),
      currency: currency || null,
      basis: priceBasis,
      basisExplicit: priceBasis !== 'unknown',
      role: 'listing',
      ...(priceBasis === 'stay_total' &&
      Number.isInteger(stayNights) &&
      stayNights > 0
        ? { nights: stayNights }
        : {}),
    };
    add(
      'price',
      price,
      `${priceLabel(priceBasis)}: ${currency ? `${currency} ` : ''}${priceAmount}${priceBasis === 'stay_total' && stayNights > 0 ? ` for ${stayNights} nights` : ''}`,
    );
    if (priceBasis === 'monthly_rent')
      add('monthlyRent', Number(priceAmount), `Monthly rent: ${priceAmount}`);
  }
  if (Number.isInteger(stayNights) && stayNights > 0)
    add(
      'stayDuration',
      `${stayNights} nights`,
      `Stay duration: ${stayNights} nights`,
    );

  return facts;
}

function createSampleHome(url: string): ReviewData {
  const sourceId = 'sample-home-source';
  const details: Record<string, string | number> = {
    listingTitle: sampleAirbnbListing.title,
    propertyType: sampleAirbnbListing.propertyType,
    location: sampleAirbnbListing.location,
    bedroomCount: sampleAirbnbListing.bedrooms,
    bathroomCount: sampleAirbnbListing.bathrooms,
  };
  const facts = Object.entries(details).map(([fieldName, value]) =>
    ExtractedFactSchema.parse({
      id: `sample-${fieldName}`,
      sourceId,
      fieldName,
      normalizedValue: value,
      quotedEvidence: `${fieldLabels[fieldName]}: ${value}`,
    }),
  );
  const source = EvidenceSourceSchema.parse({
    id: sourceId,
    type: 'listing_url',
    name: 'Sample Airbnb listing (development demo)',
    originalUrl: null,
    extractedText: [
      ...Object.entries(details).map(
        ([fieldName, value]) => `${fieldLabels[fieldName]}: ${value}`,
      ),
      `Advertised total: ${sampleAirbnbListing.price.amount} THB for ${sampleAirbnbListing.price.nights} nights`,
      `Stay dates: ${sampleAirbnbListing.stayDates}`,
      `Beds: ${sampleAirbnbListing.beds}; Guests: up to ${sampleAirbnbListing.guests}`,
    ].join('\n'),
    extractionStatus: 'complete',
  });
  const values = valuesFromFacts(facts, initialValues);
  return {
    mode: 'url',
    url,
    description: '',
    originalDescription: '',
    priceBasis: 'unknown',
    originalPriceBasis: 'unknown',
    priceBasisProvenance: 'missing',
    originalPriceBasisProvenance: 'missing',
    currencyProvenance: 'missing',
    originalCurrencyProvenance: 'missing',
    source,
    facts,
    originalValues: values,
    values,
    messages: '',
    error: null,
    demo: true,
    preview: sampleAirbnbListing,
  };
}

function displayNumber(value: string) {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const checkDrafts = new Map<string, FlowState>();
const researchDrafts = new Map<string, boolean>();
const researchStageLabels: Record<ResearchStage, string> = {
  checking: 'Checking listing details',
  searching: 'Searching public property sources',
  comparing: 'Comparing potential matches',
  photos: 'Checking photos',
  preparing: 'Preparing verification report',
};

export function NewCheckPage() {
  const location = useLocation();
  const restored = location.state as {
    reviewDraft?: FlowState;
    deepResearch?: boolean;
  } | null;
  const [deepResearch, setDeepResearch] = useState(
    () => researchDrafts.get(location.key) ?? restored?.deepResearch ?? false,
  );
  const [researchStage, setResearchStage] = useState<ResearchStage | null>(
    null,
  );
  const researchNavigationKey = useRef(location.key);
  useEffect(() => {
    if (researchNavigationKey.current !== location.key) {
      researchNavigationKey.current = location.key;
      setDeepResearch(researchDrafts.get(location.key) ?? false);
      return;
    }
    researchDrafts.set(location.key, deepResearch);
    if (researchDrafts.size > 8)
      researchDrafts.delete(researchDrafts.keys().next().value!);
  }, [location.key, deepResearch]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const modeIndicator = useRef<HTMLSpanElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const initialAutoSubmit = useRef(false);
  const previousStep = useRef<'input' | 'review' | null>(null);
  const handedOffUrl = params.get('url');
  const [flow, dispatch] = useReducer(
    reducer,
    checkDrafts.get(location.key) ??
      restored?.reviewDraft ?? {
        status: 'input',
        mode: 'url',
        url: params.get('url') ?? '',
        description: '',
        manualPriceBasis: 'unknown',
        priceBasisEdited: false,
        manualValues: { ...initialValues },
        userEdits: {},
        error: null,
      },
  );
  const review =
    flow.status === 'review' || flow.status === 'analyzing' ? flow : null;
  const listingIdentity = review
    ? JSON.stringify([
        review.mode,
        review.url,
        review.originalValues.listingTitle,
        review.originalValues.address,
        review.originalValues.location,
      ])
    : null;
  const previousResearchListing = useRef(listingIdentity);
  useEffect(() => {
    if (listingIdentity) {
      if (
        previousResearchListing.current &&
        previousResearchListing.current !== listingIdentity
      )
        setDeepResearch(false);
      previousResearchListing.current = listingIdentity;
    }
  }, [listingIdentity]);
  const step = review ? 'review' : 'input';
  const inputMode = flow.status === 'input' ? flow.mode : 'url';
  const manualValues =
    flow.status === 'input' ? flow.manualValues : initialValues;

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    checkDrafts.set(
      location.key,
      flow.status === 'analyzing'
        ? { ...flow, status: 'review' }
        : flow.status === 'extracting'
          ? { ...flow, status: 'input', error: null }
          : flow,
    );
    if (checkDrafts.size > 8)
      checkDrafts.delete(checkDrafts.keys().next().value!);
  }, [flow, location.key]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
        intro
          .from('[data-check-reveal="eyebrow"]', {
            y: 8,
            duration: 0.45,
          })
          .from(
            '[data-check-reveal="title"]',
            { y: 20, opacity: 0, duration: 0.8 },
            0.12,
          )
          .from(
            '[data-check-reveal="copy"]',
            { opacity: 0, duration: 0.65 },
            0.38,
          )
          .from(
            '[data-check-reveal="form"]',
            { y: 12, opacity: 0, duration: 0.65, stagger: 0.09 },
            0.55,
          )
          .from(
            '[data-preview-image]',
            { y: 5, opacity: 0, duration: 0.34, ease: 'power2.out' },
            0.28,
          )
          .from(
            '[data-preview-content] > *',
            { y: 4, opacity: 0, duration: 0.24, stagger: 0.04 },
            0.48,
          );
      });
      return () => media.revert();
    },
    { scope: root, dependencies: [step], revertOnUpdate: true },
  );

  useGSAP(
    () => {
      const indicator = modeIndicator.current;
      if (!indicator) return;
      gsap.to(indicator, {
        xPercent: inputMode === 'manual' ? 100 : 0,
        duration: 0.32,
        ease: 'power3.out',
        overwrite: true,
      });
    },
    { scope: root, dependencies: [inputMode] },
  );

  useEffect(() => {
    if (!handedOffUrl || initialAutoSubmit.current) return;
    initialAutoSubmit.current = true;
    queueMicrotask(() =>
      root.current
        ?.querySelector<HTMLFormElement>('.check-url-form')
        ?.requestSubmit(),
    );
  }, [handedOffUrl]);
  useEffect(() => {
    if (flow.status !== 'input' || flow.mode !== 'url') return;

    const submitOnEnter = (event: KeyboardEvent) => {
      if (
        event.key !== 'Enter' ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;

      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, button, a, summary, [contenteditable="true"], [role="button"]',
        )
      )
        return;

      const form =
        root.current?.querySelector<HTMLFormElement>('.check-url-form');
      if (!form || form.querySelector('button:disabled')) return;

      event.preventDefault();
      form.requestSubmit();
    };

    window.addEventListener('keydown', submitOnEnter);
    return () => window.removeEventListener('keydown', submitOnEnter);
  }, [flow.mode, flow.status]);
  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
    if (previousStep.current && previousStep.current !== step) {
      heading.current?.focus({ preventScroll: true });
    }
    previousStep.current = step;
  }, [step]);

  async function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (controller.current || flow.status !== 'input') return;
    const value = flow.url.trim();
    let url: URL;
    try {
      url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        !url.hostname.includes('.')
      ) {
        throw new Error('invalid');
      }
    } catch {
      dispatch({
        type: 'input-error',
        message: 'Enter a valid property listing URL.',
      });
      return;
    }
    if (import.meta.env.DEV && params.get('sample') === '1') {
      dispatch({ type: 'review', data: createSampleHome(url.href) });
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
    const timeoutId = window.setTimeout(
      () => activeController.abort('timeout'),
      25_000,
    );
    const requestId = ++requestSequence.current;
    dispatch({ type: 'extracting', url: url.href, requestId });
    try {
      const result = await extractListingUrl(url.href, activeController.signal);
      if (!extractionResponseIsCurrent(requestId, requestSequence.current))
        return;
      if (result.source.extractionStatus !== 'complete') {
        dispatch({
          type: 'input-error',
          message:
            'We couldn’t identify enough property details. You can enter them manually.',
        });
        return;
      }
      const extractedPriceBasis = priceBasisFromFacts(
        result.facts,
        result.priceBasis,
      );
      let priceBasis = extractedPriceBasis;
      const originalValues = valuesFromFacts(result.facts, initialValues);
      const values = { ...originalValues };
      let sameListing = false;
      if (flow.url) {
        try {
          const previousUrl = new URL(flow.url);
          sameListing =
            previousUrl.origin === url.origin &&
            previousUrl.pathname.replace(/\/$/, '') ===
              url.pathname.replace(/\/$/, '');
        } catch {
          sameListing = false;
        }
      }
      preserveEnteredAddress(
        values,
        flow.manualValues.address ?? '',
        sameListing,
      );
      if (sameListing)
        Object.assign(
          values,
          applyReviewValueOverrides(values, flow.userEdits),
        );
      if (sameListing && flow.priceBasisEdited)
        priceBasis = flow.manualPriceBasis;
      let currencySelection = currencyForFacts(result.facts, result.currency);
      if (sameListing && Object.hasOwn(flow.userEdits, 'currency'))
        currencySelection = {
          value: flow.userEdits.currency ?? '',
          provenance: 'user_provided',
        };
      values.currency = currencySelection.value;
      const descriptionState = hydrateDescription(result.description);
      if (!values.listingTitle)
        values.listingTitle = result.listingTitle || result.fallbackTitle || '';
      dispatch({
        type: 'review',
        data: {
          mode: 'url',
          url: url.href,
          ...descriptionState,
          priceBasis,
          originalPriceBasis: extractedPriceBasis,
          priceBasisProvenance:
            sameListing && flow.priceBasisEdited
              ? 'user_provided'
              : hasPriceBasisEvidence(result.facts, extractedPriceBasis)
                ? 'extracted'
                : 'missing',
          originalPriceBasisProvenance: hasPriceBasisEvidence(
            result.facts,
            extractedPriceBasis,
          )
            ? 'extracted'
            : 'missing',
          currencyProvenance: currencySelection.provenance,
          originalCurrencyProvenance: currencySelection.provenance,
          stayNights:
            sameListing && flow.userEdits.stayNights
              ? Number(flow.userEdits.stayNights)
              : (result.bookingContext?.nights ??
                stayNightsFromListing(url.href, result.facts)),
          bookingContext: result.bookingContext,
          source: result.source,
          facts: result.facts,
          originalValues,
          values,
          listingImage: result.listingImage,
          extractionWarnings: result.extractionWarnings,
          titleIsFallback: result.titleIsFallback,
          descriptionIsFallback: result.descriptionIsFallback,
          preview: previewSupplement(
            result.facts,
            result.listingImage,
            result.description,
            stayDatesFromUrl(url.href),
          ),
          messages: '',
          error: null,
        },
      });
    } catch (error) {
      if (activeController.signal.aborted) {
        if (activeController.signal.reason === 'timeout') {
          dispatch({
            type: 'input-error',
            message:
              'This listing is taking too long to respond. Try again or enter the details manually.',
          });
        }
        return;
      }
      dispatch({
        type: 'input-error',
        message:
          error instanceof Error
            ? error.message
            : 'We couldn’t read this listing. Please try again.',
      });
    } finally {
      window.clearTimeout(timeoutId);
      if (controller.current === activeController) controller.current = null;
    }
  }

  async function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flow.status !== 'input') return;
    const values = flow.manualValues;
    if (!Object.values(values).some((value) => value.trim())) {
      dispatch({
        type: 'input-error',
        message: 'Add at least one property detail to continue.',
      });
      return;
    }
    const priceKey = priceValueKey(flow.manualPriceBasis);
    for (const field of [
      priceKey,
      'depositAmount',
      'bedroomCount',
      'bathroomCount',
      'bedCount',
      'maxGuests',
      'stayNights',
    ]) {
      if (values[field].trim() && displayNumber(values[field]) === null) {
        dispatch({
          type: 'input-error',
          message: `${field === priceKey ? 'Price' : fieldLabels[field]} must be a valid non-negative number.`,
        });
        return;
      }
    }
    for (const field of [
      'bedroomCount',
      'bedCount',
      'maxGuests',
      'stayNights',
    ]) {
      const value = values[field].trim();
      if (value && !Number.isInteger(Number(value))) {
        dispatch({
          type: 'input-error',
          message: `${fieldLabels[field]} must be a whole number.`,
        });
        return;
      }
    }
    try {
      const sourceId = `manual-source-${crypto.randomUUID()}`;
      const enteredFacts = factsFromManualValues(
        values,
        sourceId,
        flow.manualPriceBasis,
      );
      const extractedText = [
        ...enteredFacts.map((fact) => fact.quotedEvidence),
        flow.description.trim(),
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 20_000);
      const issued = await extractText(
        extractedText,
        'listing_text',
        'Manually entered property details',
        undefined,
        'user_assertion',
      );
      const source = issued.source;
      const facts = enteredFacts.map((fact) =>
        ExtractedFactSchema.parse({ ...fact, sourceId: source.id }),
      );
      const reviewValues = {
        ...initialValues,
        ...values,
        listingPrice: values.listingPrice,
        monthlyRent: values.monthlyRent,
      };
      dispatch({
        type: 'review',
        data: {
          mode: 'manual',
          url: '',
          description: flow.description,
          originalDescription: flow.description,
          priceBasis: flow.manualPriceBasis,
          originalPriceBasis: flow.manualPriceBasis,
          priceBasisProvenance:
            flow.manualPriceBasis !== 'unknown' ? 'user_provided' : 'missing',
          originalPriceBasisProvenance:
            flow.manualPriceBasis !== 'unknown' ? 'user_provided' : 'missing',
          currencyProvenance: values.currency.trim()
            ? 'user_provided'
            : 'missing',
          originalCurrencyProvenance: values.currency.trim()
            ? 'user_provided'
            : 'missing',
          stayNights:
            values.stayNights.trim() &&
            Number.isInteger(Number(values.stayNights)) &&
            Number(values.stayNights) > 0
              ? Number(values.stayNights)
              : undefined,
          source,
          facts,
          originalValues: reviewValues,
          values: reviewValues,
          messages: '',
          error: null,
          demo: false,
        },
      });
    } catch (error) {
      dispatch({
        type: 'input-error',
        message:
          error instanceof Error
            ? error.message
            : 'Could not process the entered property details.',
      });
    }
  }

  async function submitAnalysis() {
    if (!review || flow.status !== 'review') return;
    if (controller.current) return;
    const hasFacts =
      Object.values(review.values).some((value) => value.trim()) ||
      review.description.trim().length > 0;
    if (!hasFacts) {
      dispatch({
        type: 'patch-review',
        patch: { error: 'Add at least one property detail before continuing.' },
      });
      return;
    }
    const priceKey = priceValueKey(review.priceBasis);
    const contextualPriceLabel = priceLabel(review.priceBasis, review.preview);
    const priceAmount = review.values[priceKey] ?? '';
    const originalPriceAmount = review.originalValues[priceKey] ?? '';
    for (const field of [
      priceKey,
      'depositAmount',
      'bedroomCount',
      'bathroomCount',
    ]) {
      const value = review.values[field] ?? '';
      if (value.trim() && displayNumber(value) === null) {
        dispatch({
          type: 'patch-review',
          patch: {
            error: `${field === priceKey ? contextualPriceLabel : fieldLabels[field]} must be a valid non-negative number.`,
          },
        });
        return;
      }
      if (
        field === 'bedroomCount' &&
        value.trim() &&
        !Number.isInteger(Number(value))
      ) {
        dispatch({
          type: 'patch-review',
          patch: { error: 'Bedrooms must be a whole number.' },
        });
        return;
      }
    }
    if (review.demo) {
      navigate('/results?sample=1');
      return;
    }
    const activeController = new AbortController();
    controller.current = activeController;
    setResearchStage(null);
    dispatch({ type: 'analyzing' });
    try {
      const evidence = await buildAnalysisEvidence({
        source: review.source,
        facts: review.facts,
        values: review.values,
        originalValues: review.originalValues,
        description: review.description,
        originalDescription: review.originalDescription,
        messages: review.messages,
        fieldLabels,
        extractText,
        priceLabel: contextualPriceLabel,
        priceAmount,
        originalPriceAmount,
        priceBasis: review.priceBasis,
        originalPriceBasis: review.originalPriceBasis,
        currency: review.values.currency,
        currencyProvenance: review.currencyProvenance,
        originalCurrencyProvenance: review.originalCurrencyProvenance,
        priceBasisProvenance: review.priceBasisProvenance,
        originalPriceBasisProvenance: review.originalPriceBasisProvenance,
        stayNights: review.stayNights,
        signal: activeController.signal,
      });
      const request = AnalysisRequestSchema.parse({
        ...evidence,
        deepResearch,
      });
      const result = await analyzeVerification(
        request,
        activeController.signal,
        setResearchStage,
      );
      navigate('/results', {
        state: {
          report: result,
          request,
          listingImageUrl: review.listingImage?.url ?? review.preview?.imageUrl,
          reviewDraft: review,
          deepResearch,
        },
      });
    } catch (error) {
      if (activeController.signal.aborted) return;
      dispatch({
        type: 'analysis-error',
        message:
          error instanceof Error
            ? error.message
            : 'Analysis could not be completed. Your details are saved on this page.',
      });
    } finally {
      if (controller.current === activeController) controller.current = null;
    }
  }

  const isExtracting = flow.status === 'extracting';
  const supplementaryDetails = review
    ? listingDetailsFromFacts(review.facts, review.stayNights)
    : [];
  const fields = reviewFieldOrder.map(
    (field) =>
      [
        field,
        field === 'priceBasis' ? 'Price type' : fieldLabels[field],
      ] as const,
  );
  const patchManualValue = (field: string, value: string) =>
    dispatch({
      type: 'patch-input',
      patch: { manualValues: { ...manualValues, [field]: value } },
    });
  const manualInput = (
    field: string,
    label: string,
    placeholder: string,
    type = 'text',
  ) => (
    <label key={field}>
      <span>{label}</span>
      <input
        type={type === 'number' ? 'text' : type}
        inputMode={
          type === 'number'
            ? field === 'bathroomCount'
              ? 'decimal'
              : 'numeric'
            : undefined
        }
        value={manualValues[field] ?? ''}
        placeholder={placeholder}
        onChange={(event) =>
          patchManualValue(
            field,
            type === 'number'
              ? normalizeCountInput(
                  event.currentTarget.value,
                  field === 'bathroomCount',
                )
              : event.currentTarget.value,
          )
        }
      />
    </label>
  );
  const manualTextarea = (
    field: string,
    label: string,
    placeholder: string,
  ) => (
    <label
      className="listing-detail-item listing-detail-item--editable manual-detail-textarea"
      key={field}
    >
      <span>{label}</span>
      <textarea
        rows={3}
        value={manualValues[field] ?? ''}
        placeholder={placeholder}
        onChange={(event) => patchManualValue(field, event.currentTarget.value)}
      />
    </label>
  );

  return (
    <div ref={root} className={`workflow-page check-page check-page--${step}`}>
      {step === 'input' ? (
        <section
          className="check-layout check-layout--input"
          aria-labelledby="check-title"
        >
          <div className="check-copy">
            <CheckProgress current={1} />
            <h1
              ref={heading}
              tabIndex={-1}
              id="check-title"
              data-check-reveal="title"
            >
              {flow.status === 'input' && flow.mode === 'manual' ? (
                <>
                  Tell us about
                  <br />
                  <span>the listing</span>
                </>
              ) : (
                <>
                  Start with the
                  <br />
                  <span>listing URL</span>
                </>
              )}
            </h1>
            <p className="check-intro" data-check-reveal="copy">
              {flow.status === 'input' && flow.mode === 'manual'
                ? 'Enter the details you know. Leave uncertain ones blank as you get ready to review the listing.'
                : 'Share a property listing link. Sniffo will extract the details available for you to review.'}
            </p>
            <div
              className="check-mode"
              aria-label="Property information method"
              data-check-reveal="form"
            >
              <span
                ref={modeIndicator}
                className="check-mode-indicator"
                aria-hidden="true"
              />
              <button
                type="button"
                aria-pressed={flow.status === 'input' && flow.mode === 'url'}
                disabled={flow.status !== 'input'}
                className={
                  flow.status === 'input' && flow.mode === 'url'
                    ? 'is-active'
                    : ''
                }
                onClick={() =>
                  dispatch({ type: 'patch-input', patch: { mode: 'url' } })
                }
              >
                <LinkIcon size={19} aria-hidden="true" /> Property URL
              </button>
              <button
                type="button"
                aria-pressed={flow.status === 'input' && flow.mode === 'manual'}
                disabled={flow.status !== 'input'}
                className={
                  flow.status === 'input' && flow.mode === 'manual'
                    ? 'is-active'
                    : ''
                }
                onClick={() =>
                  dispatch({ type: 'patch-input', patch: { mode: 'manual' } })
                }
              >
                <FileText size={19} aria-hidden="true" /> Manual input
              </button>
            </div>
            {(flow.status === 'input' && flow.mode === 'url') ||
            isExtracting ? (
              <form
                className="check-url-form"
                noValidate
                onSubmit={submitUrl}
                data-check-reveal="form"
              >
                <label htmlFor="listing-url" className="sr-only">
                  Property listing URL
                </label>
                <LinkIcon size={21} aria-hidden="true" />
                <input
                  id="listing-url"
                  type="url"
                  required
                  value={flow.url}
                  onChange={(event) =>
                    dispatch({
                      type: 'patch-input',
                      patch: { url: event.currentTarget.value },
                    })
                  }
                  placeholder="Paste a property listing URL here..."
                  aria-invalid={flow.status === 'input' && !!flow.error}
                  aria-describedby={
                    flow.status === 'input' && flow.error
                      ? 'check-error'
                      : isExtracting
                        ? 'extract-status'
                        : undefined
                  }
                  disabled={isExtracting}
                />
                <button
                  type="submit"
                  aria-label={isExtracting ? 'Reading listing' : 'Read listing'}
                  disabled={isExtracting}
                >
                  {isExtracting ? (
                    <LoaderCircle
                      className="check-spinner"
                      size={23}
                      aria-hidden="true"
                    />
                  ) : (
                    <ArrowRight size={23} aria-hidden="true" />
                  )}
                </button>
              </form>
            ) : null}
            {flow.status === 'input' && flow.mode === 'manual' ? (
              <form
                className="manual-entry"
                onSubmit={submitManual}
                data-check-reveal="form"
              >
                <div className="manual-fields manual-property-fields">
                  {manualInput(
                    'listingTitle',
                    'Property title',
                    'Modern 2BR Apartment',
                  )}
                  {manualInput(
                    'propertyType',
                    'Property type',
                    'Entire rental unit',
                  )}
                  {manualInput('location', 'Location', 'Bangkok, Thailand')}
                  {manualInput(
                    'address',
                    'Address (optional)',
                    '18 Sukhumvit Road, Bangkok',
                  )}
                  <label>
                    <span>Price</span>
                    <AmountInput
                      value={
                        manualValues[priceValueKey(flow.manualPriceBasis)] ?? ''
                      }
                      placeholder="Enter price (optional)"
                      onChange={(value) =>
                        patchManualValue(
                          priceValueKey(flow.manualPriceBasis),
                          value,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>
                      {manualValues.currency
                        ? `Deposit (${manualValues.currency})`
                        : 'Deposit (optional)'}
                    </span>
                    <AmountInput
                      value={manualValues.depositAmount}
                      placeholder="Enter deposit (optional)"
                      onChange={(value) =>
                        patchManualValue('depositAmount', value)
                      }
                    />
                  </label>
                  <div className="manual-entry-field">
                    <span id="manual-currency-label">Currency</span>
                    <CurrencySelect
                      value={manualValues.currency}
                      labelledBy="manual-currency-label"
                      onChange={(value) => patchManualValue('currency', value)}
                    />
                  </div>
                  <div className="manual-entry-field">
                    <span id="manual-price-basis-label">Price type</span>
                    <CurrencySelect
                      value={
                        flow.manualPriceBasis === 'unknown'
                          ? ''
                          : flow.manualPriceBasis
                      }
                      labelledBy="manual-price-basis-label"
                      options={priceBasisOptions.filter(
                        (option) => option.value !== 'unknown',
                      )}
                      placeholder="Select price type"
                      onChange={(value) => {
                        const nextBasis = value as PriceBasis;
                        const amount =
                          manualValues[priceValueKey(flow.manualPriceBasis)] ??
                          '';
                        dispatch({
                          type: 'patch-input',
                          patch: {
                            manualPriceBasis: nextBasis,
                            manualValues: {
                              ...manualValues,
                              [priceValueKey(nextBasis)]: amount,
                            },
                          },
                        });
                      }}
                    />
                  </div>
                  {manualInput('bedroomCount', 'Bedrooms', '2', 'number')}
                  {manualInput('bathroomCount', 'Bathrooms', '2', 'number')}
                </div>
                <details className="additional-property-details manual-additional-details">
                  <summary>
                    <span>Additional listing details</span>
                    <small>Optional</small>
                  </summary>
                  <div className="manual-additional-fields">
                    {manualInput(
                      'bedCount',
                      'Beds',
                      'Enter beds (optional)',
                      'number',
                    )}
                    {manualInput(
                      'maxGuests',
                      'Maximum guests',
                      'Enter guest capacity (optional)',
                      'number',
                    )}
                    {manualInput('hostName', 'Host', 'Enter host (optional)')}
                    {manualInput(
                      'stayNights',
                      'Stay duration (nights)',
                      'Enter nights (optional)',
                      'number',
                    )}
                    {manualTextarea(
                      'houseRule',
                      'House rules',
                      'Enter one rule per line (optional)',
                    )}
                    {manualTextarea(
                      'amenity',
                      'Amenities',
                      'Enter one amenity per line (optional)',
                    )}
                  </div>
                </details>
                <details className="additional-property-details listing-description-details">
                  <summary>
                    <span>Listing description</span>
                    <small>
                      {flow.description
                        ? `${Array.from(flow.description).length.toLocaleString()} characters`
                        : 'Optional'}
                    </small>
                  </summary>
                  <label className="messages-field">
                    <span>Description</span>
                    <textarea
                      rows={4}
                      maxLength={20_000}
                      value={flow.description}
                      onChange={(event) =>
                        dispatch({
                          type: 'patch-input',
                          patch: { description: event.currentTarget.value },
                        })
                      }
                      placeholder="Enter the listing description (optional)"
                    />
                  </label>
                </details>
                <PrimaryButton className="manual-continue" type="submit">
                  Review details <ArrowRight size={18} aria-hidden="true" />
                </PrimaryButton>
              </form>
            ) : null}
            {isExtracting ? (
              <p
                id="extract-status"
                role="status"
                className="check-loading-status check-loading-status--extract"
              >
                Reading listing…
              </p>
            ) : null}
            {flow.status === 'input' && flow.error ? (
              <div className="check-error" id="check-error" role="alert">
                <p>{flow.error}</p>
                {flow.mode === 'url' ? (
                  <button
                    type="button"
                    onClick={() => void submitUrlFromRetry()}
                  >
                    Retry
                  </button>
                ) : null}
                <button
                  type="button"
                  className="error-manual-link"
                  onClick={() =>
                    dispatch({
                      type: 'patch-input',
                      patch: { mode: flow.mode === 'url' ? 'manual' : 'url' },
                    })
                  }
                >
                  Use {flow.mode === 'url' ? 'manual input' : 'a property URL'}{' '}
                  instead
                </button>
              </div>
            ) : null}
          </div>
          <figure className="check-art" data-check-reveal="art">
            <img
              src={stepTwoArtwork}
              width="1536"
              height="1024"
              alt="Sniffo fox beside a placeholder property listing"
              fetchPriority="high"
              decoding="async"
            />
            <div
              className="property-preview-card property-preview-card--skeleton"
              aria-hidden="true"
            >
              <div className="property-preview-image">
                <div className="preview-skeleton-photo" />
              </div>
              <div className="property-preview-content">
                <div className="preview-skeleton-line" />
                <div className="preview-skeleton-line preview-skeleton-line--short" />
                <div className="preview-skeleton-line preview-skeleton-line--price" />
                <div className="preview-skeleton-specs">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          </figure>
        </section>
      ) : review ? (
        <section
          className="check-layout check-layout--review"
          aria-labelledby="check-title"
        >
          <div className="review-column">
            <CheckProgress current={2} />
            <h1
              ref={heading}
              tabIndex={-1}
              id="check-title"
              data-check-reveal="title"
            >
              Review your
              <br />
              <span>property details</span>
            </h1>
            <p className="check-intro" data-check-reveal="copy">
              Review the property details below. Correct anything that looks
              wrong, and add supporting evidence if you have it.
            </p>
            {flow.status === 'analyzing' ? (
              <p
                className="check-loading-status check-loading-status--analysis"
                role="status"
                aria-live="polite"
              >
                {deepResearch && researchStage
                  ? `${researchStageLabels[researchStage]}…`
                  : 'Analyzing property…'}
              </p>
            ) : null}
            <section
              className="details-panel"
              data-check-reveal="form"
              aria-labelledby="details-heading"
            >
              <div className="panel-heading">
                <div>
                  <h2 id="details-heading">Property details</h2>
                </div>
              </div>
              {review.mode === 'url' && review.facts.length === 0 ? (
                <p className="unknown-note">
                  No property details were returned by the listing source. Enter
                  any details you know below.
                </p>
              ) : null}
              <div className="property-fields">
                {fields.map(([field, label]) =>
                  field === 'monthlyRent' ? (
                    <div
                      className="property-field price-edit-field"
                      key={field}
                    >
                      <label>
                        <span>Price</span>
                        <AmountInput
                          disabled={flow.status === 'analyzing'}
                          value={
                            review.values[priceValueKey(review.priceBasis)] ??
                            ''
                          }
                          placeholder="Enter price (optional)"
                          onChange={(value) =>
                            dispatch({
                              type: 'patch-review',
                              patch: {
                                values: {
                                  ...review.values,
                                  [priceValueKey(review.priceBasis)]: value,
                                },
                                ...(value.trim() &&
                                review.currencyProvenance === 'suggested'
                                  ? { currencyProvenance: 'user_provided' }
                                  : {}),
                              },
                            })
                          }
                        />
                      </label>
                      {review.mode === 'url' &&
                      !hasReliableListingPrice(review.facts) &&
                      !review.values[
                        priceValueKey(review.priceBasis)
                      ]?.trim() ? (
                        <small className="price-lookup-note" role="status">
                          Price unavailable from this link. Enter it if known.
                        </small>
                      ) : null}
                    </div>
                  ) : field === 'currency' ? (
                    <div className="property-field" key={field}>
                      <span id="review-currency-label">{label}</span>
                      <CurrencySelect
                        disabled={flow.status === 'analyzing'}
                        value={review.values.currency}
                        labelledBy="review-currency-label"
                        onChange={(value) =>
                          dispatch({
                            type: 'patch-review',
                            patch: {
                              values: { ...review.values, currency: value },
                              currencyProvenance: value
                                ? 'user_provided'
                                : 'missing',
                            },
                          })
                        }
                      />
                    </div>
                  ) : field === 'priceBasis' ? (
                    <div className="property-field" key={field}>
                      <span id="review-price-basis-label">{label}</span>
                      <CurrencySelect
                        disabled={flow.status === 'analyzing'}
                        value={
                          review.priceBasis === 'unknown' &&
                          review.priceBasisProvenance !== 'user_provided'
                            ? ''
                            : review.priceBasis
                        }
                        labelledBy="review-price-basis-label"
                        options={priceBasisOptions}
                        placeholder="Select price type"
                        onChange={(value) => {
                          const nextBasis = value as PriceBasis;
                          const amount =
                            review.values[priceValueKey(review.priceBasis)] ??
                            '';
                          dispatch({
                            type: 'patch-review',
                            patch: {
                              priceBasis: nextBasis,
                              priceBasisProvenance: 'user_provided',
                              values: {
                                ...review.values,
                                [priceValueKey(nextBasis)]: amount,
                              },
                            },
                          });
                        }}
                      />
                    </div>
                  ) : (
                    <label key={field}>
                      <span>{label}</span>
                      <input
                        disabled={flow.status === 'analyzing'}
                        type="text"
                        inputMode={
                          numericFields.has(field)
                            ? field === 'bathroomCount'
                              ? 'decimal'
                              : 'numeric'
                            : undefined
                        }
                        value={
                          field === 'propertyType'
                            ? displayPropertyType(review.values[field] ?? '')
                            : (review.values[field] ?? '')
                        }
                        placeholder={
                          field === 'listingTitle'
                            ? 'Enter property title'
                            : field === 'propertyType'
                              ? 'Enter property type'
                              : field === 'location'
                                ? 'Enter location'
                                : field === 'bedroomCount'
                                  ? 'Enter bedrooms (optional)'
                                  : 'Enter bathrooms (optional)'
                        }
                        onChange={(event) =>
                          dispatch({
                            type: 'patch-review',
                            patch: {
                              values: {
                                ...review.values,
                                [field]: numericFields.has(field)
                                  ? normalizeCountInput(
                                      event.currentTarget.value,
                                      field === 'bathroomCount',
                                    )
                                  : event.currentTarget.value,
                              },
                            },
                          })
                        }
                      />
                    </label>
                  ),
                )}
              </div>
              <details className="additional-property-details">
                <summary>
                  <span>Additional listing details</span>
                  <small>
                    {supplementaryDetails.length
                      ? `${supplementaryDetails.length} found`
                      : 'Optional'}
                  </small>
                </summary>
                <dl>
                  <div className="listing-detail-item listing-detail-item--editable">
                    <dt>Address</dt>
                    <dd>
                      <input
                        aria-label="Address"
                        disabled={flow.status === 'analyzing'}
                        value={review.values.address}
                        placeholder="Enter address (optional)"
                        onChange={(event) =>
                          dispatch({
                            type: 'patch-review',
                            patch: {
                              values: {
                                ...review.values,
                                address: event.currentTarget.value,
                              },
                            },
                          })
                        }
                      />
                    </dd>
                  </div>
                  <div className="listing-detail-item listing-detail-item--editable">
                    <dt>Deposit ({review.values.currency || 'amount'})</dt>
                    <dd>
                      <AmountInput
                        disabled={flow.status === 'analyzing'}
                        value={review.values.depositAmount}
                        placeholder="Enter deposit (optional)"
                        onChange={(value) =>
                          dispatch({
                            type: 'patch-review',
                            patch: {
                              values: {
                                ...review.values,
                                depositAmount: value,
                              },
                            },
                          })
                        }
                      />
                    </dd>
                  </div>
                  {supplementaryDetails.map((detail, index) => (
                    <div
                      className={`listing-detail-item listing-detail-item--${detail.field}`}
                      key={`${detail.field}-${index}`}
                    >
                      <dt>{detail.label}</dt>
                      <dd>{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <details className="additional-property-details listing-description-details">
                <summary>
                  <span>Listing description</span>
                  <small>
                    {review.description
                      ? `${Array.from(review.description).length.toLocaleString()} characters`
                      : 'Not provided'}
                  </small>
                </summary>
                <label className="messages-field">
                  <span>Description</span>
                  <textarea
                    disabled={flow.status === 'analyzing'}
                    rows={4}
                    value={review.description}
                    onChange={(event) =>
                      dispatch({
                        type: 'patch-review',
                        patch: { description: event.currentTarget.value },
                      })
                    }
                    placeholder="Description not provided by the listing."
                  />
                </label>
              </details>
            </section>
            <section
              className="deep-research-control"
              aria-label="Deep Research"
            >
              <div>
                <label htmlFor="deep-research">
                  <strong>Deep research</strong>
                  <span className="research-optional">Optional</span>
                </label>
                <p>
                  Search related listings and compare photos with AI. This takes
                  longer and may use OpenAI credits.
                </p>
              </div>
              <input
                id="deep-research"
                type="checkbox"
                role="switch"
                checked={deepResearch}
                disabled={flow.status === 'analyzing'}
                onChange={(event) =>
                  setDeepResearch(event.currentTarget.checked)
                }
              />
            </section>
            <section
              className="evidence-panel"
              data-check-reveal="form"
              aria-labelledby="evidence-heading"
            >
              <div className="evidence-panel-title">
                <MessageSquareText size={19} aria-hidden="true" />
                <div>
                  <h2 id="evidence-heading">Add additional evidence</h2>
                </div>
              </div>
              <label className="messages-field">
                <span>Landlord messages (optional)</span>
                <textarea
                  disabled={flow.status === 'analyzing'}
                  rows={3}
                  value={review.messages}
                  onChange={(event) =>
                    dispatch({
                      type: 'patch-review',
                      patch: { messages: event.currentTarget.value },
                    })
                  }
                  placeholder="Paste relevant landlord messages here…"
                />
              </label>
            </section>
            {review.error ? (
              <p className="review-error" role="alert">
                {review.error}
              </p>
            ) : null}
            <div className="review-actions">
              <button
                type="button"
                className="check-back"
                onClick={() => dispatch({ type: 'back-to-input' })}
                disabled={flow.status === 'analyzing'}
              >
                <ArrowLeft size={17} aria-hidden="true" /> Back
              </button>
              <PrimaryButton
                className="review-continue"
                onClick={() => void submitAnalysis()}
                disabled={flow.status === 'analyzing'}
              >
                {flow.status === 'analyzing' ? (
                  <>
                    <LoaderCircle className="check-spinner" size={17} />{' '}
                    Preparing analysis…
                  </>
                ) : (
                  <>
                    Continue to analysis{' '}
                    <ArrowRight size={18} aria-hidden="true" />
                  </>
                )}
              </PrimaryButton>
            </div>
          </div>
          <figure
            className="check-art check-art--review"
            data-check-reveal="art"
          >
            <img
              src={stepTwoArtwork}
              width="1536"
              height="1024"
              alt="Sniffo fox in a bright room beside the property listing"
              loading="eager"
              decoding="async"
            />
            <PropertyPreviewCard
              property={mapPropertyPreview(review.values, review.preview)}
            />
          </figure>
        </section>
      ) : null}
    </div>
  );

  async function submitUrlFromRetry() {
    const form =
      root.current?.querySelector<HTMLFormElement>('.check-url-form');
    if (form)
      await submitUrl({
        preventDefault() {},
        currentTarget: form,
      } as FormEvent<HTMLFormElement>);
  }
}
