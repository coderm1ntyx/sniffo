import { AnalysisRequestSchema, AnalysisResultSchema } from '@sniffo/shared';
// Explicitly fictional fixtures. They are never used as an API fallback.
export const sampleRequest = AnalysisRequestSchema.parse({
  sources: [
    {
      id: 'example-listing',
      type: 'listing_text',
      name: 'Fictional Garden Apartment listing',
      originalUrl: null,
      extractedText:
        'Monthly rent: THB 18,000. Deposit: one month. Address: 12 Garden Lane, unit 4.',
      extractionStatus: 'complete',
    },
    {
      id: 'example-message',
      type: 'conversation_text',
      name: 'Fictional landlord message',
      originalUrl: null,
      extractedText:
        'The deposit is THB 36,000. Please transfer it before we arrange a viewing.',
      extractionStatus: 'complete',
    },
  ],
  facts: [
    {
      id: 'example-deposit-listing',
      sourceId: 'example-listing',
      fieldName: 'depositAmount',
      normalizedValue: 18000,
      quotedEvidence: 'Monthly rent: THB 18,000. Deposit: one month.',
    },
    {
      id: 'example-deposit-message',
      sourceId: 'example-message',
      fieldName: 'depositAmount',
      normalizedValue: 36000,
      quotedEvidence: 'The deposit is THB 36,000.',
    },
  ],
});
export const sampleReport = AnalysisResultSchema.parse({
  riskAssessment: {
    score: 62,
    level: 'elevated',
    shortReason:
      'The deposit differs between sources. The submitted listing includes a stated rent and property address; those details can be checked, but do not prove the listing is genuine.',
    reasonsFor: [
      'The fictional sources disagree about the deposit.',
      'The fictional message requests payment before a viewing.',
    ],
    reasonsAgainst: [
      'The fictional listing includes a stated rent and property address.',
    ],
    limitations: [
      'This score is a rule-based signal from fictional demonstration data, not a verified statistical probability.',
      'The score does not confirm property ownership, landlord identity, or legal authority to rent.',
    ],
  },
  summary:
    'In this fictional example, the listing and landlord message disagree about the deposit. The message also requests payment before a viewing. No external records were checked.',
  propertyFacts: {
    listingTitle: 'Fictional Garden Apartment',
    propertyType: 'Apartment',
    location: null,
    address: '12 Garden Lane, unit 4',
    monthlyRent: 18000,
    currency: 'THB',
    depositAmount: null,
    bedroomCount: null,
    bathroomCount: null,
    listingUrl: null,
  },
  findings: [
    {
      id: 'example-deposit',
      category: 'confirmed_inconsistency',
      severity: 'medium',
      title: 'The deposit differs between sources',
      description:
        'The fictional listing describes a one-month deposit of THB 18,000; the message asks for THB 36,000.',
      referencedEvidence: [
        'example-deposit-listing',
        'example-deposit-message',
      ],
      recommendedAction:
        'Confirm the correct deposit and refund conditions in writing before paying.',
    },
    {
      id: 'example-payment',
      category: 'potential_warning_sign',
      severity: 'medium',
      title: 'Payment requested before a viewing',
      description:
        'The fictional message asks for a transfer before arranging a viewing. This warrants checking; it is not proof of fraud.',
      referencedEvidence: ['example-message'],
      recommendedAction:
        'Arrange a viewing and independently confirm the recipient’s authority before transferring money.',
    },
    {
      id: 'example-authority',
      category: 'unable_to_verify',
      severity: 'info',
      title: 'Authority to rent remains unverified',
      description:
        'Neither fictional source establishes the sender’s authority to rent the apartment.',
      referencedEvidence: ['example-listing', 'example-message'],
      recommendedAction:
        'Request evidence that the person offering the property is authorized to rent it.',
    },
  ],
  recommendations: [
    'Confirm the correct deposit and refund conditions in writing before paying.',
    'Arrange a viewing and independently confirm the recipient’s authority before transferring money.',
    'Request evidence that the person offering the property is authorized to rent it.',
  ],
});
