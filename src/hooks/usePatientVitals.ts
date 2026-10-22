/**
 * Recorded vitals for one chart, sourced from GET /api/vitals.
 *
 * This replaces the former client-side synthetic ticker: the values shown in
 * the consultation room are exactly what the clinic has recorded, refreshed
 * on an interval while the component is mounted. There is no fabricated
 * fallback — with nothing recorded (or the backend unreachable) the caller
 * renders an empty state instead of inventing numbers.
 */
import { useEffect, useState } from 'react';
import type { VitalsReading } from '../types';
import { fetchVitals } from '../lib/api';

/** Live-ish display refresh; the backend remains the source of truth. */
const REFRESH_MS = 15000;
const REFRESH_JITTER_MS = 5000;

export interface PatientVitalsState {
  /** Latest recorded reading, or null when the chart has none. */
  reading: VitalsReading | null;
  /** Recorded history, oldest first (bounded server-side). */
  history: VitalsReading[];
  loading: boolean;
  /** Set when the backend could not be reached or refused the read. */
  error: string | null;
}

const EMPTY_STATE: PatientVitalsState = { reading: null, history: [], loading: false, error: null };

export function usePatientVitals(patientId: string | null | undefined): PatientVitalsState {
  const [state, setState] = useState<PatientVitalsState>(
    patientId ? { ...EMPTY_STATE, loading: true } : EMPTY_STATE,
  );

  useEffect(() => {
    if (!patientId) {
      setState(EMPTY_STATE);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const data = await fetchVitals(patientId);
      if (cancelled) return;
      if (!data) {
        setState({ reading: null, history: [], loading: false, error: 'Vitals service unreachable.' });
        return;
      }
      const history = data.readings ?? [];
      setState({
        reading: history.length ? history[history.length - 1] : null,
        history,
        loading: false,
        error: null,
      });
    };

    void load();
    // Jittered so 50 open rooms do not pulse the vitals endpoint together.
    const intervalMs = REFRESH_MS + Math.floor(Math.random() * REFRESH_JITTER_MS);
    const timer = setInterval(() => void load(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [patientId]);

  return state;
}
