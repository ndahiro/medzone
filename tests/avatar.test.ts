import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  imageUrlToJpegDataUrl,
  initialsFor,
  MAX_AVATAR_FILE_BYTES,
  validateAvatarFile,
} from '../src/lib/avatar';
import { isValidAvatarDataUrl } from '../server/auth.js';

test('avatar upload accepts JPEG, PNG and WebP images', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(validateAvatarFile({ type, size: 1024 }), null, `${type} must be accepted`);
  }
});

test('avatar upload rejects non-images and files over the size cap', () => {
  assert.match(validateAvatarFile({ type: 'application/pdf', size: 1024 }) ?? '', /image/i);
  assert.match(
    validateAvatarFile({ type: 'image/jpeg', size: MAX_AVATAR_FILE_BYTES + 1 }) ?? '',
    /smaller/i,
  );
});

test('avatar initials fall back to a single letter when only one name exists', () => {
  assert.equal(initialsFor('Sophie Martin'), 'SM');
  assert.equal(initialsFor('Sophie'), 'S');
  assert.equal(initialsFor('  '), '?');
});

test('report avatar conversion skips accounts with no portrait', async () => {
  assert.equal(await imageUrlToJpegDataUrl(''), null);
  assert.equal(await imageUrlToJpegDataUrl(null), null);
});

test('the API accepts only image data URLs for avatars', () => {
  assert.equal(isValidAvatarDataUrl('data:image/jpeg;base64,AAAA'), true);
  assert.equal(isValidAvatarDataUrl('data:image/png;base64,AAAA'), true);
  assert.equal(isValidAvatarDataUrl(''), true);
  assert.equal(isValidAvatarDataUrl('javascript:alert(1)'), false);
  assert.equal(isValidAvatarDataUrl('data:text/html;base64,AAAA'), false);
  assert.equal(isValidAvatarDataUrl(`data:image/jpeg;base64,${'A'.repeat(800_000)}`), false);
});
