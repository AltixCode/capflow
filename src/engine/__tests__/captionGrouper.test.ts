/**
 * Grouping is the product here. Every failure below renders happily and looks
 * wrong on screen -- captions that strobe, overflow, overlap, or sit there while
 * the speaker has moved on.
 */
import { groupIntoCues, normaliseWords, cueAt, type Word } from '../captionGrouper';

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

describe('normaliseWords', () => {
  it('trims the leading spaces whisper puts on tokens', () => {
    // Left in, every caption renders with a stray space before it.
    expect(normaliseWords([w(' hello', 0, 0.3)])[0].text).toBe('hello');
  });

  it('gives zero-length words a displayable duration', () => {
    // Short words often come back with start === end; a cue built from those
    // never appears on screen.
    const [only] = normaliseWords([w('a', 1, 1)]);
    expect(only.end).toBeGreaterThan(only.start);
  });

  it('clamps overlapping spans so cues cannot flicker', () => {
    const [, second] = normaliseWords([w('one', 0, 0.5), w('two', 0.3, 0.8)]);
    expect(second.start).toBeGreaterThanOrEqual(0.5);
  });

  it('drops empty tokens instead of emitting blank captions', () => {
    expect(normaliseWords([w('  ', 0, 0.2), w('real', 0.2, 0.5)])).toHaveLength(1);
  });
});

describe('groupIntoCues', () => {
  it('caps the words shown at once', () => {
    const words = ['one', 'two', 'three', 'four', 'five'].map((t, i) => w(t, i * 0.3, i * 0.3 + 0.25));
    const cues = groupIntoCues(words, { maxWords: 2, minCueSeconds: 0 });
    for (const cue of cues) expect(cue.words.length).toBeLessThanOrEqual(2);
  });

  it('breaks early when the line would overflow the screen', () => {
    // Two long words fit the word limit but not a phone's width.
    const words = [w('extraordinarily', 0, 0.5), w('complicated', 0.5, 1)];
    const cues = groupIntoCues(words, { maxWords: 3, maxChars: 20, minCueSeconds: 0 });
    expect(cues).toHaveLength(2);
  });

  it('starts a new cue after a pause', () => {
    // The speaker took a breath; carrying the next sentence into the same cue
    // reads as though they said it all in one go.
    const words = [w('before', 0, 0.4), w('after', 2, 2.4)];
    const cues = groupIntoCues(words, { maxGapSeconds: 0.45, minCueSeconds: 0 });
    expect(cues).toHaveLength(2);
  });

  it('keeps words together when the pause is only speech rhythm', () => {
    const words = [w('one', 0, 0.4), w('two', 0.5, 0.9)];
    const cues = groupIntoCues(words, { maxGapSeconds: 0.45, maxWords: 3, minCueSeconds: 0 });
    expect(cues).toHaveLength(1);
  });

  it('extends a cue too brief to read', () => {
    const cues = groupIntoCues([w('hi', 0, 0.1)], { minCueSeconds: 0.5 });
    expect(cues[0].end - cues[0].start).toBeCloseTo(0.5, 3);
  });

  it('never extends a cue over the next one', () => {
    // Two captions on screen at once is the most obvious possible defect.
    const words = [w('a', 0, 0.1), w('b', 0.2, 0.6)];
    const cues = groupIntoCues(words, { maxWords: 1, minCueSeconds: 0.5 });
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start);
  });

  it('produces cues in order with no overlap', () => {
    const words = Array.from({ length: 12 }, (_, i) => w(`word${i}`, i * 0.4, i * 0.4 + 0.3));
    const cues = groupIntoCues(words);
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].start).toBeGreaterThanOrEqual(cues[i - 1].end - 1e-9);
    }
  });

  it('renders its text without stray spacing', () => {
    const cues = groupIntoCues([w(' stop', 0, 0.3), w(' scrolling', 0.3, 0.7)], { maxWords: 2, maxChars: 40 });
    expect(cues[0].text).toBe('stop scrolling');
  });

  it('returns nothing for empty input', () => {
    expect(groupIntoCues([])).toEqual([]);
  });
});

describe('cueAt', () => {
  const cues = groupIntoCues([w('a', 0, 0.5), w('b', 1, 1.5)], { maxWords: 1, minCueSeconds: 0 });

  it('finds the visible cue', () => expect(cueAt(cues, 0.2)).toBe(0));
  it('reports nothing between cues', () => expect(cueAt(cues, 0.8)).toBe(-1));
  it('treats a cue end as exclusive so two never show at once', () =>
    expect(cueAt(cues, 0.5)).toBe(-1));
});
