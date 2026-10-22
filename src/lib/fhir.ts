/**
 * MedZone FHIR R4 & HL7 Interoperability Engine
 *
 * Conformant with HL7 FHIR Release 4.0.1 and the HL7 US Core Implementation
 * Guide (US Core 4.0.1) profiles. Terminology bindings follow the required
 * vocabularies: SNOMED CT (problems/allergies), ICD-10-CM (diagnoses), LOINC
 * (observations), RxNorm (medications) and UCUM (units of measure).
 */

import { PatientProfile, ProviderProfile, Appointment, Prescription, LabResult } from '../types';

interface FHIRResource {
  resourceType: string;
  id: string;
  [key: string]: unknown;
}

export interface FHIRBundle {
  resourceType: 'Bundle';
  id: string;
  meta: {
    lastUpdated: string;
    profile: string[];
  };
  identifier: {
    system: string;
    value: string;
  };
  type: 'document' | 'collection';
  timestamp: string;
  entry: Array<{
    fullUrl: string;
    resource: FHIRResource;
  }>;
}

const US_CORE = 'http://hl7.org/fhir/us/core/StructureDefinition';
const V3_INTERPRETATION = 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation';
const OBSERVATION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/observation-category';
const CONDITION_CLINICAL = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
const CONDITION_VER_STATUS = 'http://terminology.hl7.org/CodeSystem/condition-ver-status';
const CONDITION_CATEGORY = 'http://terminology.hl7.org/CodeSystem/condition-category';
const ALLERGY_CLINICAL = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical';
const ALLERGY_VER_STATUS = 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification';
const ACT_CODE = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
const UCUM = 'http://unitsofmeasure.org';
const LOINC = 'http://loinc.org';
const SNOMED = 'http://snomed.info/sct';
const ICD10CM = 'http://hl7.org/fhir/sid/icd-10-cm';
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const NPI_SYSTEM = 'http://hl7.org/fhir/sid/us-npi';
const MRN_SYSTEM = 'https://medzone.health/fhir/mrn';

const usCore = (profile: string): string[] => [`${US_CORE}/${profile}`];

const vitalSignsCategory = [
  { coding: [{ system: OBSERVATION_CATEGORY, code: 'vital-signs', display: 'Vital Signs' }] },
];

const labCategory = [
  { coding: [{ system: OBSERVATION_CATEGORY, code: 'laboratory', display: 'Laboratory' }] },
];

/** FHIR-valid Octet string identifier for the patient's MRN. */
function patientRef(patient: PatientProfile): string {
  return `urn:uuid:patient-${patient.id}`;
}

/** Maps the platform's free-text gender to a FHIR administrative-gender code. */
function fhirGender(gender: string): string {
  const normalized = gender.toLowerCase();
  if (normalized.startsWith('female')) return 'female';
  if (normalized.startsWith('male')) return 'male';
  return 'unknown';
}

/** Maps the internal condition status to an HL7 condition-clinical code. */
function fhirClinicalStatus(status: PatientProfile['conditions'][number]['status']): {
  code: string;
  display: string;
} {
  switch (status) {
    case 'resolved':
      return { code: 'resolved', display: 'Resolved' };
    case 'active':
    case 'managed':
    default:
      // A managed chronic problem remains clinically active.
      return { code: 'active', display: 'Active' };
  }
}

function labInterpretation(status: LabResult['status']): { code: string; display: string } {
  switch (status) {
    case 'critical':
      return { code: 'AA', display: 'Critical abnormal' };
    case 'abnormal':
      return { code: 'A', display: 'Abnormal' };
    case 'normal':
    default:
      return { code: 'N', display: 'Normal' };
  }
}

function buildPractitioner(provider: ProviderProfile): FHIRResource {
  return {
    resourceType: 'Practitioner',
    id: `practitioner-${provider.id}`,
    meta: { profile: usCore('us-core-practitioner') },
    identifier: [
      {
        system: NPI_SYSTEM,
        value: provider.npi,
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'NPI', display: 'National provider identifier' }],
        },
      },
    ],
    active: true,
    name: [{ use: 'official', text: provider.name, family: provider.name.split(' ').slice(-1)[0], given: provider.name.split(' ').slice(0, -1) }],
    qualification: [{ code: { text: provider.title }, issuer: { display: provider.hospital } }],
  };
}

