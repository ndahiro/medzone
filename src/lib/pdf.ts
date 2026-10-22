/**
 * MedZone - dependency-free PDF writer.
 *
 * Emits minimal but spec-valid PDF 1.4 documents using the Helvetica
 * base-14 fonts so patients can download consultant notes (and other
 * clinical documents) as real .pdf files without adding a third-party
 * library. Layout is US Letter with word wrapping, pagination and a
 * footer; emitted bytes are WinAnsi (Latin-1) only.
 */
import type { Appointment, ConsultantNote, PatientProfile, Prescription } from '../types';

type PdfColorName = 'black' | 'teal' | 'gray';

interface PdfBlock {
  text: string;
  size?: number;
  bold?: boolean;
  color?: PdfColorName;
  /** Extra vertical space above this block, in points. */
  gapBefore?: number;
}

export interface PdfDocument {
  title: string;
  subtitle?: string[];
  blocks: PdfBlock[];
  footer?: string;
  /**
   * JPEG data URL rendered as a portrait in the top-right letterhead. Other
   * image formats are ignored (uploads are re-encoded to JPEG by the client).
   */
  avatarDataUrl?: string;
}

const PAGE_WIDTH = 612; // US Letter, in points
const PAGE_HEIGHT = 792;
const MARGIN_X = 56;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const FOOTER_RESERVE = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const AVG_CHAR_WIDTH = 0.55; // conservative Helvetica average glyph advance

const RGB: Record<PdfColorName, [number, number, number]> = {
  black: [0.09, 0.13, 0.19], // slate-900
  teal: [0.05, 0.46, 0.42], // teal-700
  gray: [0.42, 0.47, 0.53], // slate-500
};

const ENTITY_FALLBACKS: Record<string, string> = {
  '\u2014': ' - ',
  '\u2013': '-',
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2026': '...',
  '\u00a0': ' ',
  '\u2022': '-',
  '\u00b7': '-',
  '\u2265': '>=',
  '\u2264': '<=',
};

const fmt = (value: number) => value.toFixed(3);

/** Normalise text to printable WinAnsi characters, keeping paragraph breaks. */
function sanitize(text: string): string {
  let out = '';
  for (const ch of Array.from(text.normalize('NFC'))) {
    if (ch === '\n') {
      out += '\n';
      continue;
    }
    if (ch === '\r') continue;
    const code = ch.codePointAt(0) ?? 63;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
      continue;
    }
    if (code >= 0xa0 && code <= 0xff) {
      out += ch;
      continue;
    }
    const fallback = ENTITY_FALLBACKS[ch];
    if (fallback) {
      out += fallback;
      continue;
    }
    const ascii = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    out += /^[A-Za-z0-9 .,;:!?()[\]{}<>/\\*+\-=_%&#@$'"`~^|]*$/.test(ascii) ? ascii : '?';
  }
  return out;
}

function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapText(text: string, size: number): string[] {
  const maxChars = Math.max(8, Math.floor(CONTENT_WIDTH / (size * AVG_CHAR_WIDTH)));
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.trim().split(/\s+/);
    let current = '';
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (candidate.length <= maxChars) {
        current = candidate;
        continue;
      }
      if (current !== '') lines.push(current);
      if (word.length <= maxChars) {
        current = word;
        continue;
      }
      let rest = word;
      while (rest.length > maxChars) {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      current = rest;
    }
    if (current !== '') lines.push(current);
  }
  return lines;
}

interface DecodedJpeg {
  /** Binary string: one char per byte, written out with an 0xff mask. */
  data: string;
  width: number;
  height: number;
}

/**
 * Reads the SOF segment of a JPEG to recover its pixel dimensions. Only the
 * first frame header is needed; EXIF and scan data are irrelevant because the
 * original DCT bytes are embedded unchanged.
 */
