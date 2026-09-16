import React from 'react';
import { View } from 'react-native';
import Svg, { Text as SvgText, TSpan } from 'react-native-svg';
import type { CaptionBox } from '../engine/captionLayout';
import type { CaptionStyle } from '../presets/captionStyles';

interface Props {
  box: CaptionBox;
  style: CaptionStyle;
  /** Preview pixels per video pixel. */
  scale: number;
}

/**
 * Draws one caption over the preview.
 *
 * Everything here is the burn plan scaled down -- position, size, line breaks
 * and all. The preview deliberately owns no layout of its own, because the
 * moment it computes anything itself it can disagree with the exported file,
 * and the user only finds that out after posting.
 *
 * The outline is drawn as a stroked copy behind a filled one, which is what the
 * native side's negative NSStrokeWidth does. React Native's own text has no
 * stroke, and the usual workaround -- four offset shadow copies -- thickens
 * unevenly on diagonals.
 */
export const CaptionOverlay: React.FC<Props> = ({ box, style, scale }) => {
  const fontSize = box.fontSize * scale;
  const lineHeight = box.lineHeight * scale;
  const height = box.height * scale;
  const width = box.maxWidth * scale;
  const strokeWidth = style.strokeColor ? fontSize * style.strokeRatio : 0;

  // Draw into the WHOLE frame, not into the text box.
  //
  // The plan's widths come from ADVANCE_RATIO, an average glyph width, so a
  // line the layout believes fits can render a few percent wider. The layout
  // keeps a side margin for exactly that, and its comment says an error there
  // "costs margin, not legibility" -- but that is only true if the canvas is
  // wider than the box. Sizing the Svg to maxWidth made the viewport the same
  // width as the text, so any underestimate was clipped instead of eating the
  // margin, and because the text is centred it was clipped at BOTH edges: a
  // caption reading "DEMO RECORDING. THIS" lost the D and the final S.
  //
  // It is length-dependent, so short captions looked perfect and long ones were
  // truncated -- in a captions app, in the one frame a buyer looks at.
  //
  // centerX is half the video width, so this is the full frame; the container
  // already spans it and centres us within it.
  const frameWidth = box.centerX * 2 * scale;

  // SVG places text on its baseline; the plan measures from the top of the
  // line box, so each line drops by the line box plus the cap offset.
  const baseline = (index: number) => index * lineHeight + (lineHeight + fontSize * 0.72) / 2;

  const lines = (fill: string, stroke?: string) => (
    <SvgText
      x={frameWidth / 2}
      y={0}
      fontSize={fontSize}
      fontWeight="800"
      textAnchor="middle"
      fill={stroke ? 'none' : fill}
      stroke={stroke}
      strokeWidth={stroke ? strokeWidth : undefined}
      strokeLinejoin="round"
    >
      {box.lines.map((line, index) => (
        <TSpan key={index} x={frameWidth / 2} y={baseline(index)}>
          {line}
        </TSpan>
      ))}
    </SvgText>
  );

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: box.top * scale,
        left: 0,
        right: 0,
        height,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {style.plateColor ? (
        <View
          style={{
            position: 'absolute',
            width: Math.min(width, box.width * scale + fontSize * 0.84),
            height: height + fontSize * 0.44,
            backgroundColor: style.plateColor,
            borderRadius: fontSize * style.plateRadiusRatio,
          }}
        />
      ) : null}
      <Svg width={frameWidth} height={height}>
        {strokeWidth > 0 ? lines(style.color, style.strokeColor) : null}
        {lines(style.color)}
      </Svg>
    </View>
  );
};
