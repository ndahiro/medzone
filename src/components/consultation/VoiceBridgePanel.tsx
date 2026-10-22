/**
 * Voice translation panel for the tele-visit room.
 * Opt-in per user: language pair, push-to-talk capture, live captions,
 * translated playback. Crane-first, honest when offline.
 */
import React from 'react';
import { Languages, Mic, Square, Volume2, Captions, Trash2, Info } from 'lucide-react';
import type { SpeechBridge } from '../../hooks/useSpeechBridge';
const LangSelect: React.FC<{
  label: string; value: string;
  onChange: (v: string) => void;
  langs: SpeechBridge['langs'];
}> = ({ label, value, onChange, langs }) => (
  <label className="flex flex-col gap-1 text-[11px] font-semibold text-slate-300">
    {label}
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-white focus:border-teal-500"
    >
      {langs.map(l => (
        <option key={l.code} value={l.code}>
          {l.label} · {l.native}{l.craneStt ? '' : ' (fallback)'}
        </option>
      ))}
    </select>
  </label>
);
export const VoiceBridgePanel: React.FC<{ bridge: SpeechBridge; live: boolean }> = ({ bridge, live }) => {
  const { status, langs, enabled, toggleEnabled } = bridge;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-bold text-white">
          <Languages className="w-4 h-4 text-teal-300" /> Voice translation
        </span>
        <button
          onClick={() => void toggleEnabled(!enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${enabled ? 'bg-teal-500' : 'bg-slate-700'}`}
          role="switch" aria-checked={enabled} aria-label="Toggle voice translation"
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-5' : 'left-0.5'}`} />
        </button>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        {status?.available
          ? `Crane AI on — ${status.model}. Your speech is translated for this visit only; audio is never stored.`
          : (status?.reason || 'Voice service offline — on-device captions remain where the browser supports them. Audio is never stored.')}
      </p>
      {!enabled ? (
        <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Turn this on only if you want your speech translated. Each person opts in for themselves.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <LangSelect label="I speak" value={bridge.sourceLang} onChange={bridge.setSourceLang} langs={langs} />
            <LangSelect label="Hear as" value={bridge.targetLang} onChange={bridge.setTargetLang} langs={langs} />
          </div>
          <div className="flex items-center gap-2">
            {!bridge.recording ? (
              <button
                onClick={() => void bridge.recordTurn()}
                disabled={!live || bridge.working}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" /> {bridge.working ? 'Translating…' : 'Hold to translate (6s)'}
              </button>
            ) : (
              <button
                onClick={bridge.stopTurn}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white cursor-pointer animate-pulse"
              >
                <Square className="w-3.5 h-3.5" /> Stop & translate
              </button>
            )}
            <button
              onClick={bridge.speakLast}
              title="Replay last translation"
              className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
            >
              <Volume2 className="w-4 h-4" />
            </button>
            <button
              onClick={bridge.clearCaptions}
              title="Clear captions"
              className="p-2 rounded-lg border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          {bridge.notice && (
            <p className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-800 rounded-lg px-2 py-1.5">
              {bridge.notice}{' '}
              {!status?.available && (
                <button onClick={bridge.startBrowserCaptions} className="underline font-bold cursor-pointer">
                  Use on-device captions
                </button>
              )}
            </p>
          )}
          {bridge.captions.length > 0 ? (
            <div className="space-y-1.5 max-h-44 overflow-y-auto" aria-live="polite">
              {bridge.captions.slice(-8).map(c => (
                <div key={c.id} className="text-[11px] rounded-lg bg-slate-950 border border-slate-800 px-2 py-1.5">
                  <p className="text-slate-400">{c.transcript}</p>
                  <p className="text-white font-medium">→ {c.translation}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">via {c.engine}{c.note ? ` · ${c.note}` : ''}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <Captions className="w-3.5 h-3.5" /> Live captions appear here after each translated turn.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
