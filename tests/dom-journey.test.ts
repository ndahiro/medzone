/**
 * Browser-level journey: the real React app rendered in jsdom against the
 * real Express app and MySQL.
 *
 * The HTTP contract tests prove what the API does; this proves the patient
 * gets there in a browser: signing in through the form, the dashboard
 * hydrating from the session cookie, the booking form refusing a past slot
 * before any request leaves the "browser", and the join button obeying the
 * 15-minute window (src/lib/visitWindow.ts). The video room itself is never
 * entered — jsdom has no getUserMedia.
 *
 * jsdom gaps closed here: relative request paths are resolved against the
 * booted server, and a one-cookie jar stands in for the browser's, since
 * Node's fetch stores none.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import 'dotenv/config';
import app from '../server/app.js';
import { closePool, query } from '../server/db.js';

// The app imports image assets the way Vite resolves them; plain Node chokes
// on those extensions, so stub them as strings before App is imported.
registerHooks({
  load(url, context, nextLoad) {
    if (/\.(?:jpe?g|png|svg)$/i.test(url)) {
      return { format: 'module', source: 'export default "asset-stub";', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

let server: import('node:http').Server;
let base: string;
let dom: JSDOM;
let container: HTMLElement;
let root: import('react-dom/client').Root;
let React: typeof import('react');
let act: typeof import('react').act;
let createRoot: typeof import('react-dom/client').createRoot;
let App: typeof import('../src/App')['default'];

const suffix = () => `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

// ---------------------------------------------------------------------------
// Browser shims
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
let sessionCookie = '';
const requests: string[] = [];

/** fetch() as the page sees it: relative URLs land on the test server and the
 * session cookie travels the way the browser would send it. */
const browserFetch: typeof fetch = async (input, init) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = rawUrl.startsWith('/') ? `${base}${rawUrl}` : rawUrl;
  const headers = new Headers(init?.headers);
  if (sessionCookie) headers.set('cookie', sessionCookie);
  requests.push(`${init?.method ?? 'GET'} ${rawUrl}`);
  const response = await realFetch(url, { ...init, headers });
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  if (setCookie) sessionCookie = setCookie.split(';')[0];
  return response;
};

const installGlobal = (key: string, value: unknown) => {
  try {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  } catch {
    // A non-configurable host global stays in place; nothing here needs it.
  }
};

const tick = async (ms = 25) => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
};

const waitFor = async (predicate: () => boolean, description: string, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await tick(50);
  }
  assert.fail(`the app never ${description}`);
};

/** React-safe value write: bypass the DOM's value tracker, then notify. */
const setValue = (element: Element, value: string) => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

const submitForm = async (form: Element) => {
  await act(async () => {
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
};

const buttonWithText = (text: string) =>
  [...dom.window.document.querySelectorAll('button')].find(button =>
    (button.textContent ?? '').includes(text),
  );

/** The deepest card carrying `bg-white` that mentions the marker. */
const cardShowing = (marker: string): Element | null => {
  const depth = (element: Element) => {
    let steps = 0;
    for (let node = element.parentElement; node; node = node.parentElement) steps += 1;
    return steps;
  };
  const candidates = [...dom.window.document.querySelectorAll('div')].filter(
    div => div.className.includes('bg-white') && (div.textContent ?? '').includes(marker),
  );
  return candidates.sort((a, b) => depth(b) - depth(a))[0] ?? null;
};

const joinButtonIn = (card: Element) =>
  [...card.querySelectorAll('button')].find(button =>
    /Join Video Visit|Rejoin visit/.test(button.textContent ?? ''),
  ) as HTMLButtonElement | undefined;

// ---------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object', 'the test server must be listening');
  base = `http://127.0.0.1:${address.port}`;

  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  installGlobal('window', window);
  installGlobal('document', window.document);
  installGlobal('navigator', window.navigator);
  installGlobal('localStorage', window.localStorage);
  installGlobal('sessionStorage', window.sessionStorage);
  installGlobal('getComputedStyle', window.getComputedStyle.bind(window));
  installGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window));
  installGlobal('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
  for (const name of [
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'MouseEvent',
    'KeyboardEvent',
    'CustomEvent',
    'DocumentFragment',
    'SVGElement',
    'MutationObserver',
  ]) {
    installGlobal(name, (window as unknown as Record<string, unknown>)[name]);
  }
  installGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  globalThis.fetch = browserFetch;

  React = await import('react');
  act = React.act;
  createRoot = (await import('react-dom/client')).createRoot;
  App = (await import('../src/App')).default;
});

after(async () => {
  globalThis.fetch = realFetch;
  await query('DELETE FROM appointments WHERE reason_for_visit LIKE ?', ['dom-journey-%']);
  await new Promise(resolve => server.close(resolve));
  await closePool();
  dom.window.close();
});

