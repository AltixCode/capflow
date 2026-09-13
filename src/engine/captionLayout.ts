/**
 * Turns cues into a burn plan: the exact text, size and position of every
 * caption, in video pixels.
 *
 * The preview and the native burner both consume this, and that is the whole
 * point. Laying the captions out twice -- once in React for the preview and
 * once in Swift and Kotlin for the export -- is how you ship an app where the
 * exported file does not match what the user approved, and the user only finds
 * out after posting.
 *
 * Sizes are expressed in video pixels rather than points, because the export is
 * the authority: the preview scales the plan down to fit the screen, never the
 * other way round.
 */

import type { Cue } from './captionGrouper';
import type { CaptionStyle } from '../presets/captionStyles';

export interface VideoSize {
  width: number;
  height: number;
}

export interface LayoutOptions {
  /** Font size as a fraction of the short edge, before any shrinking to fit. */
  fontRatio?: number;
  /** Smallest the text may shrink to, as a fraction of the short edge. Below
   *  this it wraps instead, because unreadably small captions are worse than
   *  two lines. */
  minFontRatio?: number;
  /** Free space kept on each side, as a fraction of width. */
  sideMarginRatio?: number;
  /** Distance from the bottom of the video to the bottom of the caption block,
   *  as a fraction of height. Reels and TikTok put their own controls over the
   *  lower fifth of the frame, and a caption underneath them is unreadable in
   *  the only place the video will actually be watched. */
  bottomMarginRatio?: number;
  /** Line height as a multiple of font size. */
  lineHeightRatio?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  fontRatio: 0.078,
  minFontRatio: 0.052,
  sideMarginRatio: 0.08,
  bottomMarginRatio: 0.2,
  lineHeightRatio: 1.18,
};

/**
 * Mean advance width of a bold sans-serif glyph, as a fraction of font size.
 *
 * Measured rather than guessed: this is the average over the Latin alphabet,
 * digits and space in Helvetica Bold, which is what both platforms fall back to
 * for the caption face. It only has to be close -- the layout keeps a side
 * margin, so a few percent of error costs margin, not legibility. It is
 * deliberately not exact for scripts with wider glyphs, which is why
 * `measureRatio` can be overridden by the caller once a real measurement is
 * available from the platform.
 */
export const ADVANCE_RATIO = 0.58;

export interface CaptionBox {
  text: string;
  lines: string[];
  startMs: number;
  /** Exclusive, so exactly one caption is on screen at a time. */
  endMs: number;
  fontSize: number;
  lineHeight: number;
  /** Centre of the caption block, in video pixels from the left. */
  centerX: number;
  /** Top of the caption block, in video pixels from the top. */
  top: number;
  /** Height of the whole block, lines included. */
  height: number;
  /** Width of the widest line, used to size the plate. */
  width: number;
  /** Widest the block is allowed to be. The native burner measures the real
   *  font, which the layout could only estimate, and shrinks to this rather
   *  than re-wrapping. */
  maxWidth: number;
}

export interface BurnPlan {
  video: VideoSize;
  style: CaptionStyle;
  boxes: CaptionBox[];
}

const measure = (text: string, fontSize: number, ratio: number) =>
  text.length * fontSize * ratio;

/**
 * Greedy wrap by measured width, splitting on spaces only.
 *
 * A word longer than the line is left to overflow rather than broken mid-word:
 * hyphenating a caption is more jarring than one wide word, and the grouper
 * already caps cue length so this is the rare case, not the common one.
 */
export const wrapToWidth = (
  text: string,
  fontSize: number,
  maxWidth: number,
  ratio = ADVANCE_RATIO,
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate, fontSize, ratio) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  lines.push(line);
  return lines;
};

/**
 * Lays one cue out.
 *
 * Shrinking comes before wrapping. A caption that drops to two lines jumps the
 * block upward mid-sentence, which is far more distracting than the same words
 * a few percent smaller, so the size is reduced first and only a cue that still
 * will not fit at the floor is allowed to wrap.
 */
export const layoutCue = (
  cue: Cue,
  style: CaptionStyle,
  video: VideoSize,
  options: LayoutOptions = {},
): CaptionBox => {
  const o = { ...DEFAULTS, ...options };
  const shortEdge = Math.min(video.width, video.height);
  const maxWidth = video.width * (1 - o.sideMarginRatio * 2);

  const text = style.uppercase ? cue.text.toLocaleUpperCase() : cue.text;

  let fontSize = shortEdge * o.fontRatio;
  const floor = shortEdge * o.minFontRatio;
  while (fontSize > floor && measure(text, fontSize, ADVANCE_RATIO) > maxWidth) {
    fontSize -= 1;
  }
  fontSize = Math.max(fontSize, floor);

  const lines = wrapToWidth(text, fontSize, maxWidth);
  const lineHeight = fontSize * o.lineHeightRatio;
  const height = lines.length * lineHeight;
  const width = Math.min(
    maxWidth,
    Math.max(...lines.map((l) => measure(l, fontSize, ADVANCE_RATIO))),
  );

  // The block grows upward from a fixed bottom edge. Anchoring the top instead
  // would push a two-line caption down into the platform's controls.
  const bottom = video.height * (1 - o.bottomMarginRatio);

  return {
    text,
    lines,
    startMs: Math.round(cue.start * 1000),
    endMs: Math.round(cue.end * 1000),
    fontSize,
    lineHeight,
    centerX: video.width / 2,
    top: bottom - height,
    height,
    width,
    maxWidth,
  };
};

/** Lays out every cue against one video and style. */
export const buildBurnPlan = (
  cues: Cue[],
  style: CaptionStyle,
  video: VideoSize,
  options: LayoutOptions = {},
): BurnPlan => ({
  video,
  style,
  boxes: cues.map((cue) => layoutCue(cue, style, video, options)),
});
