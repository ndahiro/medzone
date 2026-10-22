/**
 * MedZone Clinical Terminology Service
 *
 * Maps the platform's free-text clinical data onto the standardized vocabularies
 * required by US Core / ONC certification:
 *   - RxNorm for medications        (US Core MedicationRequest)
 *   - SNOMED CT for problems/allergies (US Core Condition / AllergyIntolerance)
 *   - LOINC for laboratory results  (US Core Laboratory Result Observation)
 *
 * In production these lookups are served by a terminology server (e.g. a
 * `/ValueSet/$expand` or RxNav call); this module provides a deterministic,
 * offline subset so the app stays standards-shaped without network access.
 */

import { Coding, TERMINOLOGY_SYSTEMS } from '../types';

const rxnorm = (code: string, display: string): Coding => ({
  system: TERMINOLOGY_SYSTEMS.RXNORM,
  code,
  display,
});

/** RxNorm normalized product (SCD/SBD) concepts, keyed by ingredient + strength. */
const RXNORM_PRODUCTS: Array<{ ingredient: string; strength: string; coding: Coding }> = [
  { ingredient: 'lisinopril', strength: '10mg', coding: rxnorm('314076', 'lisinopril 10 MG Oral Tablet') },
  { ingredient: 'lisinopril', strength: '20mg', coding: rxnorm('314077', 'lisinopril 20 MG Oral Tablet') },
  { ingredient: 'metformin', strength: '500mg', coding: rxnorm('860975', 'metformin hydrochloride 500 MG Extended Release Oral Tablet') },
  { ingredient: 'atorvastatin', strength: '20mg', coding: rxnorm('617311', 'atorvastatin 20 MG Oral Tablet') },
  { ingredient: 'amlodipine', strength: '5mg', coding: rxnorm('197361', 'amlodipine 5 MG Oral Tablet') },
];

/** RxNorm ingredient concepts, used when no product-strength match is found. */
const RXNORM_INGREDIENTS: Array<{ ingredient: string; coding: Coding }> = [
  { ingredient: 'lisinopril', coding: rxnorm('29046', 'lisinopril') },
  { ingredient: 'metformin', coding: rxnorm('6809', 'metformin') },
  { ingredient: 'atorvastatin', coding: rxnorm('83367', 'atorvastatin') },
  { ingredient: 'amlodipine', coding: rxnorm('17767', 'amlodipine') },
];

function normalizeIngredient(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(hydrochloride|hcl|calcium|sodium|extended[- ]release|er|xr|tablet|capsule)\b/g, '')
    .replace(/[^a-z]/g, '');
}

function normalizeStrength(dosage: string): string {
  return dosage.toLowerCase().replace(/\s+/g, '').replace('milligrams', 'mg');
}

/**
 * Resolves the RxNorm concept for a medication. Returns `undefined` when the
 * vocabulary has no match; callers should then emit a text-only
 * CodeableConcept rather than fabricating a code.
 */
export function lookupRxNorm(medicationName: string, dosage: string): Coding | undefined {
  const ingredient = normalizeIngredient(medicationName);
  const strength = normalizeStrength(dosage);

  const product = RXNORM_PRODUCTS.find(
    entry => ingredient.includes(entry.ingredient) && strength === normalizeStrength(entry.strength)
  );
  if (product) return product.coding;

  const ingredientMatch = RXNORM_INGREDIENTS.find(entry => ingredient.includes(entry.ingredient));
  return ingredientMatch?.coding;
}

/**
 * Converts a display date/time pair (e.g. "2026-03-26" + "4:00 PM") into an
 * ISO 8601 instant. The pair is the wall clock the user picked *in their own
 * timezone*, so the instant is built from local date components: rendering the
 * result back on the booking device shows the same time the user chose. A
 * UTC-anchored construction would shift the appointment by the host offset.
 */
export function toFhirDateTime(date: string, time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time.trim());
  let hours = 0;
  let minutes = 0;
  if (match) {
    hours = Number(match[1]) % 12;
    if (match[3].toUpperCase() === 'PM') hours += 12;
    minutes = Number(match[2]);
  }

  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return new Date().toISOString();
  const dt = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(dt.getTime()) ? new Date().toISOString() : dt.toISOString();
}
