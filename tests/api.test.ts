/**
 * API client contract, verified with a stubbed global fetch so no server is
 * required: reads parse payloads / resolve null on failure, writes send the
 * exact JSON the backend validates.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBootstrap, createConsultantNote, type BootstrapPayload } from '../src/lib/api';
import type { ConsultantNote } from '../src/types';

const originalFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];
let next: () => Response | Promise<Response>;

const respond = () => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return next();
  }) as typeof fetch;
};

beforeEach(() => {
  calls = [];
  respond();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const emptyPayload = (): BootstrapPayload => ({
  patient: null,
  patients: [],
  providers: [],
  appointments: [],
  prescriptions: [],
  auditLogs: [],
  notifications: [],
  followUp: null,
  followUps: [],
  soapNotes: null,
  chatMessages: [],
  consultantNotes: [],
  consultationRequests: [],
  referrals: [],
});

test('fetchBootstrap hits /api/bootstrap and parses the payload', async () => {
  const payload = emptyPayload();
  next = () => new Response(JSON.stringify(payload), { status: 200 });
  assert.deepEqual(await fetchBootstrap(), payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/bootstrap');
});

test('fetchBootstrap resolves null on HTTP errors and network failures', async () => {
  next = () => new Response('boom', { status: 500 });
  assert.equal(await fetchBootstrap(), null);

  next = () => {
    throw new Error('ECONNREFUSED');
  };
  assert.equal(await fetchBootstrap(), null);
});

test('createConsultantNote POSTs the note as JSON to /api/consultant-notes', async () => {
  const note: ConsultantNote = {
    id: 'cn-api-1',
    patientId: 'pat-001',
    patientName: 'Jane Doe',
    patientMrn: 'MRN-777',
    authorName: 'Dr Who',
    authorRole: 'clinician',
    title: 'Title with "quotes"',
    body: 'Body text',
    createdAt: '2026-01-02T03:04:05.000Z',
  };
  next = () => new Response(JSON.stringify(note), { status: 201 });

  assert.deepEqual(await createConsultantNote(note), note);
  const call = calls[0];
  assert.equal(call.url, '/api/consultant-notes');
  assert.equal(call.init?.method, 'POST');
  const headers = new Headers(call.init?.headers);
  assert.equal(headers.get('Content-Type'), 'application/json');
  assert.deepEqual(JSON.parse(String(call.init?.body)), note);
});

test('createConsultantNote resolves null when the backend rejects the write', async () => {
  next = () => new Response(JSON.stringify({ error: 'Missing required fields: body' }), { status: 400 });
  const note = {
    id: 'cn-api-2',
    patientId: 'pat-001',
    patientName: 'Jane Doe',
    patientMrn: 'MRN-777',
    authorName: 'Dr Who',
    authorRole: 'clinician',
    title: 'T',
    body: 'B',
    createdAt: '2026-01-02T03:04:05.000Z',
  } satisfies ConsultantNote;
  assert.equal(await createConsultantNote(note), null);
});
