/**
 * Browser crypto helper contract.
 *
 * Visit transcripts are encrypted server-side now (server/crypto.js), so this
 * helper must never manufacture a key a second session could guess. Two
 * independent sessions with no shared secret hold different keys; only an
 * explicitly shared secret lets a payload travel between them.
 *
 * Each import of the module stands in for one browser session (a query-string
 * specifier defeats the module cache).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const session = (name: string) => import(`../src/lib/crypto.ts?session=${name}`);

test('two sessions with no shared secret do not agree on a key', async () => {
  const alice = await session('alice');
  const bob = await session('bob');

  const payload = await alice.encryptPHI('Patient reports chest tightness.');
  const decoded = await bob.decryptPHI(payload.cipherHex, payload.ivHex, payload.saltHex);

  assert.match(decoded, /Encrypted Health Data/, 'a session key must not be derivable by another session');
});

test('an explicit secret is what makes a payload portable', async () => {
  const alice = await session('alice-explicit');
  const bob = await session('bob-explicit');

  const payload = await alice.encryptPHI('deployment-bound', { secret: 'deployment-key' });
  assert.equal(
    await bob.decryptPHI(payload.cipherHex, payload.ivHex, payload.saltHex, { secret: 'deployment-key' }),
    'deployment-bound'
  );

  const wrongKey = await bob.decryptPHI(payload.cipherHex, payload.ivHex, payload.saltHex, {
    secret: 'another-key',
  });
  assert.match(wrongKey, /Encrypted Health Data/, 'a different secret must not read the payload');
});

test('a single session round-trips with no options at all', async () => {
  const solo = await session('solo');
  const payload = await solo.encryptPHI('self test');
  assert.equal(await solo.decryptPHI(payload.cipherHex, payload.ivHex, payload.saltHex), 'self test');
});
