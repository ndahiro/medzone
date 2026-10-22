/**
 * Structural tests for the zero-dependency PDF writer used by the patient's
 * "Download PDF" action: header/trailer/xref integrity, object offsets, and
 * multi-page layout for long consultant notes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, consultantNotePdfDocument, patientSummaryPdfDocument } from '../src/lib/pdf';
import type { Appointment, ConsultantNote, PatientProfile, Prescription } from '../src/types';

const note = (overrides: Partial<ConsultantNote> = {}): ConsultantNote => ({
  id: 'cn-pdf-1',
  patientId: 'pat-001',
  patientName: 'Test Patient',
  patientMrn: 'MRN-TEST',
  authorName: 'Test Author',
  authorRole: 'clinician',
  title: 'Test Note Title',
  body: 'First line of the note.\nSecond line of the note.',
  createdAt: '2026-01-02T03:04:05.000Z',
  ...overrides,
});

const toLatin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, byte => String.fromCharCode(byte)).join('');

/** 8x8 teal JPEG: small enough to inline, real enough for the PDF decoder. */
const TINY_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzyiiiv1U/lQ//2Q==';

test('the patient summary PDF embeds an uploaded avatar as a JPEG image', () => {
  const text = toLatin1(
    buildPdf(
      patientSummaryPdfDocument({
        patient: { ...patient, avatarUrl: TINY_JPEG_DATA_URL },
        prescriptions: [],
        appointments: [],
      }),
    ),
  );

  assert.ok(text.includes('/Subtype /Image'), 'the avatar must be an image XObject');
  assert.ok(text.includes('/Filter /DCTDecode'), 'the JPEG bytes must be embedded directly');
  assert.ok(text.includes('/XObject << /Im1'), 'the page resources must reference the avatar');
  assert.ok(text.includes('/Im1 Do'), 'the page content must draw the avatar');
  assert.ok(text.includes('/Width 8'), 'the JPEG dimensions must be read from the file');

  const avatar = /([\d.]+) 0 0 ([\d.]+) [\d.]+ ([\d.]+) cm\n\/Im1 Do/.exec(text);
  assert.ok(avatar, 'the avatar placement matrix must be present');
  const title = /1 0 0 1 56 ([\d.]+) Tm\n\(Patient Health Summary\)/.exec(text);
  assert.ok(title, 'the report title must be present');
  assert.ok(
    Number(title![1]) <= Number(avatar![3]),
    'the letterhead must reserve space so text does not overlap the avatar',
  );
});

test('a short note produces a structurally valid PDF with a correct xref table', () => {
  const bytes = buildPdf(consultantNotePdfDocument(note()));
  const text = toLatin1(bytes);

  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));

  const xref = /xref\n0 (\d+)\n/.exec(text);
  assert.ok(xref, 'xref table must exist');
  const objectCount = Number(xref![1]);

  const entriesStart = xref!.index + xref![0].length;
  for (let id = 1; id < objectCount; id += 1) {
    const entry = text.slice(entriesStart + id * 20, entriesStart + (id + 1) * 20);
    const offset = Number(entry.slice(0, 10));
    assert.ok(text.startsWith(`${id} 0 obj`, offset), `object ${id} offset must point at its definition`);
  }

  assert.ok(text.includes('/Type /Catalog'));
  assert.ok(text.includes('/BaseFont /Helvetica'));
});

test('note content (patient, MRN, title, body, footer) is embedded in the document', () => {
  const text = toLatin1(buildPdf(consultantNotePdfDocument(note())));
  assert.ok(text.includes('Patient: Test Patient  |  MRN: MRN-TEST'));
  assert.ok(text.includes('Test Note Title'));
  assert.ok(text.includes('First line of the note.'));
  assert.ok(text.includes('MedZone Telemedicine'));
  assert.ok(text.includes('Test Author'));
});