function jpegSize(data: string): { width: number; height: number } | null {
  if (data.length < 4 || data.charCodeAt(0) !== 0xff || data.charCodeAt(1) !== 0xd8) {
    return null;
  }
  let offset = 2;
  while (offset + 1 < data.length) {
    if (data.charCodeAt(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = data.charCodeAt(offset + 1);
    offset += 2;
    // Fill bytes: advance to the actual marker code.
    while (marker === 0xff && offset < data.length) {
      marker = data.charCodeAt(offset);
      offset += 1;
    }
    // Standalone markers carry no length field.
    if (marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    // Start of scan: no frame header found before the entropy-coded data.
    if (marker === 0xda) return null;
    if (offset + 2 > data.length) return null;
    const length = (data.charCodeAt(offset) << 8) | data.charCodeAt(offset + 1);
    if (length < 2 || offset + length > data.length) return null;
    const isFrameHeader =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG extension
      marker !== 0xcc; // DAC
    if (isFrameHeader) {
      if (length < 7) return null;
      const height = (data.charCodeAt(offset + 3) << 8) | data.charCodeAt(offset + 4);
      const width = (data.charCodeAt(offset + 5) << 8) | data.charCodeAt(offset + 6);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

/** Decodes a base64 JPEG data URL, or null when it is not an embeddable JPEG. */
function decodeJpegAvatar(dataUrl: string | undefined): DecodedJpeg | null {
  if (!dataUrl) return null;
  const match = /^data:image\/jpe?g;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) return null;
  let data: string;
  try {
    data = atob(match[1]);
  } catch {
    return null;
  }
  const size = jpegSize(data);
  return size ? { data, ...size } : null;
}

interface PlacedImage {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PlacedLine {
  text: string;
  size: number;
  bold: boolean;
  color: PdfColorName;
  x: number;
  y: number;
}

interface PlacedRule {
  x: number;
  y: number;
  width: number;
}

interface PlacedPage {
  lines: PlacedLine[];
  rules: PlacedRule[];
}

function layout(doc: PdfDocument, topInset = 0): PlacedPage[] {
  const pages: PlacedPage[] = [{ lines: [], rules: [] }];
  const floorY = MARGIN_BOTTOM + FOOTER_RESERVE;
  // The first page may reserve a band for the portrait letterhead; later
  // pages start at the ordinary margin.
  let y = PAGE_HEIGHT - MARGIN_TOP - topInset;

  const current = () => pages[pages.length - 1];
  const breakPage = () => {
    pages.push({ lines: [], rules: [] });
    y = PAGE_HEIGHT - MARGIN_TOP;
  };
  const place = (text: string, size: number, bold: boolean, color: PdfColorName) => {
    const lineHeight = Math.round(size * 1.5);
    if (y - lineHeight < floorY) breakPage();
    y -= lineHeight;
    current().lines.push({ text, size, bold, color, x: MARGIN_X, y });
  };

  place(sanitize(doc.title), 17, true, 'teal');
  for (const line of doc.subtitle ?? []) place(sanitize(line), 9, false, 'gray');

  // Letterhead separator rule.
  if (y - 14 < floorY) breakPage();
  y -= 14;
  current().rules.push({ x: MARGIN_X, y, width: CONTENT_WIDTH });

  for (const block of doc.blocks) {
    const size = block.size ?? 10.5;
    if (block.gapBefore && y - block.gapBefore >= floorY) y -= block.gapBefore;
    for (const line of wrapText(sanitize(block.text), size)) {
      place(line === '' ? ' ' : line, size, block.bold ?? false, block.color ?? 'black');
    }
  }
  return pages;
}

function contentStreamFor(
  page: PlacedPage,
  footerLine: string | null,
  avatar: PlacedImage | null = null,
): string {
  const ops: string[] = [];
  if (avatar) {
    ops.push('q');
    ops.push(`${fmt(avatar.width)} 0 0 ${fmt(avatar.height)} ${fmt(avatar.x)} ${fmt(avatar.y)} cm`);
    ops.push('/Im1 Do');
    ops.push('Q');
  }
  for (const rule of page.rules) {
    const [r, g, b] = RGB.gray;
    ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    ops.push(`${rule.x} ${rule.y} ${rule.width} 0.8 re`);
    ops.push('f');
  }
  for (const line of page.lines) {
    const [r, g, b] = RGB[line.color];
    ops.push('BT');
    ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    ops.push(`${line.bold ? '/F2' : '/F1'} ${line.size.toFixed(1)} Tf`);
    ops.push(`1 0 0 1 ${line.x} ${line.y} Tm`);
    ops.push(`(${escapeText(line.text)}) Tj`);
    ops.push('ET');
  }
  if (footerLine) {
    const [r, g, b] = RGB.gray;
    ops.push('BT');
    ops.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    ops.push('/F1 8.0 Tf');
    ops.push(`1 0 0 1 ${MARGIN_X} 36 Tm`);
    ops.push(`(${escapeText(footerLine)}) Tj`);
    ops.push('ET');
  }
  return ops.join('\n');
}

export function buildPdf(doc: PdfDocument): Uint8Array<ArrayBuffer> {
  const baseFooter = doc.footer ? sanitize(doc.footer) : '';
  const avatar = decodeJpegAvatar(doc.avatarDataUrl);
  // Keep the portrait compact in the letterhead, preserving aspect ratio.
  const avatarScale = avatar
    ? Math.min(64 / avatar.width, 64 / avatar.height)
    : 1;
  const avatarRect: PlacedImage | null = avatar
    ? {
        x: PAGE_WIDTH - MARGIN_X - avatar.width * avatarScale,
        y: PAGE_HEIGHT - MARGIN_TOP - avatar.height * avatarScale,
        width: avatar.width * avatarScale,
        height: avatar.height * avatarScale,
      }
    : null;
  const pages = layout(doc, avatarRect ? avatarRect.height + 10 : 0);
  const pageCount = pages.length;
  const avatarObjectId = 5 + 2 * pageCount;

  const chunks: string[] = [];
  let byteLength = 0;
  const push = (text: string) => {
    chunks.push(text);
    byteLength += text.length;
  };

  push('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n');

  const offsets: number[] = [];
  const addObject = (id: number, body: string) => {
    offsets[id] = byteLength;
    push(`${id} 0 obj\n${body}\nendobj\n`);
  };

  addObject(1, '<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, index) => `${5 + 2 * index} 0 R`).join(' ');
  addObject(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  addObject(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  addObject(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  pages.forEach((page, index) => {
    const pageId = 5 + 2 * index;
    const contentId = 6 + 2 * index;
    let footerLine: string | null = null;
    if (baseFooter !== '') {
      const pageSuffix = pageCount > 1 ? `  -  Page ${index + 1} of ${pageCount}` : '';
      footerLine = `${baseFooter}${pageSuffix}`;
    }
    const showsAvatar = index === 0 && avatarRect !== null;
    const stream = contentStreamFor(page, footerLine, showsAvatar ? avatarRect : null);
    addObject(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const xobject = showsAvatar ? ` /XObject << /Im1 ${avatarObjectId} 0 R >>` : '';
    addObject(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobject} >> /Contents ${contentId} 0 R >>`,
    );
  });

  // The JPEG bytes are embedded verbatim as a DCTDecode image XObject.
  if (avatar) {
    addObject(
      avatarObjectId,
      `<< /Type /XObject /Subtype /Image /Width ${avatar.width} /Height ${avatar.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${avatar.data.length} >>\n` +
        `stream\n${avatar.data}\nendstream`,
    );
  }

  const objectCount = 2 * pageCount + 5 + (avatar ? 1 : 0); // ids 0..max
  const xrefOffset = byteLength;
  push(`xref\n0 ${objectCount}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id < objectCount; id += 1) {
    push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const bytes = new Uint8Array(byteLength);
  let position = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      bytes[position] = chunk.charCodeAt(i) & 0xff;
      position += 1;
    }
  }
  return bytes;
}

export function consultantNotePdfDocument(note: ConsultantNote): PdfDocument {
  return {
    title: 'Consultant Note',
    subtitle: [
      `Patient: ${note.patientName}  |  MRN: ${note.patientMrn}`,
      `Author: ${note.authorName} (${note.authorRole === 'clinician' ? 'Clinician' : 'Patient'})`,
      `Issued: ${new Date(note.createdAt).toLocaleString()}`,
    ],
    blocks: [
      { text: note.title, size: 13, bold: true, color: 'black', gapBefore: 6 },
      { text: note.body, size: 10.5, color: 'black', gapBefore: 8 },
    ],
    footer: `MedZone Telemedicine - HIPAA-compliant record - ${note.patientMrn}`,
  };
}

export interface PatientSummaryInput {
  patient: PatientProfile;
  prescriptions: Prescription[];
  appointments: Appointment[];
  generatedAt?: Date;
  /**
   * Avatar override. Registration stores the photo on the account rather than
   * the chart, so a patient session passes its account avatar here. Falls back
   * to `patient.avatarUrl` for chart-owned photos.
   */
  avatarUrl?: string;
}

/**
 * Patient-requested health summary: demographics, allergies, diagnoses,
 * current medications (with prescriber/pharmacy/refills), recent labs and
 * visits. This is the document behind the patient portal's PDF download, so
 * it is generated from exactly the chart the patient session was allowed to
 * read — never from a clinic-wide payload.
 */
export function patientSummaryPdfDocument({
  patient,
  prescriptions,
  appointments,
  generatedAt = new Date(),
  avatarUrl,
}: PatientSummaryInput): PdfDocument {
  const blocks: PdfBlock[] = [];
  const section = (heading: string, items: string[]) => {
    blocks.push({
      text: heading,
      size: 12,
      bold: true,
      color: 'teal',
      gapBefore: 12,
    });
    blocks.push({
      text: items.length > 0 ? items.join('\n') : 'None recorded.',
      size: 10,
      color: 'black',
      gapBefore: 4,
    });
  };

  section(
    'Allergies',
    patient.allergies.map((allergy) => `${allergy.substance} - ${allergy.reaction} (${allergy.severity})`)
  );

  section(
    'Diagnoses',
    patient.conditions.map(
      (condition) =>
        `${condition.name} (ICD-10 ${condition.icd10}) - ${condition.status}, diagnosed ${condition.diagnosedDate}`
    )
  );

  section(
    'Medications',
    prescriptions.flatMap((rx) => [
      `${rx.medicationName} ${rx.dosage} - ${rx.frequency} (${rx.route})`,
      `  Prescriber: ${rx.prescribingDoctor} | Pharmacy: ${rx.pharmacy} | Refills: ${rx.remainingRefills}/${rx.totalRefills} | Status: ${rx.status} | Started: ${rx.prescribedDate}`,
      `  Instructions: ${rx.instructions}`,
    ])
  );

  section(
    'Laboratory results',
    patient.recentLabs.map(
      (lab) =>
        `${lab.testName}: ${lab.value} ${lab.unit} (reference ${lab.referenceRange}) - ${lab.status}, ${lab.date}`
    )
  );

  section(
    'Visits',
    appointments.map(
      (visit) =>
        `${visit.date} ${visit.time} - ${visit.providerName} (${visit.providerSpecialty}) - ${visit.type} [${visit.status}] - ${visit.reasonForVisit}`
    )
  );

  blocks.push({
    text:
      'This summary is generated from your MedZone record for your own reference. ' +
      'It does not replace advice from a licensed clinician. Questions about a medication ' +
      'or result should go to your care team.',
    size: 9,
    color: 'gray',
    gapBefore: 14,
  });

  return {
    title: 'Patient Health Summary',
    subtitle: [
      `Patient: ${patient.name}  |  MRN: ${patient.mrn}`,
      `DOB: ${patient.dob} (${patient.age}y)  |  Gender: ${patient.gender}  |  Blood type: ${patient.bloodType}`,
      `Contact: ${patient.phone}  |  ${patient.email}`,
      `Insurance: ${patient.insurance.provider}  |  Policy: ${patient.insurance.policyNumber}  |  Group: ${patient.insurance.groupNumber}`,
      `Generated: ${generatedAt.toLocaleString()}`,
    ],
    blocks,
    avatarDataUrl: avatarUrl ?? patient.avatarUrl,
    footer: `MedZone Telemedicine - patient-requested summary - ${patient.mrn}`,
  };
}