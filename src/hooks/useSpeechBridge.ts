/**
 * Opt-in speech-to-speech bridge for a live tele-visit (Crane AI first).
 * Push-to-talk capture -> POST s2s/translate -> live captions + playback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchS2SStatus, postS2SConsent, postS2STurn } from '../lib/api';
import type { S2SLanguage, S2SStatus } from '../lib/api';
import { LOCAL_LANGUAGES, browserVoiceTag } from '../lib/localLanguages';
export interface S2SCaption {
  id: string; at: string; mine: boolean;
  transcript: string; translation: string;
  engine: string; note: string | null;
}
// The server's catalogue is authoritative; this copy only covers the window
// before the status probe answers (or when it fails). It is the shared
// catalogue, so it can never drift behind the server's list of local
// languages — the two are pinned by tests/local-language.test.ts.
const FALLBACK_LANGS: S2SLanguage[] = LOCAL_LANGUAGES.map(l => ({
  code: l.code,
  label: l.label,
  native: l.native,
  craneStt: l.craneStt,
  sttNote: l.sttNote,
}));
export function useSpeechBridge({ appointmentId, live }: { appointmentId: string | null; live: boolean }) {
  const [status, setStatus] = useState<S2SStatus | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [sourceLang, setSourceLang] = useState('lg');
  const [targetLang, setTargetLang] = useState('en');
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [captions, setCaptions] = useState<S2SCaption[]>([]);
  const [browserLive, setBrowserLive] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recogRef = useRef<unknown>(null);
  const langs = status?.languages?.length ? status.languages : FALLBACK_LANGS;
  useEffect(() => {
    let cancelled = false;
    void fetchS2SStatus().then(s => { if (!cancelled && s) setStatus(s); });
    return () => { cancelled = true; };
  }, []);
  const stopBrowser = useCallback(() => {
    try { (recogRef.current as { stop?: () => void } | null)?.stop?.(); } catch { /* noop */ }
    recogRef.current = null;
    setBrowserLive(false);
  }, []);
  const speakBrowser = useCallback((text: string, lang: string) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = browserVoiceTag(lang);
      synth.speak(utter);
    } catch { /* unsupported */ }
  }, []);
  const playServerAudio = useCallback((b64: string, mime: string | null) => {
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'audio/mpeg' }));
      const el = new Audio(url);
      el.onended = () => URL.revokeObjectURL(url);
      void el.play().catch(() => URL.revokeObjectURL(url));
    } catch { /* ignore */ }
  }, []);
  const pushCaption = useCallback((c: Omit<S2SCaption, 'id' | 'at'>) => {
    setCaptions(prev => [...prev.slice(-49), { ...c, id: `s2s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, at: new Date().toISOString() }]);
  }, []);
  const startBrowserCaptions = useCallback(() => {
    const w = window as unknown as { webkitSpeechRecognition?: new () => unknown; SpeechRecognition?: new () => unknown };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setNotice('Browser captions unsupported here — the call itself is unaffected.');
      return;
    }
    try {
      const recog = new SR() as unknown as {
        lang: string; interimResults: boolean; continuous: boolean;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: ((e: { error?: string }) => void) | null;
        onend: (() => void) | null; start: () => void;
      };
      recog.lang = browserVoiceTag(sourceLang);
      recog.interimResults = false;
      recog.continuous = true;
      recog.onresult = (e) => {
        const last = e.results?.[e.results.length - 1]?.[0]?.transcript?.trim();
        if (!last) return;
        pushCaption({ mine: true, transcript: last, translation: last, engine: 'browser-caption', note: 'On-device captions (no translation).' });
      };
      recog.onerror = (e) => setNotice(`Browser captions paused (${e?.error || 'mic busy'}) — tap record again.`);
      recog.onend = () => setBrowserLive(false);
      recog.start();
      recogRef.current = recog;
      setBrowserLive(true);
      setNotice('Crane service unreachable — on-device captions running (no translation).');
    } catch {
      setNotice('Browser captions could not start here.');
    }
  }, [sourceLang, pushCaption]);
  const recordTurn = useCallback(async () => {
    if (!appointmentId || !live || recording || working) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice('Microphone capture unavailable in this browser.');
      return;
    }
    setNotice(null);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setNotice('Microphone blocked — allow mic access, then retry.');
      return;
    }
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime });
    } catch {
      stream.getTracks().forEach(t => t.stop());
      setNotice('Voice recording unsupported in this browser.');
      return;
    }
    chunksRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      stream?.getTracks().forEach(t => t.stop());
      setRecording(false);
      const blob = new Blob(chunksRef.current, { type: mime });
      if (!blob.size) { setNotice('Nothing captured — hold the mic closer and retry.'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        const b64 = dataUrl.includes(',') ? String(dataUrl.split(',').pop()) : dataUrl;
        setWorking(true);
        const { turn, error } = await postS2STurn(appointmentId, { audioBase64: b64, mimeType: mime, sourceLang, targetLang });
        setWorking(false);
        if (!turn) {
          setNotice(error || 'Voice turn failed.');
          startBrowserCaptions();
          return;
        }
        pushCaption({ mine: true, transcript: turn.transcript, translation: turn.translation, engine: turn.engine, note: turn.translationNote });
        if (turn.audioBase64) playServerAudio(turn.audioBase64, turn.audioMimeType);
        else speakBrowser(turn.translation, targetLang);
      };
      reader.readAsDataURL(blob);
    };
    recorder.start();
    setRecording(true);
    window.setTimeout(() => {
      try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* noop */ }
    }, 6000);
  }, [appointmentId, live, recording, working, sourceLang, targetLang, pushCaption, playServerAudio, speakBrowser, startBrowserCaptions]);
  const stopTurn = useCallback(() => {
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* noop */ }
  }, []);
  const toggleEnabled = useCallback(async (next: boolean) => {
    setEnabled(next);
    if (!next) {
      stopBrowser();
      stopTurn();
      setNotice(null);
      if (appointmentId) void postS2SConsent(appointmentId, { enabled: false, sourceLang, targetLang });
      return;
    }
    setNotice(null);
    if (appointmentId) {
      const saved = await postS2SConsent(appointmentId, { enabled: true, sourceLang, targetLang });
      if (!saved) setNotice('Consent could not reach the server — translation still works; the audit entry retries next turn.');
    }
  }, [appointmentId, sourceLang, targetLang, stopBrowser, stopTurn]);
  useEffect(() => () => {
    stopBrowser();
    try { if (recorderRef.current?.state === 'recording') recorderRef.current.stop(); } catch { /* noop */ }
    try { window.speechSynthesis?.cancel(); } catch { /* noop */ }
  }, [stopBrowser]);
  return {
    status, langs, enabled, toggleEnabled, sourceLang, setSourceLang, targetLang, setTargetLang,
    recording, working, notice, captions, clearCaptions: () => setCaptions([]),
    recordTurn, stopTurn, browserLive, startBrowserCaptions,
    speakLast: () => {
      const last = captions[captions.length - 1];
      if (last) speakBrowser(last.translation, targetLang);
    },
  };
}
export type SpeechBridge = ReturnType<typeof useSpeechBridge>;