test('long notes paginate: /Count rises and per-page footers are stamped', () => {
  const longBody = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} with enough characters to wrap across several lines of the PDF layout engine.`).join('\n\n');
  const text = toLatin1(buildPdf(consultantNotePdfDocument(note({ body: longBody }))));

  const count = /\/Count (\d+)/.exec(text);
  assert.ok(count, 'page tree count must exist');
  assert.ok(Number(count![1]) >= 2, 'a long note must span multiple pages');
  assert.ok(text.includes('Page 1 of'), 'page footers must be present');
});

test('non-Latin input degrades to safe WinAnsi output instead of corrupting bytes', () => {
  const text = toLatin1(buildPdf(consultantNotePdfDocument(note({ title: 'Značka — “quoted” ✓' }))));
  assert.ok(text.includes('Znacka'));
  assert.ok(!text.includes('\u0000'));
});

const patient: PatientProfile = {
  id: 'pat-pdf-1',
  mrn: 'MRN-PDF-1',
  name: 'Priya Nair',
  dob: '1991-04-12',
  age: 35,
  gender: 'Female',
  bloodType: 'O+',
  email: 'priya@example.test',
  phone: '+10000000004',
  avatarUrl: 'avatar.jpg',
  address: '1 Test Street',
  emergencyContact: { name: 'Ravi Nair', relationship: 'Spouse', phone: '+10000000005' },
  insurance: { provider: 'MedCare', policyNumber: 'POL-1', groupNumber: 'GRP-1' },
  allergies: [
    {
      substance: 'Penicillin',
      reaction: 'Rash',
      severity: 'moderate',
      substanceCode: { system: 'http://snomed.info/sct', code: '373270004', display: 'Penicillin' },
    },
  ],
  conditions: [
    {
      id: 'cond-1',
      name: 'Hypertension',
      icd10: 'I10',
      snomed: { system: 'http://snomed.info/sct', code: '38341003', display: 'Hypertension' },
      diagnosedDate: '2024-02-01',
      status: 'managed',
    },
  ],
  recentLabs: [
    {
      id: 'lab-1',
      testName: 'HbA1c',
      category: 'Endocrine',
      loinc: { system: 'http://loinc.org', code: '4548-4', display: 'HbA1c' },
      value: '5.6',
      unit: '%',
      referenceRange: '4.0-5.6',
      date: '2026-01-02',
      status: 'normal',
    },
  ],
  vitalsHistory: [],
};

const prescription: Prescription = {
  id: 'rx-pdf-1',
  patientId: patient.id,
  patientName: patient.name,
  medicationName: 'Cetirizine',
  dosage: '10mg',
  route: 'Oral',
  frequency: 'Once daily at bedtime',
  quantity: 30,
  totalRefills: 2,
  remainingRefills: 1,
  prescribingDoctor: 'Dr. Marcus Rivera, MD',
  prescribedDate: '2026-10-19',
  pharmacy: 'MedZone Pharmacy',
  instructions: 'Take one tablet nightly while symptoms persist.',
  status: 'active',
  nextDoseMinutes: 60,
  nextDoseAt: '2026-10-19T22:00:00.000Z',
  adherencePercentage: 92,
};

const visit: Appointment = {
  id: 'apt-pdf-1',
  patientId: patient.id,
  patientName: patient.name,
  patientMrn: patient.mrn,
  patientAge: patient.age,
  patientGender: patient.gender,
  providerId: 'prov-002',
  providerName: 'Dr. Marcus Rivera, MD',
  providerTitle: 'Consulting Physician',
  providerSpecialty: 'Cardiovascular & Internal Medicine',
  providerAvatar: 'doctor.jpg',
  date: '2026-10-19',
  time: '10:00 AM',
  scheduledStart: '2026-10-19T10:00:00.000Z',
  type: 'Virtual Consultation',
  status: 'completed',
  reasonForVisit: 'Cough review',
  triagePriority: 'routine',
  roomCode: 'MED-ZONE-PDF1',
  encryptedSessionKey: 'enc-key',
};

test('the patient summary PDF includes demographics, medication and visit data', () => {
  const text = toLatin1(
    buildPdf(
      patientSummaryPdfDocument({
        patient,
        prescriptions: [prescription],
        appointments: [visit],
        generatedAt: new Date('2026-10-19T12:00:00.000Z'),
      }),
    ),
  );

  const flat = text.replace(/\r?\n/g, ' ');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(flat.includes('Patient Health Summary'));
  assert.ok(flat.includes('Priya Nair'));
  assert.ok(flat.includes('MRN-PDF-1'));
  assert.ok(flat.includes('Penicillin'));
  assert.ok(flat.includes('Hypertension'));
  assert.ok(flat.includes('Cetirizine'));
  assert.ok(flat.includes('Once daily at bedtime'));
  assert.ok(flat.includes('Dr. Marcus Rivera, MD'));
  assert.ok(flat.includes('MedZone Pharmacy'));
  assert.ok(flat.includes('HbA1c'));
  assert.ok(flat.includes('Cough review'));
  assert.ok(flat.includes('patient-requested summary'));
  assert.ok(!flat.includes('undefined'), 'missing fields must not render as undefined');
});
