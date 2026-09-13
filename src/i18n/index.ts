import * as Localization from 'expo-localization';

export type SupportedLanguage =
  | 'en'
  | 'es'
  | 'fr'
  | 'de'
  | 'ru'
  | 'zh'
  | 'ja'
  | 'pt'
  | 'ko'
  | 'it'
  | 'tr'
  | 'ar'
  | 'fa'
  | 'el';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  'en',
  'es',
  'fr',
  'de',
  'ru',
  'zh',
  'ja',
  'pt',
  'ko',
  'it',
  'tr',
  'ar',
  'fa',
  'el',
];

export const translations = {
  "en": {
    "appName": "CapFlow",
    "proBadge": "PRO",
    "back": "Back",
    "cancel": "Cancel",
    "error": "Error",
    "heroBadge": "ON-DEVICE CAPTIONS",
    "heroTitle": "Captions that keep up with you.",
    "heroSubtitle": "Pick a clip, and CapFlow writes, times and burns in the captions. Nothing is uploaded.",
    "chooseVideo": "Choose a Video",
    "replaceVideo": "Choose a Different Video",
    "noVideoTitle": "No Video Selected",
    "noVideoDesc": "Pick a clip from your library to caption it.",
    "libraryDenied": "Photo Access Needed",
    "libraryDeniedDesc": "CapFlow needs access to your library to read the video you want to caption. You can grant it in Settings.",
    "videoUnreadable": "This Video Cannot Be Read",
    "videoUnreadableDesc": "The file could not be opened. Try a different clip.",
    "videoReady": "{width}x{height} - {duration}",
    "secondsShort": "{seconds}s",
    "modelTitle": "Speech Model",
    "modelDesc": "CapFlow transcribes on your phone. The model downloads once, then works offline forever.",
    "modelDownload": "Download Model",
    "modelDownloading": "Downloading - {percent}%",
    "modelReady": "Model ready",
    "modelFailed": "Download Failed",
    "transcribe": "Write the Captions",
    "transcribing": "Transcribing - {percent}%",
    "transcribeFailed": "Transcription Failed",
    "noSpeechTitle": "No Speech Found",
    "noSpeechDesc": "CapFlow heard no words in this clip. Check that the video has audio.",
    "captionsTitle": "Captions",
    "captionCount": "{count} captions",
    "captionCount_one": "{count} caption",
    "captionCount_other": "{count} captions",
    "styleTitle": "Style",
    "previewTitle": "Preview",
    "previewHint": "Scrub the video to check the captions before exporting.",
    "export": "Save to Photos",
    "exporting": "Burning captions - {percent}%",
    "exportFailed": "Export Failed",
    "exported": "Saved!",
    "exportedDesc": "The captioned video is in your photo library.",
    "saveDenied": "Photo Access Needed",
    "saveDeniedDesc": "CapFlow needs permission to add the captioned video to your library.",
    "freeLimitNotice": "Free exports cover the first {seconds} seconds. Unlock CapFlow Pro to caption the whole clip.",
    "proStyleLocked": "CapFlow Pro",
    "archGuarantees": "WHAT YOU GET",
    "wordTimedTitle": "Word-timed, not sentence-timed",
    "wordTimedDesc": "Captions change with the words, so they read like a produced video instead of subtitles.",
    "safeAreaTitle": "Clear of the controls",
    "safeAreaDesc": "Captions sit above the space Reels and TikTok cover with their own buttons.",
    "onDeviceTitle": "100% private on-device",
    "onDeviceDesc": "Your video never leaves the phone. No server, no account, no tracking.",
    "paywallTitle": "CapFlow Pro",
    "lifetimeAccess": "Unlock Lifetime Access - {price}",
    "lifetimeAccessPlain": "Unlock Lifetime Access",
    "restorePurchases": "Restore Purchases",
    "oneTimePayment": "One-time payment. Never recurring.",
    "termsOfUse": "Terms of Use",
    "privacyPolicy": "Privacy Policy",
    "antiSubTitle": "ANTI-SUBSCRIPTION PROMISE",
    "antiSubHeadline": "No Subscriptions. No Accounts. 100% On-Device Privacy. Own It Forever.",
    "antiSubDesc": "Caption apps charge $10–$30 every month and upload your footage to do it. CapFlow is one purchase you keep forever, and it never uploads anything.",
    "storeUnavailable": "Store Unavailable",
    "noPriorPurchases": "No previous purchase was found for this account.",
    "cancelled": "Purchase Cancelled",
    "unlocked": "CapFlow Pro Unlocked",
    "purchaseFailed": "Purchase Failed",
    "purchaseFailedDesc": "The purchase could not be completed. Please try again.",
    "restoreFailed": "Nothing to Restore",
    "restoreFailedDesc": "No previous purchase was found for this account.",
    "feat1Title": "Caption clips of any length",
    "feat1Desc": "The free tier covers the first 30 seconds; Pro captions the whole video.",
    "feat2Title": "Every caption style",
    "feat2Desc": "Unlock all styles, including the plated and high-contrast sets.",
    "feat3Title": "Full-quality export",
    "feat3Desc": "Captions burned in at the video's own resolution, ready to post.",
    "feat4Title": "100% private on-device",
    "feat4Desc": "Your video never leaves the phone. No server, no account, no tracking."
  }
} as const;

export type TranslationKey = keyof typeof translations['en'];

export function getDeviceLanguage(): SupportedLanguage {
  try {
    const locales = Localization.getLocales();
    const code = locales?.[0]?.languageCode?.toLowerCase();
    if (code && (SUPPORTED_LANGUAGES as string[]).includes(code)) {
      return code as SupportedLanguage;
    }
  } catch {
    // fallback
  }
  return 'en';
}

let currentLanguage: SupportedLanguage = getDeviceLanguage();

export function setLanguage(lang: SupportedLanguage) {
  currentLanguage = lang;
}

export function getLanguage(): SupportedLanguage {
  return currentLanguage;
}

export function isRTL(): boolean {
  return currentLanguage === 'ar' || currentLanguage === 'fa';
}

/**
 * CLDR plural category for `count` in the active language, e.g. "one" or
 * "other" in English, which also has "few"/"many" in Russian and Arabic.
 *
 * Falls back to an English-style one/other split where Intl.PluralRules is
 * unavailable, which is still better than always rendering the plural form.
 */
function pluralCategory(count: number): string {
  try {
    return new Intl.PluralRules(currentLanguage).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const langDict = (translations as any)[currentLanguage] || translations.en;
  // A key may carry plural variants as suffixed siblings ("exportClips_one").
  // Only keys that actually define one are affected; everything else resolves
  // to the base key exactly as before.
  let resolved: string = key as string;
  if (params && typeof params.count === 'number') {
    const variant = `${key}_${pluralCategory(params.count)}`;
    if (langDict[variant] || (translations.en as any)[variant]) resolved = variant;
  }
  let text: string =
    langDict[resolved] || (translations.en as any)[resolved] ||
    langDict[key] || translations.en[key] || (key as string);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      text = text.split('{' + k + '}').join(String(v));
    });
  }
  return text;
}

export default t;