test('the patient signs in through the form and a past booking is refused client-side', async () => {
  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(App));
  });

  await waitFor(() => !!dom.window.document.querySelector('#username'), 'showed the sign-in form');
  setValue(dom.window.document.querySelector('#username')!, 'patient.demo');
  setValue(dom.window.document.querySelector('#password')!, 'Patient123');
  await submitForm(dom.window.document.querySelector('form')!);

  await waitFor(
    () => (dom.window.document.body.textContent ?? '').includes('Upcoming Virtual Consultations'),
    'hydrated the patient dashboard after the form sign-in',
  );
  assert.match(
    dom.window.document.body.textContent ?? '',
    /Welcome back, Ahmed Benali/,
    'the dashboard must open on the signed-in patient\'s chart',
  );

  // The security panel is reachable from the rail and exposes self-service
  // password rotation (the endpoint that revokes other sessions).
  const securityButton = dom.window.document.querySelector(
    '[aria-label="Open security and privacy settings"]',
  );
  assert.ok(securityButton, 'the rail must expose security settings');
  await act(async () => {
    (securityButton as HTMLButtonElement).click();
  });
  await waitFor(
    () => !!dom.window.document.querySelector('[aria-labelledby="security-modal-title"]'),
    'opened the security panel',
  );
  assert.ok(
    dom.window.document.querySelector('input[autocomplete="new-password"]'),
    'the panel must offer a password change form',
  );
  const closeSecurity = dom.window.document.querySelector('[aria-label="Close security panel"]');
  assert.ok(closeSecurity, 'the panel must have an accessible close control');
  await act(async () => {
    (closeSecurity as HTMLButtonElement).click();
  });
  await waitFor(
    () => !dom.window.document.querySelector('[aria-labelledby="security-modal-title"]'),
    'closed the security panel',
  );

  // The patient's summary export exposes a real PDF download (the document
  // builder itself is covered by tests/pdf.test.ts).
  const exportSummary = buttonWithText('Export Medical Summary');
  assert.ok(exportSummary, 'the patient portal must offer a medical summary export');
  await act(async () => {
    (exportSummary as HTMLButtonElement).click();
  });
  await waitFor(
    () => !!dom.window.document.querySelector('[aria-labelledby="summary-modal-title"]'),
    'opened the summary panel',
  );
  assert.ok(
    dom.window.document.querySelector('[aria-label="Download patient health summary as PDF"]'),
    'the summary panel must offer a PDF download',
  );
  const closeSummary = dom.window.document.querySelector('[aria-label="Close summary"]');
  assert.ok(closeSummary, 'the summary panel must have an accessible close control');
  await act(async () => {
    (closeSummary as HTMLButtonElement).click();
  });
  await waitFor(
    () => !dom.window.document.querySelector('[aria-labelledby="summary-modal-title"]'),
    'closed the summary panel',
  );

  // Open the booking form.
  const newVisit = buttonWithText('+ New Visit');
  assert.ok(newVisit, 'the dashboard must offer a New Visit action');
  await act(async () => {
    (newVisit as HTMLButtonElement).click();
  });
  await waitFor(() => !!dom.window.document.querySelector('input[type="date"]'), 'opened the booking form');

  // A past slot must be refused before any request leaves the browser.
  const postCount = () => requests.filter(entry => entry === 'POST /api/appointments').length;
  const postsBeforeRefusal = postCount();
  setValue(dom.window.document.querySelector('input[type="date"]')!, '2020-01-01');
  setValue(dom.window.document.querySelector('textarea')!, `dom-journey-past-${suffix()}`);
  await submitForm(dom.window.document.querySelector('form')!);
  await tick(150);
  assert.equal(
    postCount(),
    postsBeforeRefusal,
    'a past visit must be refused locally, not by the server',
  );
  assert.ok(
    dom.window.document.querySelector('input[type="date"]'),
    'the booking form must stay open so the patient can pick another slot',
  );

  // A future slot goes through the server, lands on the dashboard, and the
  // new card's Join button is window-gated.
  const marker = `dom-journey-booked-${suffix()}`;
  setValue(dom.window.document.querySelector('input[type="date"]')!, '2027-03-01');
  setValue(dom.window.document.querySelector('textarea')!, marker);
  await submitForm(dom.window.document.querySelector('form')!);
  await waitFor(
    () => !dom.window.document.querySelector('input[type="date"]'),
    'closed the booking form after the server accepted the visit',
  );
  assert.equal(postCount(), postsBeforeRefusal + 1, 'the accepted booking must have reached the API');
  const stored = (await query('SELECT id FROM appointments WHERE reason_for_visit = ?', [
    marker,
  ])) as unknown as Array<{ id: string }>;
  assert.equal(stored.length, 1, 'the accepted booking must be on the chart server-side');

  await waitFor(() => !!cardShowing(marker), 'rendered the booked visit on the dashboard');
  const card = cardShowing(marker)!;
  assert.match(
    card.textContent ?? '',
    /Opens 15 minutes before the start/,
    'a visit months away must say when its room opens',
  );
  const join = joinButtonIn(card);
  assert.ok(join, 'the booked visit must offer a join action');
  assert.equal(join.disabled, true, 'a visit months away cannot be joined yet');

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

