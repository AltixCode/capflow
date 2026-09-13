import { initWhisper, type WhisperContext } from 'whisper.rn/index';
import { getModelStatus, modelPath } from './modelManager';
import { toWords } from '../engine/wordTimings';
import { burner } from '../../modules/caption-burner';
import type { Word } from '../engine/captionGrouper';

export class ModelMissingError extends Error {
  constructor() {
    super('The speech model has not been downloaded yet.');
    this.name = 'ModelMissingError';
  }
}

let context: WhisperContext | null = null;
let loading: Promise<WhisperContext> | null = null;

/**
 * Loads the whisper context once and reuses it.
 *
 * Initialisation reads the whole model into memory, so doing it per video would
 * dominate the runtime and churn memory on older phones.
 */
const getContext = async (): Promise<WhisperContext> => {
  if (context) return context;
  if (loading) return loading;

  loading = (async () => {
    const status = await getModelStatus();
    if (!status.ready) throw new ModelMissingError();
    const created = await initWhisper({ filePath: modelPath() });
    context = created;
    return created;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
};

/**
 * Transcribes a video's audio on device and returns word-level timings.
 *
 * Two things here are not the defaults and both are load-bearing. `maxLen: 1`
 * makes whisper emit one token per segment, which is the only way to get word
 * timings rather than sentence ones -- and captions timed per sentence are just
 * subtitles. `tokenTimestamps` is what makes those per-token times meaningful
 * instead of interpolated.
 *
 * Audio extraction happens natively first: whisper only reads 16 kHz mono WAV,
 * and a camera roll video is neither.
 */
export const transcribeVideo = async (
  videoUri: string,
  onProgress?: (fraction: number) => void,
): Promise<Word[]> => {
  onProgress?.(0.02);
  const audio = await burner.extractAudio(videoUri);

  const whisper = await getContext();
  onProgress?.(0.08);

  const { promise } = whisper.transcribe(audio.uri, {
    // Auto-detect rather than assuming English: the app ships in fourteen
    // locales and this is the multilingual model.
    language: 'auto',
    maxLen: 1,
    tokenTimestamps: true,
    onProgress: (value: number) => {
      // whisper.cpp reports 0-100.
      onProgress?.(Math.min(0.99, Math.max(0.08, value / 100)));
    },
  });

  const result = await promise;
  onProgress?.(1);
  return toWords(result.segments ?? []);
};

export const releaseWhisper = async (): Promise<void> => {
  if (!context) return;
  await context.release();
  context = null;
};
