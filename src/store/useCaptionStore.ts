import { create } from 'zustand';
import { groupIntoCues, type Cue, type Word } from '../engine/captionGrouper';
import { buildBurnPlan, type BurnPlan, type VideoSize } from '../engine/captionLayout';
import { CAPTION_STYLES, DEFAULT_STYLE, styleById, type CaptionStyle } from '../presets/captionStyles';

/** Seconds of video a free user can caption in one export. */
export const FREE_SECONDS = 30;

export type Stage = 'idle' | 'transcribing' | 'ready' | 'burning';

export interface Source {
  uri: string;
  size: VideoSize;
  /** Seconds. */
  duration: number;
}

interface CaptionState {
  source: Source | null;
  words: Word[];
  cues: Cue[];
  styleId: string;
  stage: Stage;
  /** 0..1 for whichever stage is running. */
  progress: number;
  isPro: boolean;

  setSource: (source: Source | null) => void;
  setWords: (words: Word[]) => void;
  setStyle: (id: string) => void;
  setStage: (stage: Stage, progress?: number) => void;
  setProgress: (progress: number) => void;
  setIsPro: (pro: boolean) => void;
  reset: () => void;

  style: () => CaptionStyle;
  /** Styles the current entitlement can actually export with. */
  availableStyles: () => CaptionStyle[];
  /** Whether the loaded video is longer than the free tier allows. */
  overFreeLimit: () => boolean;
  plan: () => BurnPlan | null;
}

export const useCaptionStore = create<CaptionState>((set, get) => ({
  source: null,
  words: [],
  cues: [],
  styleId: DEFAULT_STYLE.id,
  stage: 'idle',
  progress: 0,
  isPro: false,

  setSource: (source) => set({ source, words: [], cues: [], stage: 'idle', progress: 0 }),
  setWords: (words) => set({ words, cues: groupIntoCues(words) }),
  setStyle: (id) => set({ styleId: styleById(id).id }),
  setStage: (stage, progress = 0) => set({ stage, progress }),
  setProgress: (progress) => set({ progress }),
  setIsPro: (pro) => {
    const { styleId } = get();
    // Dropping to free while a pro style is selected would export a style the
    // user is not entitled to, so the selection falls back with the
    // entitlement rather than silently persisting.
    const allowed = pro || !styleById(styleId).pro;
    set({ isPro: pro, styleId: allowed ? styleId : DEFAULT_STYLE.id });
  },
  reset: () => set({ source: null, words: [], cues: [], stage: 'idle', progress: 0 }),

  style: () => styleById(get().styleId),
  availableStyles: () => (get().isPro ? CAPTION_STYLES : CAPTION_STYLES.filter((s) => !s.pro)),
  overFreeLimit: () => {
    const { source, isPro } = get();
    return !isPro && !!source && source.duration > FREE_SECONDS;
  },

  plan: () => {
    const { source, cues } = get();
    if (!source || !cues.length) return null;
    return buildBurnPlan(cues, get().style(), source.size);
  },
}));