test('a visit inside the join window is joinable through the same UI', async () => {
  // Book two visits with a raw session — one hours away, one inside the
  // 15-minute window — then render the app with the session already in place.
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'patient.demo', password: 'Patient123' }),
  });
  assert.equal(login.status, 200, 'the raw patient session must sign in');

  const bootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  const template = bootstrap.appointments.find((a: { patientId: string }) => a.patientId === 'pat-001');
  assert.ok(template, 'pat-001 needs a seeded visit to model the booking on');

  const randomCode = () => Math.random().toString(36).slice(2, 10).toUpperCase();

  const bookAt = async (id: string, reason: string, startBaseMs: number, attempts: number) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const booking = {
        ...template,
        id,
        status: 'scheduled',
        scheduledStart: new Date(startBaseMs + attempt * 61_000).toISOString(),
        reasonForVisit: reason,
        roomCode: `MED-ZONE-D${randomCode()}`,
        encryptedSessionKey: `ENC-KEY-D${randomCode()}-AES256`,
      };
      const response = await fetch(`${base}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(booking),
      });
      if (response.status === 201) return booking;
      assert.equal(response.status, 409, `raw booking ${id} failed unexpectedly (${response.status})`);
    }
    return assert.fail(`no free slot for ${id}`);
  };

  const near = await bookAt(
    `dom-journey-near-${suffix()}`,
    `dom-journey-near-${suffix()}`,
    Date.now() + 11 * 60_000,
    4,
  );
  const far = await bookAt(
    `dom-journey-far-${suffix()}`,
    `dom-journey-far-${suffix()}`,
    Date.now() + 36 * 60 * 60_000,
    4,
  );

  container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(App));
  });

  await waitFor(() => !!cardShowing(near.roomCode), 'rendered the near-window visit');

  const nearJoin = joinButtonIn(cardShowing(near.roomCode)!);
  assert.ok(nearJoin, 'the near-window visit must offer a join action');
  assert.equal(nearJoin.disabled, false, 'the room opens 15 minutes before the start');
  assert.doesNotMatch(
    cardShowing(near.roomCode)!.textContent ?? '',
    /Opens 15 minutes before the start/,
    'an open window must not be labelled as closed',
  );

  const farJoin = joinButtonIn(cardShowing(far.roomCode)!);
  assert.ok(farJoin, 'the far visit must offer a join action');
  assert.equal(farJoin.disabled, true, 'a visit a day and a half away cannot be joined yet');

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

test('a provider clash only the server can see is refused with the server reason', async () => {
  // The other chart is invisible to patient.demo, so this clash cannot be
  // caught by the local rules — the server's refusal reason must travel back
  // to the caller instead of reading as "the scheduling service is down".
  const rawLogin = async (username: string, password: string) => {
    const response = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200, `${username} must sign in`);
  };

  const randomCode = () => Math.random().toString(36).slice(2, 10).toUpperCase();

  await rawLogin('patient.fatima', 'Patient123');
  const fatimaBootstrap = await (await fetch(`${base}/api/bootstrap`)).json();
  const template = fatimaBootstrap.appointments?.[0];
  assert.ok(template, 'patient.fatima needs a seeded visit to model the booking on');

  let clashInstant: string | null = null;
  for (let attempt = 0; attempt < 4 && !clashInstant; attempt += 1) {
    const booking = {
      ...template,
      id: `dom-journey-clash-${suffix()}`,
      status: 'scheduled',
      scheduledStart: new Date(Date.now() + 41 * 60 * 60_000 + attempt * 61_000).toISOString(),
      reasonForVisit: `dom-journey-clash-${suffix()}`,
      roomCode: `MED-ZONE-D${randomCode()}`,
      encryptedSessionKey: `ENC-KEY-D${randomCode()}-AES256`,
    };
    const response = await fetch(`${base}/api/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(booking),
    });
    if (response.status === 201) clashInstant = booking.scheduledStart;
    else assert.equal(response.status, 409, `clash setup failed unexpectedly (${response.status})`);
  }
  assert.ok(clashInstant, 'the clash setup booking needs a free slot');

  await rawLogin('patient.demo', 'Patient123');
  const { createAppointmentChecked } = await import('../src/lib/api.ts');
  const { appointment, error } = await createAppointmentChecked({
    ...template,
    id: `dom-journey-double-${suffix()}`,
    patientId: 'pat-001',
    patientName: 'Ahmed Benali',
    patientMrn: 'MRN-849201',
    patientAge: 41,
    patientGender: 'Male',
    status: 'scheduled',
    scheduledStart: clashInstant,
    reasonForVisit: `dom-journey-double-${suffix()}`,
    roomCode: `MED-ZONE-D${randomCode()}`,
    encryptedSessionKey: `ENC-KEY-D${randomCode()}-AES256`,
  });
  assert.equal(appointment, null, 'the clashing booking must not be accepted');
  assert.equal(
    error,
    'That time was just taken. Choose another slot.',
    'the server refusal reason must reach the caller',
  );
});
