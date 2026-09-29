import { isSpeech, toWords } from "../wordTimings";

describe("isSpeech", () => {
  it("accepts ordinary words, including ones carrying punctuation", () => {
    expect(isSpeech(" ship")).toBe(true);
    expect(isSpeech("it.")).toBe(true);
    expect(isSpeech("9:41")).toBe(true);
  });

  it("rejects the markers whisper emits in place of speech", () => {
    for (const marker of [
      "[BLANK_AUDIO]",
      "[ Silence ]",
      "(music)",
      "[APPLAUSE]",
      "[inaudible]",
    ]) {
      expect(isSpeech(marker)).toBe(false);
    }
  });

  it("rejects punctuation on its own", () => {
    expect(isSpeech(".")).toBe(false);
    expect(isSpeech(" — ")).toBe(false);
  });

  it("rejects empty tokens", () => {
    expect(isSpeech("   ")).toBe(false);
  });
});

describe("toWords", () => {
  it("converts centiseconds to seconds and trims the leading space", () => {
    expect(toWords([{ t0: 120, t1: 185, text: " ship" }])).toEqual([
      { text: "ship", start: 1.2, end: 1.85 },
    ]);
  });

  it("drops silence markers instead of captioning them", () => {
    const words = toWords([
      { t0: 0, t1: 50, text: " ship" },
      { t0: 50, t1: 400, text: " [BLANK_AUDIO]" },
      { t0: 400, t1: 450, text: " it" },
    ]);
    expect(words.map((w) => w.text)).toEqual(["ship", "it"]);
  });

  it("attaches a lone full stop to the word before it", () => {
    const words = toWords([
      { t0: 0, t1: 50, text: " ship" },
      { t0: 50, t1: 60, text: "." },
    ]);
    expect(words).toEqual([{ text: "ship.", start: 0, end: 0.6 }]);
  });

  it("never shortens a word when attaching its punctuation", () => {
    const words = toWords([
      { t0: 0, t1: 50, text: " ship" },
      // whisper does report punctuation ending before the word it follows.
      { t0: 10, t1: 20, text: "!" },
    ]);
    expect(words[0].end).toBe(0.5);
  });

  it("drops punctuation that arrives before any word", () => {
    expect(toWords([{ t0: 0, t1: 10, text: "..." }])).toEqual([]);
  });

  it("ignores empty segments", () => {
    expect(toWords([{ t0: 0, t1: 10, text: "  " }])).toEqual([]);
  });

  it("does not attach a silence marker to the previous word", () => {
    const words = toWords([
      { t0: 0, t1: 50, text: " ship" },
      { t0: 50, t1: 900, text: "[BLANK_AUDIO]" },
    ]);
    expect(words).toEqual([{ text: "ship", start: 0, end: 0.5 }]);
  });

  describe("contractions", () => {
    // whisper's BPE vocabulary keeps "'t", "'s", "'re" etc. as their own
    // token, emitted with no leading space -- the same "continuation, not a
    // new word" signal punctuation uses. Treating any non-leading-space token
    // as a new word (the old behaviour) split every contraction in two: a
    // beta tester saw "don't" caption as "don'" followed by a lone "t".
    it("glues a single merged contraction token onto the previous word", () => {
      const words = toWords([
        { t0: 0, t1: 40, text: " don" },
        { t0: 40, t1: 55, text: "'t" },
      ]);
      expect(words).toEqual([{ text: "don't", start: 0, end: 0.55 }]);
    });

    it("glues an apostrophe and its trailing letter as two separate tokens", () => {
      const words = toWords([
        { t0: 0, t1: 40, text: " don" },
        { t0: 40, t1: 42, text: "'" },
        { t0: 42, t1: 55, text: "t" },
      ]);
      expect(words).toEqual([{ text: "don't", start: 0, end: 0.55 }]);
    });

    it("keeps other common contractions intact", () => {
      const cases: Array<[string, string]> = [
        ["it's", "it's"],
        ["you're", "you're"],
        ["wasn't", "wasn't"],
      ];
      for (const [, expected] of cases) {
        const [head, tail] = expected.split("'");
        const words = toWords([
          { t0: 0, t1: 40, text: ` ${head}` },
          { t0: 40, t1: 55, text: `'${tail}` },
        ]);
        expect(words.map((w) => w.text)).toEqual([expected]);
      }
    });

    it("does not merge two genuinely separate words that both carry a leading space", () => {
      const words = toWords([
        { t0: 0, t1: 40, text: " hello" },
        { t0: 40, t1: 80, text: " world" },
      ]);
      expect(words.map((w) => w.text)).toEqual(["hello", "world"]);
    });

    it("starts a new word from a continuation token when there is nothing before it to attach to", () => {
      const words = toWords([{ t0: 0, t1: 10, text: "'t" }]);
      expect(words).toEqual([{ text: "'t", start: 0, end: 0.1 }]);
    });
  });
});
