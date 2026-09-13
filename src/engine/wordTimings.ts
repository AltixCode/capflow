/**
 * Converts whisper's segments into the word timings the grouper needs.
 *
 * whisper is asked for one token per segment (`maxLen: 1`), which turns its
 * sentence segments into word-sized ones. What comes back is still raw model
 * output: timestamps are in centiseconds, tokens carry a leading space,
 * punctuation and the model's own bracket markers arrive as their own
 * "words", and a run of silence produces the `[BLANK_AUDIO]` marker. Every one
 * of those, left in, becomes a caption that appears on screen.
 */

import type { Word } from './captionGrouper';

export interface WhisperSegment {
  /** Centiseconds from the start of the audio. */
  t0: number;
  t1: number;
  text: string;
}

/**
 * Markers whisper emits in place of speech. They are not words and must never
 * be captioned.
 */
const MARKER = /^[\[(]\s*(?:blank_audio|music|silence|sound|applause|laughter|inaudible)[^\])]*[\])]$/i;

/** Punctuation-only tokens belong to the previous word, not on their own. */
const PUNCTUATION_ONLY = /^[\p{P}\p{S}]+$/u;

export const isSpeech = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (MARKER.test(trimmed)) return false;
  return !PUNCTUATION_ONLY.test(trimmed);
};

/**
 * Flattens segments to words.
 *
 * A punctuation-only token is appended to the word before it, so "it" followed
 * by "." captions as "it." rather than flashing a lone full stop. Punctuation
 * arriving before any word is dropped, since there is nothing to attach it to.
 */
export const toWords = (segments: WhisperSegment[]): Word[] => {
  const words: Word[] = [];
  for (const segment of segments) {
    const text = segment.text.trim();
    if (!text) continue;
    // Centiseconds, which is what whisper.cpp reports.
    const start = segment.t0 / 100;
    const end = segment.t1 / 100;

    if (!isSpeech(text)) {
      const previous = words[words.length - 1];
      if (previous && PUNCTUATION_ONLY.test(text)) {
        previous.text += text;
        // Extend the word to cover its punctuation so the caption does not
        // disappear a frame before the sentence visibly ends.
        previous.end = Math.max(previous.end, end);
      }
      continue;
    }

    words.push({ text, start, end });
  }
  return words;
};
