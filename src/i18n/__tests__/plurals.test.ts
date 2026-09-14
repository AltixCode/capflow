import { readFileSync } from 'fs';
import { join } from 'path';
import { setLanguage, t } from '../index';

/**
 * These check the plural *categories*, which is the part the engine got wrong.
 *
 * The rules used to come from Intl.PluralRules. Node has full ICU, so a test
 * written against that passes here and still ships the wrong form to Russian
 * users -- Hermes has no CLDR plural database and answers as if every locale
 * were English.
 */
describe('plural categories', () => {
  afterEach(() => setLanguage('en'));

  it('uses all three Russian forms, including for 21 and 22', () => {
    setLanguage('ru');
    expect(t('captionCount', { count: 1 })).toBe("1 \u0441\u0443\u0431\u0442\u0438\u0442\u0440");
    expect(t('captionCount', { count: 3 })).toBe("3 \u0441\u0443\u0431\u0442\u0438\u0442\u0440\u0430");
    expect(t('captionCount', { count: 5 })).toBe("5 \u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432");
    // The teens are the trap: 11 and 12 take "many", not "one" and "few".
    expect(t('captionCount', { count: 11 })).toBe("11 \u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432");
    expect(t('captionCount', { count: 12 })).toBe("12 \u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043e\u0432");
    // The pattern restarts above 20, which is why a singular form must never
    // hard-code the numeral 1.
    expect(t('captionCount', { count: 21 })).toBe("21 \u0441\u0443\u0431\u0442\u0438\u0442\u0440");
    expect(t('captionCount', { count: 22 })).toBe("22 \u0441\u0443\u0431\u0442\u0438\u0442\u0440\u0430");
  });

  it('puts zero in the singular for French', () => {
    setLanguage('fr');
    expect(t('captionCount', { count: 0 })).toBe("0 sous-titre");
    expect(t('captionCount', { count: 2 })).toBe("2 sous-titres");
  });

  it('does not ask the engine for plural categories', () => {
    // This is a source check on purpose, and it is the only test here that can
    // actually fail if the rules go back to Intl.PluralRules. Node ships full
    // ICU, so every behavioural assertion above passes with either
    // implementation; Hermes is the one that gets Russian wrong. A test that
    // cannot tell the two apart is not a guard, so this one reads the file.
    const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).not.toContain('new Intl.PluralRules');
  });
});
