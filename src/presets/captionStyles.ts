/**
 * Caption looks.
 *
 * Each is a complete set rather than a colour tint, because the things that
 * make burned-in captions readable over moving video -- an outline, a plate
 * behind the text, or both -- have to be chosen together. Text with neither
 * disappears the moment the speaker walks past a bright wall, which is exactly
 * the frame nobody checks before posting.
 */
export interface CaptionStyle {
  id: string;
  label: string;
  /** Text fill. */
  color: string;
  /** Outline drawn behind the fill. Empty string means no outline. */
  strokeColor: string;
  /** Outline width as a fraction of font size, so it scales with the video. */
  strokeRatio: number;
  /** Plate behind the text. Empty string means none. */
  plateColor: string;
  /** Corner radius of the plate, as a fraction of font size. */
  plateRadiusRatio: number;
  uppercase: boolean;
  /** Whether this style is behind the paywall. */
  pro: boolean;
}

export const CAPTION_STYLES: CaptionStyle[] = [
  {
    id: 'bold',
    label: 'Bold',
    color: '#FFFFFF',
    strokeColor: '#000000',
    strokeRatio: 0.09,
    plateColor: '',
    plateRadiusRatio: 0,
    uppercase: true,
    pro: false,
  },
  {
    id: 'plate',
    label: 'Plate',
    color: '#FFFFFF',
    strokeColor: '',
    strokeRatio: 0,
    // Not fully opaque: the plate has to read as an overlay on the video, not
    // as a letterbox bar.
    plateColor: '#000000D9',
    plateRadiusRatio: 0.28,
    uppercase: false,
    pro: false,
  },
  {
    id: 'sunrise',
    label: 'Sunrise',
    color: '#FDE047',
    strokeColor: '#1C1917',
    strokeRatio: 0.1,
    plateColor: '',
    plateRadiusRatio: 0,
    uppercase: true,
    pro: true,
  },
  {
    id: 'mint',
    label: 'Mint',
    color: '#F0FDFA',
    strokeColor: '#042F2E',
    strokeRatio: 0.09,
    plateColor: '#042F2EBF',
    plateRadiusRatio: 0.3,
    uppercase: false,
    pro: true,
  },
  {
    id: 'signal',
    label: 'Signal',
    color: '#FFFFFF',
    strokeColor: '',
    strokeRatio: 0,
    plateColor: '#DC2626E6',
    plateRadiusRatio: 0.18,
    uppercase: true,
    pro: true,
  },
];

export const DEFAULT_STYLE = CAPTION_STYLES[0];

export const styleById = (id: string): CaptionStyle =>
  CAPTION_STYLES.find((s) => s.id === id) ?? DEFAULT_STYLE;
