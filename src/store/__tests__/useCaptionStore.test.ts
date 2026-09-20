import { useCaptionStore, FREE_SECONDS } from '../useCaptionStore';
import { CAPTION_STYLES } from '../../presets/captionStyles';

const SOURCE = { uri: 'file:///clip.mov', size: { width: 1080, height: 1920 }, duration: 12 };
const WORDS = [
  { text: ' ship', start: 0, end: 0.4 },
  { text: ' it', start: 0.45, end: 0.8 },
];

beforeEach(() => {
  useCaptionStore.getState().reset();
  useCaptionStore.getState().setIsPro(false);
  useCaptionStore.getState().setStyle('bold');
});

describe('useCaptionStore', () => {
  it('groups words into cues as they arrive', () => {
    useCaptionStore.getState().setWords(WORDS);
    const { cues } = useCaptionStore.getState();
    expect(cues).toHaveLength(1);
    expect(cues[0].text).toBe('ship it');
  });

  it('clears the previous transcript when a new video is loaded', () => {
    useCaptionStore.getState().setWords(WORDS);
    useCaptionStore.getState().setSource(SOURCE);
    expect(useCaptionStore.getState().cues).toEqual([]);
    expect(useCaptionStore.getState().words).toEqual([]);
  });

  it('offers only free styles without an entitlement', () => {
    expect(useCaptionStore.getState().availableStyles().every((s) => !s.pro)).toBe(true);
    useCaptionStore.getState().setIsPro(true);
    expect(useCaptionStore.getState().availableStyles()).toHaveLength(CAPTION_STYLES.length);
  });

  it('drops a pro style when the entitlement goes away', () => {
    const proStyle = CAPTION_STYLES.find((s) => s.pro)!;
    useCaptionStore.getState().setIsPro(true);
    useCaptionStore.getState().setStyle(proStyle.id);
    useCaptionStore.getState().setIsPro(false);
    expect(useCaptionStore.getState().style().pro).toBe(false);
  });

  it('keeps a free style across an entitlement change', () => {
    const freeStyle = CAPTION_STYLES.filter((s) => !s.pro)[1];
    useCaptionStore.getState().setStyle(freeStyle.id);
    useCaptionStore.getState().setIsPro(false);
    expect(useCaptionStore.getState().style().id).toBe(freeStyle.id);
  });

  it('flags a video past the free duration, and stops flagging once unlocked', () => {
    useCaptionStore.getState().setSource({ ...SOURCE, duration: FREE_SECONDS + 1 });
    expect(useCaptionStore.getState().overFreeLimit()).toBe(true);
    useCaptionStore.getState().setIsPro(true);
    expect(useCaptionStore.getState().overFreeLimit()).toBe(false);
  });

  it('allows a video exactly at the free limit', () => {
    useCaptionStore.getState().setSource({ ...SOURCE, duration: FREE_SECONDS });
    expect(useCaptionStore.getState().overFreeLimit()).toBe(false);
  });

  it('plans nothing until there is both a video and a transcript', () => {
    expect(useCaptionStore.getState().plan()).toBeNull();
    useCaptionStore.getState().setSource(SOURCE);
    expect(useCaptionStore.getState().plan()).toBeNull();
    useCaptionStore.getState().setWords(WORDS);
    expect(useCaptionStore.getState().plan()!.boxes).toHaveLength(1);
  });

  it('plans against the selected style', () => {
    useCaptionStore.getState().setSource(SOURCE);
    useCaptionStore.getState().setWords(WORDS);
    useCaptionStore.getState().setStyle('plate');
    expect(useCaptionStore.getState().plan()!.style.id).toBe('plate');
  });

  it('updates cue text and recalculates the burn plan', () => {
    useCaptionStore.getState().setSource(SOURCE);
    useCaptionStore.getState().setWords(WORDS);
    expect(useCaptionStore.getState().cues[0].text).toBe('ship it');
    useCaptionStore.getState().updateCueText(0, 'ship it now');
    expect(useCaptionStore.getState().cues[0].text).toBe('ship it now');
    expect(useCaptionStore.getState().plan()!.boxes[0].text).toBe('SHIP IT NOW');
  });
});
