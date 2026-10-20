import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, Volume2 } from 'lucide-react';
import type { AudioNarration } from '@sniffo/shared';
import { requestReportAudio } from '../../lib/api';

type PlayerState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'ready'
  | 'ended'
  | 'unavailable'
  | 'error';

function releaseAudio(
  audio: HTMLAudioElement | null,
  objectUrl: string | null,
) {
  if (audio) {
    audio.onplay = null;
    audio.onpause = null;
    audio.onended = null;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

export function ReportAudioPlayer({
  narration,
}: {
  narration?: AudioNarration;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);
  const [state, setState] = useState<PlayerState>(
    narration?.available && narration.token ? 'idle' : 'unavailable',
  );
  const [error, setError] = useState('');

  useEffect(() => {
    setState(narration?.available && narration.token ? 'idle' : 'unavailable');
    setError('');
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      inFlightRef.current = false;
      releaseAudio(audioRef.current, objectUrlRef.current);
      audioRef.current = null;
      objectUrlRef.current = null;
    };
  }, [narration?.token, narration?.available]);

  const playExisting = useCallback(async (rewind = false) => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      if (rewind) audio.currentTime = 0;
      await audio.play();
      setState('playing');
      setError('');
    } catch {
      setState('ready');
      setError('Playback was blocked. Select Play audio to try again.');
    }
  }, []);

  const handlePlay = useCallback(async () => {
    if (inFlightRef.current) return;
    if (audioRef.current) {
      await playExisting(state === 'ended');
      return;
    }
    if (!narration?.available || !narration.token) {
      setState('unavailable');
      return;
    }

    inFlightRef.current = true;
    const controller = new AbortController();
    requestRef.current = controller;
    setState('loading');
    setError('');
    try {
      const blob = await requestReportAudio(narration.token, controller.signal);
      if (controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      objectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onplay = () => setState('playing');
      audio.onpause = () => {
        if (!audio.ended) setState('paused');
      };
      audio.onended = () => setState('ended');
      await playExisting();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setState('error');
      setError(
        cause instanceof Error
          ? cause.message
          : 'Audio could not be prepared. Your written summary is still available.',
      );
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      inFlightRef.current = false;
    }
  }, [narration, playExisting, state]);

  const unavailable = state === 'unavailable';
  const loading = state === 'loading';

  return (
    <section className="report-audio" aria-labelledby="report-audio-title">
      <div className="report-audio-heading">
        <span className="report-audio-icon" aria-hidden="true">
          <Volume2 size={19} />
        </span>
        <div>
          <h3 id="report-audio-title">Listen to your report</h3>
          <p>Hear a quick summary of your verification findings.</p>
        </div>
      </div>
      {unavailable ? (
        <p className="report-audio-unavailable" role="status">
          {narration
            ? 'Audio is unavailable right now. You can read the summary below.'
            : 'This report predates audio summaries. Run this verification again to prepare a current summary.'}
        </p>
      ) : (
        <div
          className="report-audio-controls"
          aria-label="Report audio controls"
        >
          {state === 'playing' ? (
            <button
              type="button"
              className="report-audio-button"
              aria-label="Pause report audio"
              onClick={() => audioRef.current?.pause()}
            >
              <Pause size={17} aria-hidden="true" /> Pause
            </button>
          ) : (
            <button
              type="button"
              className="report-audio-button"
              aria-label={
                loading
                  ? 'Preparing your audio summary'
                  : audioRef.current
                    ? state === 'paused'
                      ? 'Resume report audio'
                      : 'Play report audio'
                    : state === 'error'
                      ? 'Retry report audio'
                      : 'Listen to report'
              }
              disabled={loading}
              onClick={() => void handlePlay()}
            >
              <Play size={17} aria-hidden="true" />
              {loading
                ? 'Preparing your audio summary…'
                : audioRef.current
                  ? state === 'paused'
                    ? 'Resume'
                    : 'Play audio'
                  : state === 'error'
                    ? 'Try again'
                    : 'Listen to report'}
            </button>
          )}
          {audioRef.current && state !== 'playing' && (
            <button
              type="button"
              className="report-audio-replay"
              aria-label="Replay report audio"
              onClick={() => void playExisting(true)}
            >
              <RotateCcw size={15} aria-hidden="true" /> Replay
            </button>
          )}
        </div>
      )}
      <p className="report-audio-status" role="status" aria-live="polite">
        {loading
          ? 'Preparing your audio summary…'
          : state === 'playing'
            ? 'Playing report summary.'
            : state === 'paused'
              ? 'Report audio paused.'
              : state === 'ended'
                ? 'Report audio finished.'
                : state === 'ready'
                  ? 'Audio is ready to play.'
                  : ''}
      </p>
      {error && (
        <p className="report-audio-error" role="alert">
          {error}
        </p>
      )}
      {narration && (
        <>
          <details className="report-audio-transcript">
            <summary>Read transcript</summary>
            <p>{narration.transcript}</p>
          </details>
          <a
            className="report-audio-attribution"
            href="https://elevenlabs.io"
            target="_blank"
            rel="noopener noreferrer"
          >
            Powered by ElevenLabs
          </a>
        </>
      )}
    </section>
  );
}
