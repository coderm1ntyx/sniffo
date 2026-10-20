import {
  AnalysisRequestSchema,
  AnalysisResponseSchema,
  ApiErrorSchema,
  ExtractionResponseSchema,
  HealthResponseSchema,
  UrlExtractionRequestSchema,
  TextExtractionRequestSchema,
  type ApiError,
  ResearchStageSchema,
  TtsReportRequestSchema,
  type ResearchStage,
} from '@sniffo/shared';

const apiBase =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ??
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') ??
  '';
export async function getHealth() {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/health`);
  } catch {
    throw new Error(
      'Could not reach the Sniffo API. Check that the backend is running.',
    );
  }
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = (await response.json()) as ApiError;
    } catch {
      /* response may not be JSON */
    }
    throw new Error(
      error?.error?.message ?? `API request failed (${response.status})`,
    );
  }
  const payload: unknown = await response.json();
  return HealthResponseSchema.parse(payload).data;
}

async function postJson(path: string, body: unknown, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    throw new Error(
      'We couldn’t connect to Sniffo right now. Please try again.',
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsedError = ApiErrorSchema.safeParse(payload);
    if (parsedError.success) {
      const apiError: ApiError = parsedError.data;
      if (apiError.error.code === 'EXTRACTION_NOT_IMPLEMENTED') {
        throw new Error(
          'Automatic listing reading is not available yet. You can enter the property details manually.',
        );
      }
      if (apiError.error.code === 'ANALYSIS_NOT_IMPLEMENTED') {
        throw new Error(
          'Analysis is not available yet. Your details are still here, and you can try again later.',
        );
      }
      throw new Error(apiError.error.message);
    }
    throw new Error(
      `Sniffo couldn’t complete that request (${response.status}). Please try again.`,
    );
  }

  return payload;
}

export async function extractListingUrl(url: string, signal?: AbortSignal) {
  const request = UrlExtractionRequestSchema.parse({ url });
  const payload = await postJson('/api/extract/url', request, signal);
  const parsed = ExtractionResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      'Sniffo returned listing details in an unexpected format. Please retry.',
    );
  }
  return parsed.data.data;
}

export async function requestReportAudio(
  reportToken: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const request = TtsReportRequestSchema.parse({ reportToken });
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/tts/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError')
      throw error;
    throw new Error(
      'Could not reach Sniffo audio. Your written summary is still available.',
    );
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const parsed = ApiErrorSchema.safeParse(payload);
    throw new Error(
      parsed.success
        ? parsed.data.error.message
        : `Audio request failed (${response.status}). Your written summary is still available.`,
    );
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('audio/mpeg'))
    throw new Error('Sniffo returned an unsupported audio format.');
  return response.blob();
}

export async function extractText(
  text: string,
  type: 'listing_text' | 'conversation_text' | 'payment_information',
  name: string,
  signal?: AbortSignal,
  evidenceKind?: 'user_source' | 'user_assertion',
) {
  const request = TextExtractionRequestSchema.parse({
    text,
    type,
    name,
    evidenceKind,
  });
  const payload = await postJson('/api/extract/text', request, signal);
  const parsed = ExtractionResponseSchema.safeParse(payload);
  if (!parsed.success)
    throw new Error(
      'Sniffo could not verify the submitted text source. Please try again.',
    );
  return parsed.data.data;
}

export async function analyzeVerification(
  request: unknown,
  signal?: AbortSignal,
  onProgress?: (stage: ResearchStage) => void,
) {
  const validatedRequest = AnalysisRequestSchema.parse(request);
  if (validatedRequest.deepResearch) {
    const response = await fetch(`${apiBase}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify(validatedRequest),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
        : AbortSignal.timeout(35000),
    });
    if (!response.ok || !response.body) {
      const error = ApiErrorSchema.safeParse(
        await response.json().catch(() => null),
      );
      throw new Error(
        error.success
          ? error.data.error.message
          : 'Analysis could not start. Please retry.',
      );
    }
    if (!response.headers.get('content-type')?.includes('application/x-ndjson'))
      return AnalysisResponseSchema.parse(await response.json()).data;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let standard:
      ReturnType<typeof AnalysisResponseSchema.parse>['data'] | undefined;
    let final: typeof standard;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as {
        type: string;
        stage?: unknown;
        response?: unknown;
      };
      if (event.type === 'progress') {
        const stage = ResearchStageSchema.safeParse(event.stage);
        if (stage.success) onProgress?.(stage.data);
      } else if (event.type === 'standard')
        standard = AnalysisResponseSchema.parse(event.response).data;
      else if (event.type === 'result')
        final = AnalysisResponseSchema.parse(event.response).data;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        pending += decoder.decode(value, { stream: true });
        if (pending.length > 2_000_000)
          throw new Error('Oversize analysis response');
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        lines.forEach(consume);
      }
      consume(pending + decoder.decode());
      if (final) return final;
    } catch (error) {
      if (!standard || signal?.aborted) throw error;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (standard)
      return {
        ...standard,
        research: {
          enabled: true as const,
          countsKnown: false,
          status: 'unavailable' as const,
          queriesAttempted: 0,
          candidatesDiscovered: 0,
          candidatesReviewed: 0,
          independentSources: 0,
          summary:
            'Research could not finish. Your standard verification report is available.',
          sourceSummaries: [],
          comparisons: [],
          visualAnalysis: {
            status: 'unavailable' as const,
            reason: 'Research connection was interrupted.',
            cached: false,
            sourceImageReferences: [],
            candidateImageReferences: [],
          },
          evidenceSources: [],
          limitations: [
            'Research connection was interrupted; no research findings were used.',
          ],
          elapsedMs: 0,
          stages: [],
        },
      };
    throw new Error(
      'The analysis connection was interrupted. Your form is saved; please retry.',
    );
  }
  const payload = await postJson('/api/analyze', validatedRequest, signal);
  const parsed = AnalysisResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      'Sniffo returned an unexpected analysis response. Please retry.',
    );
  }
  return parsed.data.data;
}
