/**
 * MedZone S2S voice bridge — Crane AI Labs first.
 * Opt-in per-visit speech translation. Audio is EPHEMERAL: forwarded
 * in-process to the configured STT/MT/TTS endpoints, never stored.
 * Env: S2S_PROVIDER=crane|off, CRANE_ASR_URL, CRANE_ASR_API_KEY,
 * CRANE_ASR_MODEL, CRANE_MT_URL, CRANE_MT_API_KEY, CRANE_TTS_URL,
 * CRANE_TTS_API_KEY, S2S_TIMEOUT_MS, S2S_MAX_AUDIO_BYTES.
 */
const DEFAULT_MODEL = 'CraneAILabs/crane-nemo-asr-1.2';
export const S2S_LANGUAGES = [
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
export const S2S_LANGUAGE_CODES = new Set(S2S_LANGUAGES.map(l => l.code));
export const isS2SLanguage = code => S2S_LANGUAGE_CODES.has(String(code || '').trim());
const providerName = () => String(process.env.S2S_PROVIDER || 'off').trim().toLowerCase();
const asrUrl = () => String(process.env.CRANE_ASR_URL || '').trim();
const mtUrl = () => String(process.env.CRANE_MT_URL || '').trim();
const ttsUrl = () => String(process.env.CRANE_TTS_URL || '').trim();
const timeoutMs = () => Math.max(1000, Number(process.env.S2S_TIMEOUT_MS || 15000));
const maxAudioBytes = () => Math.max(32000, Number(process.env.S2S_MAX_AUDIO_BYTES || 1500000));
export function getS2SStatus() {
  const provider = providerName();
  const configured = provider === 'crane' && Boolean(asrUrl());
  if (!configured) {
    return {
      available: false, provider, engine: 'offline',
      reason: provider === 'crane'
        ? 'Voice translation is on but CRANE_ASR_URL is not set — point it at your self-hosted Crane NeMo endpoint.'
        : 'Voice translation is off (S2S_PROVIDER=off). Browser speech captions remain where supported.',
      languages: S2S_LANGUAGES, model: process.env.CRANE_ASR_MODEL || DEFAULT_MODEL,
      stt: false, mt: Boolean(mtUrl()), tts: Boolean(ttsUrl()),
    };
  }
  return {
    available: true, provider: 'crane', engine: 'crane', reason: null,
    languages: S2S_LANGUAGES, model: process.env.CRANE_ASR_MODEL || DEFAULT_MODEL,
    stt: true, mt: Boolean(mtUrl()), tts: Boolean(ttsUrl()),
  };
}
const approxBase64Bytes = b64 => {
  if (!b64 || typeof b64 !== 'string') return 0;
  const clean = b64.includes(',') ? String(b64.split(',').pop()) : b64;
  return Math.floor((clean.length * 3) / 4);
};
export function validateS2SPayload({ audioBase64, sourceLang, targetLang }) {
  const problems = [];
  if (!isS2SLanguage(sourceLang)) problems.push(`Unknown sourceLang "${sourceLang}".`);
  if (!isS2SLanguage(targetLang)) problems.push(`Unknown targetLang "${targetLang}".`);
  if (sourceLang === targetLang) problems.push('sourceLang and targetLang must differ.');
  const bytes = approxBase64Bytes(audioBase64);
  if (!audioBase64 || typeof audioBase64 !== 'string' || bytes < 500) {
    problems.push('No usable audio — hold the mic closer, then retry.');
  } else if (bytes > maxAudioBytes()) {
    problems.push(`Audio chunk too large (${Math.round(bytes / 1024)} KB).`);
  }
  return problems;
}
async function fetchJson(url, { apiKey, body, ms }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
    });
    const text = await res.text().catch(() => '');
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { _raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally { clearTimeout(timer); }
}
export async function transcribeAudio({ audioBase64, mimeType, sourceLang }) {
  const url = asrUrl();
  if (providerName() !== 'crane' || !url) {
    return { ok: false, status: 503, error: 'Crane STT not configured (CRANE_ASR_URL).', engine: 'offline' };
  }
  let out;
  try {
    out = await fetchJson(url, {
      apiKey: process.env.CRANE_ASR_API_KEY || '',
      body: { model: process.env.CRANE_ASR_MODEL || DEFAULT_MODEL, language: sourceLang, audio: audioBase64, mimeType: mimeType || 'audio/webm', stream: false },
      ms: timeoutMs(),
    });
  } catch {
    return { ok: false, status: 502, error: 'Crane STT endpoint unreachable.', engine: 'crane' };
  }
  if (!out.ok) {
    const detail = out.data?.error || out.data?.message || `HTTP ${out.status}`;
    return { ok: false, status: 502, error: `Crane STT refused audio (${detail}).`, engine: 'crane' };
  }
  const d = out.data || {};
  const text = String(d.text ?? d.transcript ?? d.transcription ?? d?.data?.[0]?.text ?? '').trim();
  if (!text) return { ok: false, status: 502, error: 'Crane STT returned no transcript.', engine: 'crane' };
  return { ok: true, status: 200, text, engine: 'crane' };
}
export async function translateText({ text, sourceLang, targetLang }) {
  if (!text) return { ok: true, text: '', engine: 'passthrough' };
  const url = mtUrl();
  if (!url) return { ok: true, text, engine: 'passthrough', note: 'MT endpoint unset — transcript only.' };
  let out;
  try {
    out = await fetchJson(url, { apiKey: process.env.CRANE_MT_API_KEY || '', body: { text, source: sourceLang, target: targetLang }, ms: timeoutMs() });
  } catch {
    return { ok: false, error: 'Translation unreachable — showing original transcript.' };
  }
  if (!out.ok) return { ok: false, error: 'Translation refused — showing original transcript.' };
  const translated = String(out.data?.translation ?? out.data?.text ?? '').trim();
  if (!translated) return { ok: false, error: 'Empty translation — showing original transcript.' };
  return { ok: true, text: translated, engine: 'crane-mt' };
}
export async function synthesizeSpeech({ text, targetLang }) {
  const url = ttsUrl();
  if (!url) return { ok: false, engine: 'browser', error: 'TTS endpoint unset — use browser speech.' };
  let out;
  try {
    out = await fetchJson(url, { apiKey: process.env.CRANE_TTS_API_KEY || '', body: { text, language: targetLang, format: 'mp3' }, ms: timeoutMs() });
  } catch {
    return { ok: false, engine: 'crane', error: 'TTS endpoint unreachable.' };
  }
  if (!out.ok) return { ok: false, engine: 'crane', error: 'TTS refused the text.' };
  const audio = String(out.data?.audio ?? out.data?.audioBase64 ?? '');
  if (!audio) return { ok: false, engine: 'crane', error: 'TTS returned no audio.' };
  return { ok: true, engine: 'crane-tts', audioBase64: audio, mimeType: out.data?.mimeType || 'audio/mpeg' };
}
export async function translateSpeechTurn({ audioBase64, mimeType, sourceLang, targetLang }) {
  const problems = validateS2SPayload({ audioBase64, sourceLang, targetLang });
  if (problems.length) return { ok: false, status: 400, error: problems.join(' ') };
  const stt = await transcribeAudio({ audioBase64, mimeType, sourceLang });
  if (!stt.ok) return { ok: false, status: stt.status ?? 502, error: stt.error, engine: stt.engine };
  const mt = await translateText({ text: stt.text, sourceLang, targetLang });
  const translation = mt.ok ? mt.text : stt.text;
  const tts = await synthesizeSpeech({ text: translation, targetLang });
  return {
    ok: true, status: 200, transcript: stt.text, translation,
    translationEngine: mt.ok ? mt.engine : 'passthrough',
    translationNote: mt.ok ? (mt.note || null) : (mt.error || null),
    audioBase64: tts.ok ? tts.audioBase64 : null,
    audioMimeType: tts.ok ? tts.mimeType : null,
    audioEngine: tts.ok ? tts.engine : 'browser', engine: 'crane',
  };
}
