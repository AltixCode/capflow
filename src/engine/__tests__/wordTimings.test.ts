import { isSpeech, toWords } from '../wordTimings';

describe('isSpeech', () => {
  it('accepts ordinary words, including ones carrying punctuation', () => {
    expect(isSpeech(' ship')).toBe(true);
    expect(isSpeech('it.')).toBe(true);
    expect(isSpeech('9:41')).toBe(true);
  });

  it('rejects the markers whisper emits in place of speech', () => {
    for (const marker of ['[BLANK_AUDIO]', '[ Silence ]', '(music)', '[APPLAUSE]', '[inaudible]']) {
      expect(isSpeech(marker)).toBe(false);
    }
  });

  it('rejects punctuation on its own', () => {
    expect(isSpeech('.')).toBe(false);
    expect(isSpeech(' — ')).toBe(false);
  });

  it('rejects empty tokens', () => {
    expect(isSpeech('   ')).toBe(false);
  });
});

describe('toWords', () => {
  it('converts centiseconds to seconds and trims the leading space', () => {
    expect(toWords([{ t0: 120, t1: 185, text: ' ship' }])).toEqual([
      { text: 'ship', start: 1.2, end: 1.85 },
    ]);
  });

  it('drops silence markers instead of captioning them', () => {
    const words = toWords([
      { t0: 0, t1: 50, text: ' ship' },
      { t0: 50, t1: 400, text: ' [BLANK_AUDIO]' },
      { t0: 400, t1: 450, text: ' it' },
    ]);
    expect(words.map((w) => w.text)).toEqual(['ship', 'it']);
  });

  it('attaches a lone full stop to the word before it', () => {
    const words = toWords([
      { t0: 0, t1: 50, text: ' ship' },
      { t0: 50, t1: 60, text: '.' },
    ]);
    expect(words).toEqual([{ text: 'ship.', start: 0, end: 0.6 }]);
  });

  it('never shortens a word when attaching its punctuation', () => {
    const words = toWords([
      { t0: 0, t1: 50, text: ' ship' },
      // whisper does report punctuation ending before the word it follows.
      { t0: 10, t1: 20, text: '!' },
    ]);
    expect(words[0].end).toBe(0.5);
  });

  it('drops punctuation that arrives before any word', () => {
    expect(toWords([{ t0: 0, t1: 10, text: '...' }])).toEqual([]);
  });

  it('ignores empty segments', () => {
    expect(toWords([{ t0: 0, t1: 10, text: '  ' }])).toEqual([]);
  });

  it('does not attach a silence marker to the previous word', () => {
    const words = toWords([
      { t0: 0, t1: 50, text: ' ship' },
      { t0: 50, t1: 900, text: '[BLANK_AUDIO]' },
    ]);
    expect(words).toEqual([{ text: 'ship', start: 0, end: 0.5 }]);
  });
});
