/**
 * Asset resolver.
 *
 * The backend stores avatar images by their original file name (for example
 * `doctor_neurology_rivera_....jpg`) so records stay portable and independent of
 * Vite's build-time content hashing. This module maps those keys back to the
 * bundled asset URLs at render time, and maps URLs back to keys when a record is
 * written to the API.
 */
import doctorChenImg from '../assets/images/doctor_cardiology_chen_1791375844784.jpg';
import doctorRiveraImg from '../assets/images/doctor_neurology_rivera_1791375857139.jpg';
import doctorRostovaImg from '../assets/images/doctor_pediatrics_rostova_1791375871692.jpg';
import patientJamesImg from '../assets/images/patient_james_avatar_1791375882733.jpg';

const AVATAR_ASSETS: Record<string, string> = {
  'doctor_cardiology_chen_1791375844784.jpg': doctorChenImg,
  'doctor_neurology_rivera_1791375857139.jpg': doctorRiveraImg,
  'doctor_pediatrics_rostova_1791375871692.jpg': doctorRostovaImg,
  'patient_james_avatar_1791375882733.jpg': patientJamesImg,
};

const byUrl = new Map(Object.entries(AVATAR_ASSETS).map(([key, url]) => [url, key]));

/** Resolves a stored asset key (or passthrough URL) to a renderable URL. */
export function resolveAvatarUrl(value: string | undefined | null): string {
  if (!value) return patientJamesImg;
  if (AVATAR_ASSETS[value]) return AVATAR_ASSETS[value];
  const basename = value.split('/').pop() ?? value;
  return AVATAR_ASSETS[basename] ?? value;
}

/** Converts a resolved asset URL back to its storage key for API writes. */
export function toAvatarKey(value: string | undefined | null): string {
  if (!value) return '';
  if (byUrl.has(value)) return byUrl.get(value) as string;
  const basename = value.split('/').pop() ?? value;
  return AVATAR_ASSETS[basename] ? basename : value;
}
