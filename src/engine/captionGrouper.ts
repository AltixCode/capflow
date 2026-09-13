/**
 * Turns whisper's word-level timings into the caption cues that appear on
 * screen.
 *
 * Short-form captions are read in glances, so grouping is the product: too many
 * words per cue and nobody reads them, too few and the screen strobes. The
 * rules below are what separate captions that feel produced from captions that
 * feel automatic.
 *
 * Whisper's output is not clean. Timings can be zero-length on short words,
 * occasionally overlap, and the model emits leading spaces on tokens. Every one
 * of those produces a cue that renders and looks wrong, so they are handled
 * here rather than assumed away.
 */

export interface Word {
  text: string;
  /** Seconds from the start of the video. */
  start: number;
  end: number;
}

export interface Cue {
  words: Word[];
  start: number;
  end: number;
  get text(): string;
}

export interface GroupOptions {
  /** Most words shown at once. Short-form captions live at two or three. */
  maxWords?: number;
  /** Characters, so long words do not overflow a narrow phone screen. */
  maxChars?: number;
  /** A pause longer than this ends the cue: the speaker took a breath. */
  maxGapSeconds?: number;
  /** A cue shorter than this is unreadable however few words it holds. */
  minCueSeconds?: number;
}

const DEFAULTS: Required<GroupOptions> = {
  maxWords: 3,
  maxChars: 24,
  maxGapSeconds: 0.45,
  minCueSeconds: 0.5,
};

const makeCue = (words: Word[]): Cue => ({
  words,
  start: words[0].start,
  end: words[words.length - 1].end,
  get text() {
    return words.map((w) => w.text).join(' ');
  },
});

/**
 * Cleans raw recogniser words into something groupable.
 *
 * Whisper prefixes tokens with a space and can emit zero-length or inverted
 * spans; a cue built from those either never displays or displays forever.
 */
export const normaliseWords = (words: Word[]): Word[] => {
  const cleaned: Word[] = [];
  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    const start = Math.max(0, word.start);
    const previous = cleaned[cleaned.length - 1];
    cleaned.push({
      text,
      // Overlapping spans make cues flicker; clamping keeps the sequence
      // monotonic without reordering what the model heard.
      start: previous && start < previous.end ? previous.end : start,
      end: word.end,
    });
    // One guard, not two. This covers both a word whose end is at or before
    // its start -- whisper does that on short words -- and one whose start was
    // just pushed past its end by the overlap clamp above. A cue with no
    // duration never appears on screen.
    const last = cleaned[cleaned.length - 1];
    if (last.end <= last.start) last.end = last.start + 1 / 30;
  }
  return cleaned;
};

/** Groups words into cues under the word, character, gap and duration rules. */
export const groupIntoCues = (words: Word[], options: GroupOptions = {}): Cue[] => {
  const { maxWords, maxChars, maxGapSeconds, minCueSeconds } = { ...DEFAULTS, ...options };
  const clean = normaliseWords(words);
  if (!clean.length) return [];

  const cues: Cue[] = [];
  let current: Word[] = [];

  const lengthWith = (word: Word) =>
    current.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;

  for (const word of clean) {
    const previous = current[current.length - 1];
    const gap = previous ? word.start - previous.end : 0;
    const wouldOverflow = current.length >= maxWords || lengthWith(word) > maxChars;

    if (current.length && (wouldOverflow || gap > maxGapSeconds)) {
      cues.push(makeCue(current));
      current = [];
    }
    current.push(word);
  }
  if (current.length) cues.push(makeCue(current));

  // Extend cues that are too brief to read, but never past the next one: an
  // overlap would show two captions at once.
  return cues.map((cue, i) => {
    if (cue.end - cue.start >= minCueSeconds) return cue;
    const nextStart = cues[i + 1]?.start ?? Number.POSITIVE_INFINITY;
    const wanted = cue.start + minCueSeconds;
    const extended = makeCue(cue.words);
    extended.end = Math.min(wanted, nextStart);
    return extended;
  });
};

/** Index of the cue visible at a given time, or -1 between cues. */
export const cueAt = (cues: Cue[], seconds: number): number =>
  cues.findIndex((c) => seconds >= c.start && seconds < c.end);
