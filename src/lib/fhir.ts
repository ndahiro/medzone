/**
 * MedZone FHIR R4 & HL7 Interoperability Engine
 * Compliant with HL7 Fast Healthcare Interoperability Resources (FHIR) Release 4.0.1
 */

import { PatientProfile, Appointment, Prescription } from '../types';

export interface FHIRResource {
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

/**
 * Builds an official FHIR R4 Document Bundle representing the Patient's Longitudinal Record
 */
export function generateFHIRBundle(
  patient: PatientProfile,
  prescriptions: Prescription[],
  appointments: Appointment[]
): FHIRBundle {
  const bundleId = `medzone-bundle-${patient.mrn.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const now = new Date().toISOString();

  const entries: Array<{ fullUrl: string; resource: FHIRResource }> = [];

  // 1. Patient Resource
  const patientResource: FHIRResource = {
    resourceType: 'Patient',
    id: patient.id,
    identifier: [
      {
        use: 'usual',
        type: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
              code: 'MR',
              display: 'Medical Record Number',
            },
          ],
        },
        system: 'urn:oid:2.16.840.1.113883.4.1',
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
    gender: patient.gender.toLowerCase() === 'female' ? 'female' : 'male',
    birthDate: patient.dob,
    address: [
      {
        use: 'home',
        line: [patient.address],
        city: 'Metropolis',
        state: 'CA',
        postalCode: '90210',
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

  entries.push({
    fullUrl: `urn:uuid:patient-${patient.id}`,
    resource: patientResource,
  });

  // 2. Condition Resources (Problems & Diagnoses)
  patient.conditions.forEach(cond => {
    const conditionResource: FHIRResource = {
      resourceType: 'Condition',
      id: `condition-${cond.id}`,
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: cond.status === 'active' ? 'active' : 'resolved',
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
          },
        ],
      },
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-category',
              code: 'problem-list-item',
              display: 'Problem List Item',
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: 'http://hl7.org/fhir/sid/icd-10-cm',
            code: cond.icd10,
            display: cond.name,
          },
        ],
        text: cond.name,
      },
      subject: {
        reference: `urn:uuid:patient-${patient.id}`,
        display: patient.name,
      },
      recordedDate: cond.diagnosedDate,
    };

    entries.push({
      fullUrl: `urn:uuid:condition-${cond.id}`,
      resource: conditionResource,
    });
  });

  // 3. MedicationRequest Resources
  prescriptions.forEach(rx => {
    const medResource: FHIRResource = {
      resourceType: 'MedicationRequest',
      id: `medrx-${rx.id}`,
      status: rx.status === 'active' ? 'active' : 'completed',
      intent: 'order',
      medicationCodeableConcept: {
        coding: [
          {
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            display: rx.medicationName,
          },
        ],
        text: `${rx.medicationName} ${rx.dosage}`,
      },
      subject: {
        reference: `urn:uuid:patient-${patient.id}`,
        display: patient.name,
      },
      authoredOn: rx.prescribedDate,
      requester: {
        display: rx.prescribingDoctor,
      },
      dosageInstruction: [
        {
          text: rx.instructions,
          timing: {
            code: {
              text: rx.frequency,
            },
          },
          route: {
            text: rx.route,
          },
        },
      ],
      dispenseRequest: {
        numberOfRepeatsAllowed: rx.remainingRefills,
        quantity: {
          value: rx.quantity,
          unit: 'tablets',
        },
      },
    };

    entries.push({
      fullUrl: `urn:uuid:medrx-${rx.id}`,
      resource: medResource,
    });
  });

  // 4. Observation Resources (Vitals)
  const latestVitals = patient.vitalsHistory[patient.vitalsHistory.length - 1];
  if (latestVitals) {
    // Blood Pressure Observation
    entries.push({
      fullUrl: `urn:uuid:obs-bp-${patient.id}`,
      resource: {
        resourceType: 'Observation',
        id: `obs-bp-${patient.id}`,
        status: 'final',
        category: [
          {
            coding: [
              {
                system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                code: 'vital-signs',
                display: 'Vital Signs',
              },
            ],
          },
        ],
        code: {
          coding: [
            {
              system: 'http://loinc.org',
              code: '85354-9',
              display: 'Blood pressure panel with all children optional',
            },
          ],
          text: 'Blood Pressure',
        },
        subject: { reference: `urn:uuid:patient-${patient.id}` },
        effectiveDateTime: latestVitals.timestamp,
        component: [
          {
            code: {
              coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }],
            },
            valueQuantity: { value: latestVitals.systolic, unit: 'mmHg', system: 'http://unitsofmeasure.org' },
          },
          {
            code: {
              coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }],
            },
            valueQuantity: { value: latestVitals.diastolic, unit: 'mmHg', system: 'http://unitsofmeasure.org' },
          },
        ],
      },
    });

    // Heart Rate Observation
    entries.push({
      fullUrl: `urn:uuid:obs-hr-${patient.id}`,
      resource: {
        resourceType: 'Observation',
        id: `obs-hr-${patient.id}`,
        status: 'final',
        code: {
          coding: [{ system: 'http://loinc.org', code: '8867-4', display: 'Heart rate' }],
          text: 'Heart Rate',
        },
        subject: { reference: `urn:uuid:patient-${patient.id}` },
        effectiveDateTime: latestVitals.timestamp,
        valueQuantity: { value: latestVitals.heartRate, unit: 'beats/minute', system: 'http://unitsofmeasure.org' },
      },
    });
  }

  // 5. Encounter Resources (Virtual Appointments)
  appointments.forEach(apt => {
    entries.push({
      fullUrl: `urn:uuid:encounter-${apt.id}`,
      resource: {
        resourceType: 'Encounter',
        id: `encounter-${apt.id}`,
        status: apt.status === 'completed' ? 'finished' : apt.status === 'in-progress' ? 'in-progress' : 'planned',
        class: {
          system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
          code: 'VR',
          display: 'virtual',
        },
        subject: { reference: `urn:uuid:patient-${patient.id}`, display: patient.name },
        participant: [
          {
            individual: { display: apt.providerName },
          },
        ],
        period: {
          start: `${apt.date}T${apt.time}`,
        },
        reasonCode: [
          {
            text: apt.reasonForVisit,
          },
        ],
      },
    });
  });

  return {
    resourceType: 'Bundle',
    id: bundleId,
    meta: {
      lastUpdated: now,
      profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-documentbundle'],
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

/**
 * Generates an HL7 v2.5.1 Continuity of Care Document Message
 */
export function generateHL7Message(patient: PatientProfile, appointments: Appointment[]): string {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const msh = `MSH|^~\\&|MEDZONE_EHR|MEDZONE_HOSPITAL|EPIC_SYSTEM|ENTERPRISE_NETWORK|${timestamp}||ADT^A08|MSG${Date.now()}|P|2.5.1`;
  const pid = `PID|1||${patient.mrn}^^^MEDZONE^MR||${patient.name.split(' ').reverse().join('^')}||${patient.dob.replace(/-/g, '')}|${patient.gender[0]}|||${patient.address}^^Metropolis^CA^90210^USA||${patient.phone}|||M||${patient.insurance.policyNumber}`;
  const pv1 = `PV1|1|V|TELE^ROOM101^MEDZONE||||${appointments[0]?.providerName.replace('Dr. ', '')}^MD||||||||||||VISIT${Date.now()}`;
  const dg1 = patient.conditions
    .map((c, idx) => `DG1|${idx + 1}|I10|${c.icd10}^${c.name}^I10|${c.name}|${c.diagnosedDate.replace(/-/g, '')}|A`)
    .join('\n');
  const al1 = patient.allergies
    .map((a, idx) => `AL1|${idx + 1}|DA|${a.substance}|${a.severity.toUpperCase()}|${a.reaction}`)
    .join('\n');

  return [msh, pid, pv1, dg1, al1].filter(Boolean).join('\n');
}
