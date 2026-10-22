/**
 * Local-language translation contract (Uganda-first voice bridge).
 *
 * Three things are pinned here, because each one silently breaks a patient
 * who speaks a language other than English:
 *
 *  1. Catalogue parity. The server's catalogue (server/s2s.js) and the client's
 *     fallback copy (src/lib/localLanguages.ts) are two copies of one list. A
 *     language the server accepts but the client never offers is a language a
 *     patient cannot speak into a consultation.
 *  2. The translation legs. STT -> MT -> TTS are exercised against a stubbed
 *     fetch, so the wiring is verified without a live Crane endpoint.
 *  3. UI string parity. Every locale must carry the same key set, so a
 *     half-translated shell cannot ship.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S2S_LANGUAGES,
  isS2SLanguage,
  validateS2SPayload,
  transcribeAudio,
  translateText,
  synthesizeSpeech,
  translateSpeechTurn,
  getS2SStatus,
} from '../server/s2s.js';
import {
  LOCAL_LANGUAGES,
  LOCAL_LANGUAGE_CODES,
  browserVoiceTag,
} from '../src/lib/localLanguages.ts';
import { TRANSLATIONS, LANGUAGES } from '../src/context/LanguageContext.tsx';

test('the client catalogue lists exactly the languages the server accepts', () => {
  assert.deepEqual(
    LOCAL_LANGUAGE_CODES,
    S2S_LANGUAGES.map(l => l.code),
    'client and server local-language catalogues must match, in order',
  );
});

test('every local language carries a label, a native name and a STT note', () => {
  for (const lang of LOCAL_LANGUAGES) {
    assert.ok(lang.label.length > 0, `${lang.code} needs a label`);
    assert.ok(lang.native.length > 0, `${lang.code} needs a native name`);
    assert.ok(lang.sttNote.length > 0, `${lang.code} needs an STT note`);
    assert.equal(typeof lang.craneStt, 'boolean');
  }
});

test('the Uganda-first languages the clinic depends on are all present', () => {
  for (const code of ['lg', 'en', 'sw', 'sn', 'ach', 'nyn', 'teo', 'lgs', 'lgg', 'nuj']) {
    assert.ok(isS2SLanguage(code), `server must accept ${code}`);
    assert.ok(LOCAL_LANGUAGE_CODES.includes(code), `client must offer ${code}`);
  }
});

test('language codes are unique', () => {
  assert.equal(new Set(LOCAL_LANGUAGE_CODES).size, LOCAL_LANGUAGE_CODES.length);
});

test('every local language resolves to a browser voice tag', () => {
  for (const code of LOCAL_LANGUAGE_CODES) {
    assert.match(browserVoiceTag(code), /^[a-z]{2}-[A-Z]{2}$/, `${code} needs a BCP-47 tag`);
  }
});

test('an unknown language falls back to the East African English voice', () => {
  assert.equal(browserVoiceTag('zz'), 'en-UG');
  assert.equal(browserVoiceTag(''), 'en-UG');
});



/**
 * Replaces global fetch with a stub for the duration of one call.
 *
 * The Crane legs are all plain HTTP POSTs to an env-configured URL, so a
 * stub is enough to verify the request shape (which language tag is sent) and
 * the response mapping — without a live GPU endpoint or any real audio.
 */
const withStubbedFetch = async <T>(
  handler: (url: string, body: Record<string, unknown>) => unknown,
  run: () => Promise<T>,
): Promise<T> => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : {};
    const payload = handler(url, body);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    };
  }) as unknown as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
};

/** ~1 KB of base64 audio — above the server's 500-byte floor. */
const AUDIO = 'A'.repeat(1024);

