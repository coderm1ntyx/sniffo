import { env } from '../src/config/env.js';
import { retrievePublicPage } from '../src/services/research/publicSources.js';
import { runResearch } from '../src/services/research/orchestrator.js';
import { skippedVision } from '../src/services/research/vision.js';

const url = process.argv.find((a) => a.startsWith('https://'));
if (!url)
  throw new Error(
    'Supply one public HTTPS property URL. Add --vision only to authorize an optional billable photo comparison.',
  );
const data = await retrievePublicPage(
  url,
  AbortSignal.timeout(env.DEEP_RESEARCH_TIMEOUT_MS),
);
const result = await runResearch(
  [data.source],
  data.source.normalizedFacts ?? [],
  undefined,
  {
    ...(process.argv.includes('--vision')
      ? {}
      : {
          vision: async () =>
            skippedVision(
              'Live Vision smoke test was not explicitly authorized with --vision.',
            ),
        }),
  },
);
console.info(
  JSON.stringify(
    {
      provider: env.DEEP_RESEARCH_SEARCH_PROVIDER,
      status: result.status,
      queries: result.queriesAttempted,
      reviewed: result.candidatesReviewed,
      vision: result.visualAnalysis.status,
      limitations: result.limitations,
    },
    null,
    2,
  ),
);
