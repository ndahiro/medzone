/**
 * Local-language catalogue for the Uganda-first voice bridge.
 *
 * This is the client's copy of the server's catalogue (server/s2s.js). The two
 * are pinned together by tests/local-language.test.ts, because a language that
 * the server accepts but the client never offers is a language a patient
 * simply cannot speak into a consultation.
 *
 * `code` is the ISO-639-3-ish tag the Crane STT/MT/TTS endpoints expect;
 * `native` is what the patient reads in the picker. `craneStt: false` means
 * there is no self-hosted ASR leg for that language yet — the turn still
 * works through MT plus the browser caption fallback.
 */
export interface LocalLanguage {
  code: string;
  label: string;
  native: string;
  craneStt: boolean;
  sttNote: string;
}

export const LOCAL_LANGUAGES: LocalLanguage[] = [
  { code: 'lg', label: 'Luganda', native: 'Oluganda', craneStt: true, sttNote: 'Crane NeMo ASR 1.2 (WER 17.9%)' },
  { code: 'en', label: 'English', native: 'English', craneStt: true, sttNote: 'Crane ASR 1.2 retention' },
  { code: 'sw', label: 'Swahili', native: 'Kiswahili', craneStt: true, sttNote: 'Crane NeMo ASR 1.2 (WER 22.3%)' },
  { code: 'sn', label: 'Shona', native: 'chiShona', craneStt: true, sttNote: 'Crane NeMo ASR 1.2' },
  { code: 'ach', label: 'Acholi', native: 'Leb Acoli', craneStt: false, sttNote: 'MT + browser fallback' },
  { code: 'nyn', label: 'Runyankole', native: 'Runyankole', craneStt: false, sttNote: 'MT + browser fallback' },
  { code: 'teo', label: 'Ateso', native: 'Ateso', craneStt: false, sttNote: 'MT + browser fallback' },
  { code: 'lgs', label: 'Lusoga', native: 'Olusoga', craneStt: false, sttNote: 'MT + browser fallback' },
  { code: 'lgg', label: 'Lugbara', native: 'Lugbara', craneStt: false, sttNote: 'MT + browser fallback' },
  { code: 'nuj', label: 'Lunyoro', native: 'Runyoro', craneStt: false, sttNote: 'MT + browser fallback' },
];

export const LOCAL_LANGUAGE_CODES: string[] = LOCAL_LANGUAGES.map(l => l.code);

/**
 * BCP-47 tag handed to the browser speech APIs (recognition + synthesis).
 *
 * A language with no tag of its own borrows the nearest one the browser
 * actually ships a voice for, so the caption still comes out in a recognisable
 * accent instead of an English one mislabelled as Runyoro.
 */
export const BROWSER_VOICE_TAGS: Record<string, string> = {
  lg: 'lg-UG',
  en: 'en-UG',
  sw: 'sw-KE',
  sn: 'sn-ZA',
  ach: 'en-UG',
  nyn: 'en-UG',
  teo: 'en-UG',
  lgs: 'lg-UG',
  lgg: 'en-UG',
  nuj: 'en-UG',
  fr: 'fr-FR',
  es: 'es-ES',
  ar: 'ar-SA',
};

/** BCP-47 tag for a language code, defaulting to the East African English voice. */
export const browserVoiceTag = (lang: string): string =>
  BROWSER_VOICE_TAGS[String(lang || '').trim()] || 'en-UG';