test('the MT leg sends the source and target language tags', async () => {
  process.env.CRANE_MT_URL = 'http://mt.internal/v1/translate';
  let seen: Record<string, unknown> = {};
  const out = await withStubbedFetch(
    (_url, body) => {
      seen = body;
      return { translation: 'I have a headache' };
    },
    () => translateText({ text: 'Namalawa', sourceLang: 'lg', targetLang: 'en' }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.text, 'I have a headache');
  assert.equal(out.engine, 'crane-mt');
  assert.equal(seen.source, 'lg');
  assert.equal(seen.target, 'en');
  assert.equal(seen.text, 'Namalawa');
});

test('the MT leg translates between two local languages', async () => {
  process.env.CRANE_MT_URL = 'http://mt.internal/v1/translate';
  let seen: Record<string, unknown> = {};
  await withStubbedFetch(
    (_url, body) => {
      seen = body;
      return { translation: 'Ndinotuma' };
    },
    () => translateText({ text: 'Tindeba', sourceLang: 'sw', targetLang: 'nyn' }),
  );
  assert.equal(seen.source, 'sw');
  assert.equal(seen.target, 'nyn');
});

test('an unset MT leg passes the transcript through instead of failing', async () => {

test('the STT leg sends the source language tag to the ASR endpoint', async () => {
  process.env.S2S_PROVIDER = 'crane';
  process.env.CRANE_ASR_URL = 'http://asr.internal/v1/transcribe';
  let seen: Record<string, unknown> = {};
  const out = await withStubbedFetch(
    (_url, body) => {
      seen = body;
      return { text: 'Namakula' };
    },
    () => transcribeAudio({ audioBase64: AUDIO, mimeType: 'audio/webm', sourceLang: 'lg' }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.text, 'Namakula');
  assert.equal(seen.language, 'lg');
  assert.equal(seen.audio, AUDIO);
});

test('the TTS leg requests the target language tag', async () => {
  process.env.CRANE_TTS_URL = 'http://tts.internal/v1/synthesize';
  let seen: Record<string, unknown> = {};
  const out = await withStubbedFetch(
    (_url, body) => {
      seen = body;
      return { audio: 'QUJD', mimeType: 'audio/mpeg' };
    },
    () => synthesizeSpeech({ text: 'I have a headache', targetLang: 'en' }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.audioBase64, 'QUJD');
  assert.equal(out.mimeType, 'audio/mpeg');
  assert.equal(seen.language, 'en');
});

test('a full turn runs STT -> MT -> TTS for a local language', async () => {
  process.env.S2S_PROVIDER = 'crane';
  process.env.CRANE_ASR_URL = 'http://asr.internal/v1/transcribe';
  process.env.CRANE_MT_URL = 'http://mt.internal/v1/translate';
  process.env.CRANE_TTS_URL = 'http://tts.internal/v1/synthesize';
  const out = await withStubbedFetch(
    (url, body) => {
      if (url.includes('transcribe')) return { text: 'Mpandewa' };
      if (url.includes('translate')) return { translation: 'I have a fever' };
      return { audio: 'QUJD', mimeType: 'audio/mpeg' };
    },
    () =>
      translateSpeechTurn({
        audioBase64: AUDIO,
        mimeType: 'audio/webm',
        sourceLang: 'lg',
        targetLang: 'en',
      }),
  );
  assert.equal(out.ok, true);
  assert.equal(out.transcript, 'Mpandewa');
  assert.equal(out.translation, 'I have a fever');
  assert.equal(out.translationEngine, 'crane-mt');
  assert.equal(out.audioBase64, 'QUJD');
});

  delete process.env.CRANE_MT_URL;
  const out = await translateText({ text: 'Bwoy', sourceLang: 'lg', targetLang: 'en' });
  assert.equal(out.ok, true);
  assert.equal(out.text, 'Bwoy');
  assert.equal(out.engine, 'passthrough');
  assert.ok(out.note, 'the passthrough must explain itself');
});

test('the payload guard refuses an unknown local language', () => {
  const problems = validateS2SPayload({
    audioBase64: AUDIO,
    sourceLang: 'xx',
    targetLang: 'en',
  });
  assert.ok(problems.some(p => p.includes('xx')), 'the unknown source language must be named');
});

test('the payload guard refuses two identical languages', () => {
  const problems = validateS2SPayload({
    audioBase64: AUDIO,
    sourceLang: 'lg',
    targetLang: 'lg',
  });
  assert.ok(problems.some(p => p.includes('differ')));
});

test('the status probe reports the local-language catalogue', () => {
  const status = getS2SStatus();
  assert.equal(status.languages.length, S2S_LANGUAGES.length);
  assert.deepEqual(
    status.languages.map(l => l.code),
    LOCAL_LANGUAGE_CODES,
    'the probe must advertise exactly the local languages the client offers',
  );
});

test('the UI dictionaries all carry the same key set', () => {
  const english = Object.keys(TRANSLATIONS.en).sort();
  assert.ok(english.length > 0);
  for (const { code } of LANGUAGES) {
    const keys = Object.keys(TRANSLATIONS[code]).sort();
    assert.deepEqual(
      keys,
      english,
      `the ${code} dictionary must cover exactly the English key set`,
    );
  }
});

test('no UI string is left blank in any locale', () => {
  for (const { code } of LANGUAGES) {
    for (const [key, value] of Object.entries(TRANSLATIONS[code])) {
      assert.ok(value.trim().length > 0, `${code}.${key} must not be blank`);
    }
  }
});

