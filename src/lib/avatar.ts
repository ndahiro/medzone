/**
 * Avatar helpers shared by the registration form and report renderer.
 *
 * Uploads are validated in the browser, then normalised to a JPEG data URL so
 * the same value can be persisted with the account and embedded directly in
 * the dependency-free PDF writer. Keeping the DOM-dependent conversion in a
 * lazy path lets the validation and initials helpers run under plain Node.
 */

/** Maximum accepted source image size, before JPEG re-encoding. */
export const MAX_AVATAR_FILE_BYTES = 512 * 1024;

/** MIME types the registration picker accepts. */
export const ACCEPTED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const ACCEPT_ATTRIBUTE = ACCEPTED_AVATAR_TYPES.join(',');
const MAX_AVATAR_DIMENSION = 512;

export { ACCEPT_ATTRIBUTE };

export interface AvatarFileLike {
  type: string;
  size: number;
}

/**
 * Returns a human-readable validation error, or null when the file is usable.
 * Deliberately accepts a small structural shape so it is testable without a
 * real `File` object.
 */
export function validateAvatarFile(file: AvatarFileLike | null | undefined): string | null {
  if (!file) return 'Choose an image for the avatar.';
  if (!ACCEPTED_AVATAR_TYPES.includes(file.type as (typeof ACCEPTED_AVATAR_TYPES)[number])) {
    return 'Avatar must be a JPEG, PNG, or WebP image.';
  }
  if (file.size <= 0) return 'The selected avatar image is empty.';
  if (file.size > MAX_AVATAR_FILE_BYTES) {
    return 'Avatar must be smaller than 512 KB.';
  }
  return null;
}

/** Initials used when an account has no avatar (or the image fails to load). */
export function initialsFor(name: string): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0])[0]?.toUpperCase() ?? '?';
  const first = Array.from(words[0])[0] ?? '';
  const last = Array.from(words[words.length - 1])[0] ?? '';
  return `${first}${last}`.toUpperCase() || '?';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The browser could not read that image.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('The browser could not read that image.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (!src.startsWith('data:')) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected file is not a readable image.'));
    image.src = src;
  });
}

/**
 * Reads an uploaded image and returns a JPEG data URL.
 *
 * Re-encoding through a canvas normalises camera orientation, strips metadata,
 * caps the stored dimensions, and gives the PDF writer a predictable DCT stream.
 * If the canvas path is unavailable the original data URL is returned so the
 * avatar can still be previewed and saved.
 */
export async function avatarFileToDataUrl(file: File): Promise<string> {
  const validation = validateAvatarFile(file);
  if (validation) throw new Error(validation);

  const original = await readFileAsDataUrl(file);
  if (typeof document === 'undefined' || typeof Image === 'undefined') return original;

  try {
    const image = await loadImage(original);
    const scale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(image.width || 1, image.height || 1));
    const width = Math.max(1, Math.round((image.width || MAX_AVATAR_DIMENSION) * scale));
    const height = Math.max(1, Math.round((image.height || MAX_AVATAR_DIMENSION) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return original;

    // Flatten transparency onto white so transparent PNGs do not turn black
    // when the JPEG is embedded in a printed report.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    return original;
  }
}

/**
 * Converts any stored portrait (bundled asset URL, remote URL or data URL) to
 * a centre-cropped JPEG data URL the PDF writer can embed. Resolves null when
 * the image cannot be read, so a missing portrait never blocks a report.
 */
export async function imageUrlToJpegDataUrl(
  url: string | null | undefined,
  side = 160,
): Promise<string | null> {
  if (!url) return null;
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  try {
    const image = await loadImage(url);
    const sourceWidth = image.naturalWidth || image.width || side;
    const sourceHeight = image.naturalHeight || image.height || side;
    const sourceSide = Math.min(sourceWidth, sourceHeight);

    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) return null;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, side, side);
    context.drawImage(
      image,
      (sourceWidth - sourceSide) / 2,
      (sourceHeight - sourceSide) / 2,
      sourceSide,
      sourceSide,
      0,
      0,
      side,
      side,
    );
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    return null;
  }
}
