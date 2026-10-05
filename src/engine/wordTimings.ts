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

import type { Word } from "./captionGrouper";

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
const MARKER =
  /^[\[(]\s*(?:blank_audio|music|silence|sound|applause|laughter|inaudible)[^\])]*[\])]$/i;

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
 * Whisper signals a genuine new word with a leading space on the token; a
 * token with none is a continuation of the previous one -- punctuation like
 * "." or "!", but also the second half of a contraction: its BPE vocabulary
 * keeps "'t", "'s", "'re" and friends as their own token, so "don't" arrives
 * as " don" followed by "'t" (or even "'" then "t") with no leading space on
 * either continuation. Gluing every no-leading-space token onto the word
 * before it -- rather than only punctuation-only ones -- keeps contractions
 * whole instead of splitting them into two captioned words. Continuation
 * tokens with nothing before them to attach to (start of transcript) start a
 * new word instead, unless they are pure punctuation, which is dropped since
 * there is nothing sensible to caption on its own.
 */
export const toWords = (segments: WhisperSegment[]): Word[] => {
  const words: Word[] = [];
  for (const segment of segments) {
    const raw = segment.text;
    const text = raw.trim();
    if (!text) continue;
    // Centiseconds, which is what whisper.cpp reports.
    const start = segment.t0 / 100;
    const end = segment.t1 / 100;

    if (MARKER.test(text)) continue;

    const isContinuation = !/^\s/.test(raw);
    const previous = words[words.length - 1];

    if (isContinuation && previous) {
      previous.text += text;
      // Extend the word to cover its continuation so the caption does not
      // disappear a frame before the sentence visibly ends.
      previous.end = Math.max(previous.end, end);
      continue;
    }

    if (PUNCTUATION_ONLY.test(text)) continue;

    words.push({ text, start, end });
  }
  return words;
};
