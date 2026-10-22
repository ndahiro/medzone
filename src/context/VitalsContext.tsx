/**
 * Live vitals bridge for the consultation room.
 *
 * The room previously imported a VitalsContext that was never committed, which
 * broke `npm run lint`. This context re-exports the recorded-vitals hook
 * (GET /api/vitals via usePatientVitals) so the room renders the chart's real
 * readings and an honest empty state — never invented numbers. The provider is
 * mounted per-room with the active patient's chart id.
 */
import React, { createContext, useContext } from 'react';
import { usePatientVitals, type PatientVitalsState } from '../hooks/usePatientVitals';

const EMPTY_VITALS: PatientVitalsState = { reading: null, history: [], loading: false, error: null };

const VitalsContext = createContext<PatientVitalsState>(EMPTY_VITALS);

export const VitalsProvider: React.FC<{ patientId: string | null; children: React.ReactNode }> = ({
  patientId,
  children,
}) => {
  const state = usePatientVitals(patientId);
  return <VitalsContext.Provider value={state}>{children}</VitalsContext.Provider>;
};

/** Recorded vitals for the active chart; null reading means "no data recorded". */
export const useLiveVitals = (): PatientVitalsState => useContext(VitalsContext);