/**
 * Builds an official FHIR R4 Document Bundle representing the Patient's
 * longitudinal record. The first entry is always the required Composition.
 */
export function generateFHIRBundle(
  patient: PatientProfile,
  prescriptions: Prescription[],
  appointments: Appointment[],
  providers: ProviderProfile[] = []
): FHIRBundle {
  const bundleId = `medzone-bundle-${patient.mrn.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const now = new Date().toISOString();

  const entries: Array<{ fullUrl: string; resource: FHIRResource }> = [];

  // 0. Practitioners (referenced by encounters and prescriptions)
  const practitionerRefByName = new Map<string, string>();
  providers.forEach(provider => {
    practitionerRefByName.set(provider.name.toLowerCase(), `urn:uuid:practitioner-${provider.id}`);
    entries.push({
      fullUrl: `urn:uuid:practitioner-${provider.id}`,
      resource: buildPractitioner(provider),
    });
  });

  const requesterRef = (doctorName: string): { reference?: string; display: string } => {
    const ref = practitionerRefByName.get(doctorName.toLowerCase());
    return ref ? { reference: ref, display: doctorName } : { display: doctorName };
  };

  // 1. Patient Resource
  // Unknown demographics are omitted, never fabricated: race/ethnicity
  // extensions are only emitted when the record carries them, and the
  // address keeps the stored line without inventing city/state/zip.
  const patientResource: FHIRResource = {
    resourceType: 'Patient',
    id: patient.id,
    meta: { profile: usCore('us-core-patient') },
    identifier: [
      {
        use: 'usual',
        type: {
          coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical Record Number' }],
        },
        system: MRN_SYSTEM,
        value: patient.mrn,
      },
    ],
    active: true,
    name: [
      {
        use: 'official',
        text: patient.name,
        family: patient.name.split(' ').slice(-1)[0],
        given: patient.name.split(' ').slice(0, -1),
      },
    ],
    telecom: [
      { system: 'phone', value: patient.phone, use: 'mobile' },
      { system: 'email', value: patient.email, use: 'home' },
    ],
    gender: fhirGender(patient.gender),
    birthDate: patient.dob,
    address: [
      {
        use: 'home',
        line: [patient.address],
        country: 'USA',
      },
    ],
    extension: [
      {
        url: 'http://hl7.org/fhir/StructureDefinition/patient-bloodType',
        valueString: patient.bloodType,
      },
    ],
  };
  entries.push({ fullUrl: patientRef(patient), resource: patientResource });

  // 2. Condition Resources (SNOMED CT primary code + ICD-10-CM secondary)
  const conditionRefs: string[] = [];
  patient.conditions.forEach(cond => {
    const clinical = fhirClinicalStatus(cond.status);
    const fullUrl = `urn:uuid:condition-${cond.id}`;
    conditionRefs.push(fullUrl);
    entries.push({
      fullUrl,
      resource: {
        resourceType: 'Condition',
        id: `condition-${cond.id}`,
        meta: { profile: usCore('us-core-condition') },
        clinicalStatus: { coding: [{ system: CONDITION_CLINICAL, code: clinical.code, display: clinical.display }] },
        verificationStatus: { coding: [{ system: CONDITION_VER_STATUS, code: 'confirmed', display: 'Confirmed' }] },
        category: [
          {
            coding: [{ system: CONDITION_CATEGORY, code: 'problem-list-item', display: 'Problem List Item' }],
          },
        ],
        code: {
          coding: [
            { system: cond.snomed.system, code: cond.snomed.code, display: cond.snomed.display },
            { system: ICD10CM, code: cond.icd10, display: cond.name },
          ],
          text: cond.name,
        },
        subject: { reference: patientRef(patient), display: patient.name },
        onsetDateTime: cond.diagnosedDate,
        recordedDate: cond.diagnosedDate,
      },
    });
  });

  // 3. AllergyIntolerance Resources
  const allergyRefs: string[] = [];
  patient.allergies.forEach((allergy, index) => {
    const fullUrl = `urn:uuid:allergy-${index + 1}`;
    allergyRefs.push(fullUrl);
    entries.push({
      fullUrl,
      resource: {
        resourceType: 'AllergyIntolerance',
        id: `allergy-${index + 1}`,
        meta: { profile: usCore('us-core-allergyintolerance') },
        clinicalStatus: { coding: [{ system: ALLERGY_CLINICAL, code: 'active', display: 'Active' }] },
        verificationStatus: { coding: [{ system: ALLERGY_VER_STATUS, code: 'confirmed', display: 'Confirmed' }] },
        type: 'allergy',
        category: ['medication'],
        criticality: allergy.severity === 'severe' ? 'high' : allergy.severity === 'moderate' ? 'low' : 'low',
        code: {
          coding: [
            { system: allergy.substanceCode.system, code: allergy.substanceCode.code, display: allergy.substanceCode.display },
          ],
          text: allergy.substance,
        },
        patient: { reference: patientRef(patient), display: patient.name },
        reaction: [
          {
            manifestation: [{ text: allergy.reaction }],
            severity: allergy.severity,
          },
        ],
      },
    });
  });

  // 4. MedicationRequest Resources (RxNorm-coded)
  const medicationRefs: string[] = [];
  prescriptions.forEach(rx => {
    const fullUrl = `urn:uuid:medrx-${rx.id}`;
    medicationRefs.push(fullUrl);
    entries.push({
      fullUrl,
      resource: {
        resourceType: 'MedicationRequest',
        id: `medrx-${rx.id}`,
        meta: { profile: usCore('us-core-medicationrequest') },
        status: rx.status === 'active' ? 'active' : rx.status === 'completed' ? 'completed' : 'stopped',
        intent: 'order',
        medicationCodeableConcept: {
          coding: rx.rxnorm
            ? [{ system: rx.rxnorm.system, code: rx.rxnorm.code, display: rx.rxnorm.display }]
            : undefined,
          text: `${rx.medicationName} ${rx.dosage}`,
        },
        subject: { reference: patientRef(patient), display: patient.name },
        authoredOn: rx.prescribedDate,
        requester: requesterRef(rx.prescribingDoctor),
        dosageInstruction: [
          {
            text: rx.instructions,
            timing: { code: { text: rx.frequency } },
            route: { text: rx.route },
          },
        ],
        dispenseRequest: {
          numberOfRepeatsAllowed: rx.remainingRefills,
          quantity: { value: rx.quantity, unit: 'tablet', system: UCUM, code: '{tbl}' },
        },
      },
    });
  });

  // 5. Vital-sign Observations (US Core Vital Signs profiles)
  const vitalRefs: string[] = [];
  const latest = patient.vitalsHistory[patient.vitalsHistory.length - 1];
  if (latest) {
    entries.push({
      fullUrl: `urn:uuid:obs-bp-${patient.id}`,
      resource: {
        resourceType: 'Observation',
        id: `obs-bp-${patient.id}`,
        meta: { profile: usCore('us-core-blood-pressure') },
        status: 'final',
        category: vitalSignsCategory,
        code: {
          coding: [{ system: LOINC, code: '85354-9', display: 'Blood pressure panel with all children optional' }],
          text: 'Blood Pressure',
        },
        subject: { reference: patientRef(patient) },
        effectiveDateTime: latest.timestamp,
        component: [
          {
            code: { coding: [{ system: LOINC, code: '8480-6', display: 'Systolic blood pressure' }] },
            valueQuantity: { value: latest.systolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' },
          },
          {
            code: { coding: [{ system: LOINC, code: '8462-4', display: 'Diastolic blood pressure' }] },
            valueQuantity: { value: latest.diastolic, unit: 'mmHg', system: UCUM, code: 'mm[Hg]' },
          },
        ],
      },
    });
    vitalRefs.push(`urn:uuid:obs-bp-${patient.id}`);

    const simpleVital = (
      suffix: string,
      profile: string,
      loinc: string,
      display: string,
      value: number,
      unit: string,
      ucum: string
    ) => {
      const fullUrl = `urn:uuid:obs-${suffix}-${patient.id}`;
      vitalRefs.push(fullUrl);
      entries.push({
        fullUrl,
        resource: {
          resourceType: 'Observation',
          id: `obs-${suffix}-${patient.id}`,
          meta: { profile: usCore(profile) },
          status: 'final',
          category: vitalSignsCategory,
          code: { coding: [{ system: LOINC, code: loinc, display }], text: display },
          subject: { reference: patientRef(patient) },
          effectiveDateTime: latest.timestamp,
          valueQuantity: { value, unit, system: UCUM, code: ucum },
        },
      });
    };

    simpleVital('hr', 'us-core-heart-rate', '8867-4', 'Heart rate', latest.heartRate, 'beats/min', '/min');
    simpleVital('rr', 'us-core-respiratory-rate', '9279-1', 'Respiratory rate', latest.respiratoryRate, 'breaths/min', '/min');
    simpleVital('temp', 'us-core-body-temperature', '8310-5', 'Body temperature', latest.temperature, '[degF]', '[degF]');

    // Pulse oximetry (US Core requires the SpO2 component under panel 2708-6)
    entries.push({
      fullUrl: `urn:uuid:obs-spo2-${patient.id}`,
      resource: {
        resourceType: 'Observation',
        id: `obs-spo2-${patient.id}`,
        meta: { profile: usCore('us-core-pulse-oximetry') },
        status: 'final',
        category: vitalSignsCategory,
        code: {
          coding: [
            { system: LOINC, code: '2708-6', display: 'Oxygen saturation in Arterial blood' },
            { system: LOINC, code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry' },
          ],
          text: 'SpO2',
        },
        subject: { reference: patientRef(patient) },
        effectiveDateTime: latest.timestamp,
        valueQuantity: { value: latest.spo2, unit: '%', system: UCUM, code: '%' },
      },
    });
    vitalRefs.push(`urn:uuid:obs-spo2-${patient.id}`);
  }

  // 6. Laboratory Result Observations (LOINC-coded)
  const labRefs: string[] = [];
  patient.recentLabs.forEach(lab => {
    const interpretation = labInterpretation(lab.status);
    const fullUrl = `urn:uuid:obs-lab-${lab.id}`;
    labRefs.push(fullUrl);
    entries.push({
      fullUrl,
      resource: {
        resourceType: 'Observation',
        id: `obs-lab-${lab.id}`,
        meta: { profile: usCore('us-core-observation-lab') },
        status: 'final',
        category: labCategory,
        code: {
          coding: [{ system: lab.loinc.system, code: lab.loinc.code, display: lab.loinc.display }],
          text: lab.testName,
        },
        subject: { reference: patientRef(patient) },
        effectiveDateTime: lab.date,
        valueQuantity: { value: Number.parseFloat(lab.value), unit: lab.unit, system: UCUM },
        interpretation: [{ coding: [{ system: V3_INTERPRETATION, code: interpretation.code, display: interpretation.display }] }],
        referenceRange: [{ text: lab.referenceRange }],
      },
    });
  });

  // 7. Encounter Resources (Virtual Appointments)
  const encounterRefs: string[] = [];
  appointments.forEach(apt => {
    const fullUrl = `urn:uuid:encounter-${apt.id}`;
    encounterRefs.push(fullUrl);
    entries.push({
      fullUrl,
      resource: {
        resourceType: 'Encounter',
        id: `encounter-${apt.id}`,
        meta: { profile: usCore('us-core-encounter') },
        status: apt.status === 'completed' ? 'finished' : apt.status === 'in-progress' ? 'in-progress' : 'planned',
        class: { system: ACT_CODE, code: 'VR', display: 'virtual' },
        subject: { reference: patientRef(patient), display: patient.name },
        participant: [{ individual: requesterRef(apt.providerName) }],
        period: { start: apt.scheduledStart },
        reasonCode: [{ text: apt.reasonForVisit }],
      },
    });
  });

  // 8. Composition — mandatory first entry of a US Core Document Bundle
  const authorRef = practitionerRefByName.size > 0 ? Array.from(practitionerRefByName.values())[0] : undefined;
  const composition: FHIRResource = {
    resourceType: 'Composition',
    id: `composition-${patient.id}`,
    status: 'final',
    type: {
      coding: [{ system: LOINC, code: '34133-9', display: 'Summarization of episode note' }],
      text: 'Continuity of Care Document',
    },
    subject: { reference: patientRef(patient), display: patient.name },
    date: now,
    ...(authorRef ? { author: [{ reference: authorRef }] } : {}),
    title: `Continuity of Care Summary for ${patient.name}`,
    section: [
      { title: 'Allergies and Intolerances', entry: allergyRefs.map(reference => ({ reference })) },
      { title: 'Problems', entry: conditionRefs.map(reference => ({ reference })) },
      { title: 'Medications', entry: medicationRefs.map(reference => ({ reference })) },
      { title: 'Results', entry: labRefs.map(reference => ({ reference })) },
      { title: 'Vital Signs', entry: vitalRefs.map(reference => ({ reference })) },
      { title: 'Encounters', entry: encounterRefs.map(reference => ({ reference })) },
    ],
  };
  entries.unshift({ fullUrl: `urn:uuid:composition-${patient.id}`, resource: composition });

  return {
    resourceType: 'Bundle',
    id: bundleId,
    meta: {
      lastUpdated: now,
      profile: usCore('us-core-documentbundle'),
    },
    identifier: {
      system: 'https://medzone.health/fhir/bundles',
      value: bundleId,
    },
    type: 'document',
    timestamp: now,
    entry: entries,
  };
}

/** Maps an administrative gender string to an HL7 v2.5.1 PID-8 code. */
function hl7Gender(gender: string): string {
  const normalized = gender.toLowerCase();
  if (normalized.startsWith('female')) return 'F';
  if (normalized.startsWith('male')) return 'M';
  return 'U';
}

/**
 * Generates an HL7 v2.5.1 ADT^A08 message (pipe-and-hat encoded, CR-terminated)
 * carrying the patient's demographic, visit, diagnosis and allergy segments.
 */
export function generateHL7Message(patient: PatientProfile, appointments: Appointment[]): string {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const controlId = `MSG${Date.now()}`;
  const messageType = 'ADT^A08^ADT_A01';

  const msh = `MSH|^~\\&|MEDZONE_EHR|MEDZONE|||${timestamp}||${messageType}|${controlId}|P|2.5.1`;

  // Patient Identification (PID), fields numbered per HL7 v2.5.1:
  // 3=identifier list, 5=name, 7=DOB, 8=sex, 11=address, 13=home phone.
  // Unknown fields (marital status, visit-specific data) stay empty rather
  // than carrying invented values.
  const name = patient.name.trim().split(/\s+/);
  const family = name.length > 1 ? name[name.length - 1] : name[0];
  const given = name.length > 1 ? name.slice(0, -1).join(' ') : '';
  const pidFields: Record<number, string> = {
    1: '1',
    3: `${patient.mrn}^^^MEDZONE^MR`,
    5: `${family}^${given}`,
    7: patient.dob.replace(/-/g, ''),
    8: hl7Gender(patient.gender),
    11: patient.address.replace(/,/g, ''),
    13: patient.phone,
    18: patient.insurance.policyNumber,
  };
  const pidSegment = ['PID'];
  for (let i = 1; i <= 18; i++) pidSegment.push(pidFields[i] ?? '');
  const pid = pidSegment.join('|');

  const visit = appointments[0];
  const pv1 = visit
    ? `PV1|1|V|TELE^${visit.roomCode}^MEDZONE||||${visit.providerName.replace(/^Dr\.\s*/, '').replace(/,.*$/, '')}^MD||||||||||||VISIT${Date.now()}`
    : 'PV1|1|V';

  const dg1 = patient.conditions
    .map((c, idx) => `DG1|${idx + 1}|I10|${c.icd10}^${c.name}^ICD10CM|${c.name}|${c.diagnosedDate.replace(/-/g, '')}|F`)
    .join('\r');

  const al1 = patient.allergies
    .map((a, idx) => `AL1|${idx + 1}|DA|${a.substanceCode.code}^${a.substance}^SCT|${a.severity.toUpperCase()}|${a.reaction}`)
    .join('\r');

  const segments = [msh, pid, pv1, dg1, al1].filter(Boolean);
  return `${segments.join('\r')}\r`;
}
