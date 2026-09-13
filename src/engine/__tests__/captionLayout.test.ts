import {
  ADVANCE_RATIO,
  buildBurnPlan,
  layoutCue,
  wrapToWidth,
} from '../captionLayout';
import type { Cue } from '../captionGrouper';
import { CAPTION_STYLES, styleById, type CaptionStyle } from '../../presets/captionStyles';

/** A cue with the text it reports, which is all the layout looks at. */
const cue = (text: string, start = 0, end = 1): Cue => ({
  words: [],
  start,
  end,
  get text() {
    return text;
  },
});

const PORTRAIT = { width: 1080, height: 1920 };
const bold = styleById('bold');
const plate = styleById('plate');

const measured = (text: string, fontSize: number) => text.length * fontSize * ADVANCE_RATIO;

describe('wrapToWidth', () => {
  it('keeps text that fits on one line', () => {
    expect(wrapToWidth('two words', 100, 10_000)).toEqual(['two words']);
  });

  it('breaks on spaces once the line is full', () => {
    // At 100px each word measures 5 * 100 * 0.58 = 290; two do not fit in 400.
    expect(wrapToWidth('alpha bravo', 100, 400)).toEqual(['alpha', 'bravo']);
  });

  it('leaves a single word wider than the line intact rather than hyphenating', () => {
    expect(wrapToWidth('unsplittable', 100, 50)).toEqual(['unsplittable']);
  });

  it('returns nothing for empty text', () => {
    expect(wrapToWidth('   ', 100, 400)).toEqual([]);
  });
});

describe('layoutCue', () => {
  it('uppercases text for styles that ask for it, and leaves others alone', () => {
    expect(layoutCue(cue('hello there'), bold, PORTRAIT).text).toBe('HELLO THERE');
    expect(layoutCue(cue('hello there'), plate, PORTRAIT).text).toBe('hello there');
  });

  it('keeps a normal cue on one line at the nominal size', () => {
    const box = layoutCue(cue('ship it'), bold, PORTRAIT);
    expect(box.lines).toHaveLength(1);
    expect(box.fontSize).toBeCloseTo(1080 * 0.078, 5);
  });

  it('shrinks the text rather than wrapping when it nearly fits', () => {
    // Long enough to overflow at the nominal size, short enough to fit above
    // the floor. Wrapping here would jog the block upward mid-sentence.
    const box = layoutCue(cue('absolutely everything'), bold, PORTRAIT);
    expect(box.lines).toHaveLength(1);
    expect(box.fontSize).toBeLessThan(1080 * 0.078);
    expect(box.fontSize).toBeGreaterThanOrEqual(1080 * 0.052);
  });

  it('wraps instead of shrinking past the floor', () => {
    const box = layoutCue(cue('a sentence far too long to fit on one line'), bold, PORTRAIT);
    expect(box.fontSize).toBeCloseTo(1080 * 0.052, 5);
    expect(box.lines.length).toBeGreaterThan(1);
  });

  it('never renders wider than the side margins allow', () => {
    const maxWidth = 1080 * (1 - 0.08 * 2);
    for (const text of ['hi', 'absolutely everything', 'a sentence far too long to fit on one line']) {
      const box = layoutCue(cue(text), bold, PORTRAIT);
      for (const line of box.lines) {
        expect(measured(line, box.fontSize)).toBeLessThanOrEqual(maxWidth + 1);
      }
      expect(box.width).toBeLessThanOrEqual(maxWidth);
    }
  });

  it('grows the block upward from a fixed bottom edge', () => {
    const one = layoutCue(cue('ship it'), bold, PORTRAIT);
    const two = layoutCue(cue('a sentence far too long to fit on one line'), bold, PORTRAIT);
    expect(one.top + one.height).toBeCloseTo(two.top + two.height, 5);
    expect(two.top).toBeLessThan(one.top);
  });

  it('keeps the whole block clear of the bottom fifth, where the platform draws its controls', () => {
    const box = layoutCue(cue('a sentence far too long to fit on one line'), bold, PORTRAIT);
    expect(box.top + box.height).toBeLessThanOrEqual(1920 * 0.8);
    expect(box.top).toBeGreaterThan(0);
  });

  it('publishes the bound the native burner shrinks against', () => {
    const box = layoutCue(cue('ship it'), bold, PORTRAIT);
    // Native measures the real font, which this layout could only estimate, so
    // it needs the same limit rather than a second guess at it.
    expect(box.maxWidth).toBeCloseTo(1080 * (1 - 0.08 * 2), 5);
    expect(box.width).toBeLessThanOrEqual(box.maxWidth);
  });

  it('centres the block horizontally', () => {
    expect(layoutCue(cue('ship it'), bold, PORTRAIT).centerX).toBe(540);
  });

  it('converts seconds to whole milliseconds', () => {
    const box = layoutCue(cue('ship it', 1.2345, 2.5), bold, PORTRAIT);
    expect(box.startMs).toBe(1235);
    expect(box.endMs).toBe(2500);
  });

  it('sizes from the short edge, so landscape captions are not oversized', () => {
    const landscape = layoutCue(cue('ship it'), bold, { width: 1920, height: 1080 });
    const portrait = layoutCue(cue('ship it'), bold, PORTRAIT);
    expect(landscape.fontSize).toBeCloseTo(portrait.fontSize, 5);
  });
});

describe('buildBurnPlan', () => {
  it('carries the video and style through for the native burner', () => {
    const plan = buildBurnPlan([cue('one'), cue('two')], plate, PORTRAIT);
    expect(plan.video).toEqual(PORTRAIT);
    expect(plan.style).toBe(plate);
    expect(plan.boxes).toHaveLength(2);
  });

  it('plans nothing for a video with no cues', () => {
    expect(buildBurnPlan([], bold, PORTRAIT).boxes).toEqual([]);
  });

  it('lays every preset style out legibly', () => {
    for (const style of CAPTION_STYLES) {
      const box = layoutCue(cue('every style has to fit'), style as CaptionStyle, PORTRAIT);
      expect(box.lines.join(' ').length).toBeGreaterThan(0);
      expect(box.fontSize).toBeGreaterThanOrEqual(1080 * 0.052);
    }
  });
});
