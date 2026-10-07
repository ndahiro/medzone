# MedZone - Enterprise Telemedicine & Clinical EHR Platform

MedZone is an enterprise-grade, HIPAA-compliant telemedicine platform and clinical workstation that enables patients to schedule virtual consultations with licensed medical professionals and allows clinicians to manage care, video visits, and electronic health records seamlessly.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions were aligned based on your specifications:

- **Confirmed Decision 1: Dual-Role Unified Workspace** — MedZone includes an instant role toggle between the **Patient Portal** (mobile-friendly booking, active medication schedule, symptom tracker, tele-visit room) and the **Clinician Workstation** (appointment triage, patient chart review, SOAP note generator, e-prescribing suite).
- **Confirmed Decision 2: FHIR R4 & HL7 Interoperability Engine** — Standardized export and import using Fast Healthcare Interoperability Resources (FHIR R4) JSON specifications (`Patient`, `Encounter`, `Observation`, `Condition`, `MedicationRequest`), compatible with Epic, Cerner, and major health networks, plus printable Continuity of Care summary reports.
- **Confirmed Decision 3: Clinical Video Suite with Live Vitals** — Secure consultation room featuring WebRTC camera feeds (with high-fidelity medical simulation fallback for sandbox environments), interactive vitals telemetry stream (ECG rhythm, SpO2, heart rate, blood pressure), real-time encrypted consultation chat, in-call clinical note drawer, and instant e-prescription dispatch.
- **Enterprise Security & Compliance** — Multi-Factor Authentication (MFA with TOTP token verification), client-side 256-bit AES-GCM end-to-end encryption for all PHI (Protected Health Information) via the Web Crypto API, role-based access control, and tamper-evident HIPAA audit logging.

---

## 1. Overview & Core Concept

### What It Does
MedZone unifies virtual care delivery, patient self-service, and clinical documentation into a unified, responsive web and mobile-optimized application:
- **Patients** can find certified physicians across specialties, book virtual visits, attend secure video consultations, track active medication regimens with adherence countdowns, receive automated push notifications and appointment reminders, and export portable medical summaries.
- **Clinicians** get a hospital-grade dashboard displaying daily appointment queues, quick patient summaries, one-click tele-visit launching, interactive diagnostic charts, real-time SOAP note drafting, and direct prescription transmission to pharmacies.

### Target Audience & Personas
1. **Patients**: Individuals seeking accessible, timely medical care from home with clear tracking of their medical history and medications.
2. **Medical Professionals (Doctors, Specialists, Nurse Practitioners)**: Clinicians requiring an intuitive, high-density workstation that minimizes charting burden while maintaining rigorous clinical documentation.
3. **Health System Administrators / Compliance Officers**: Healthcare leaders monitoring HIPAA compliance, audit trails, and data interoperability across enterprise systems.

---

## 2. User Experience & Visual Design

### Key User Flows

```
[Login & MFA Verification] ──> [Portal View Selection (Patient / Clinician)]
                                        │
        ┌───────────────────────────────┴───────────────────────────────┐
        ▼                                                               ▼
[Patient Portal]                                                [Clinician Workstation]
├── Upcoming Visits & 1-Click Join                              ├── Daily Queue & Patient Roster
├── Schedule New Specialist Consultation                        ├── Launch Virtual Tele-Visit
├── Active Prescriptions & Refill Tracker                       ├── Real-Time SOAP Notes & Vitals
├── Push Medication Reminder System                             ├── Issue Signed E-Prescription
└── Export Health Summary (FHIR R4 / PDF)                       └── FHIR EHR Inspection & Audit Log
        │                                                               │
        └───────────────► [Secure Video Consultation Suite] ◄───────────┘
                          ├── Encrypted Audio/Video Feeds
                          ├── Real-time Biometric Vitals Stream
                          ├── Live Clinical Notes & Findings
                          └── End-to-End Encrypted In-Call Chat
```

### Visual Identity & Theme
- **Design Philosophy**: Clinical rigor, calm reassurance, and information density tailored to healthcare professionals and anxious patients alike. Anti-slop discipline: unboxed metadata, zero pill sandwiches, authentic typographic hierarchy, and single-elevation card architecture.
- **Color Palette**:
  - Dominant Neutral Canvas (60%): Clean clinical `slate-50` (`#F8FAFC`) in light mode; deep navy-slate `slate-950` (`#090D16`) in dark mode.
  - Structural Surfaces (30%): Pure white `bg-white` and elevated `slate-900` containers with hairline borders (`border-slate-200/80` / `border-slate-800`).
  - Accent Color (10%): Medical Cyan / Deep Teal (`#0F766E` / `#0D9488`) for primary CTAs and active states, paired with verified healthcare signals (Forest Emerald `#16A34A` for stable vitals, Warm Amber `#D97706` for refills due, Crimson `#DC2626` for critical flags).
- **Typography**:
  - Display & Headings: `Plus Jakarta Sans` for crisp brand distinction and structural headers.
  - Body & Form Controls: `Plus Jakarta Sans` with balanced measure and high contrast.
  - Clinical Telemetry: `JetBrains Mono` / `tabular-nums` for heart rate, blood pressure, timestamps, dosage units, and FHIR identifiers.
- **Top Bar Contract**:
  - Zone 1 (Brand): "MedZone" wordmark with subtle security shield indicator.
  - Zone 2 (Navigation): `Appointments`, `EHR Records`, `Prescriptions`, `Tele-Visit`, `Compliance & Audit`.
  - Zone 3 (Actions): Portal Role Switcher (`Patient` ↔ `Clinician`), Push Notification Bell, MFA Authenticated badge, Profile menu.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Unified Reactive State with Role Switching
- *Chosen Approach*: Single reactive store supporting immediate toggle between Patient and Clinician perspectives.
- *Why*: Allows instantaneous demonstration of cross-platform workflows (e.g., booking an appointment as a patient, seeing it immediately populate the clinician's triage queue, launching the shared tele-visit, writing an e-prescription as the doctor, and having it instantly show up on the patient's medication tracker).
- *Alternatives Considered*: Rigid separate login walls requiring repeated credentials; passed over because it impairs workflow demonstration and user evaluation.

### Decision 2: Native Web Crypto AES-GCM (256-Bit) PHI Security
- *Chosen Approach*: Authenticated AES-GCM encryption using browser-native `crypto.subtle` with key derivation from session secrets. All PHI fields in notes, consultations, and chats store ciphertext alongside an encryption fingerprint.
- *Why*: Demonstrates verifiable end-to-end encryption without external dependencies, complete with an interactive "Cipher / Decryption Inspector" for HIPAA compliance auditing.

### Decision 3: Official FHIR R4 Interoperability Engine
- *Chosen Approach*: Support valid HL7 FHIR Release 4 bundle generation and parsing for `Patient`, `Encounter`, `Condition`, `Observation`, and `MedicationRequest`.
- *Why*: Enables real export/import capabilities that integrate seamlessly with hospital systems like Epic, Cerner, or AthenaHealth, fulfilling enterprise readiness requirements.

### Decision 4: Adaptive Consultation Room (WebRTC + Clinical Media Simulator)
- *Chosen Approach*: Dual-mode video stream: tries `navigator.mediaDevices.getUserMedia` for real webcam/microphone access; if permissions are denied or unavailable (e.g. running in sandboxed iframes), seamlessly engages a high-resolution interactive clinical consultation simulation with animated waveform telemetry.
- *Why*: Guarantees 100% operational reliability under any browser permission state while giving full camera access when supported.

---

## 4. Technical Architecture & Data Strategy

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MedZone Frontend Engine                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Top Bar (Brand · Strict Nav · Role Switcher · MFA Status · Notifications)  │
├──────────────────────────────────────┬──────────────────────────────────────┤
│            Patient View              │            Clinician View            │
│  ├── Appointment Scheduler           │  ├── Clinical Queue & Patient Roster │
│  ├── Regimen & Refill Tracker        │  ├── SOAP Notes & Diagnostic Chart   │
│  ├── Push Notification Reminders     │  ├── E-Prescription Signing Dispatch │
│  └── Medical Summary Export          │  └── Compliance & FHIR Interop Hub   │
├──────────────────────────────────────┴──────────────────────────────────────┤
│                    Secure Virtual Consultation Suite                        │
│  ├── Adaptive Video & Audio Stream (Local / Remote / Medical Fallback)      │
│  ├── Live Telemetry (ECG Waveform, Heart Rate, SpO2, BP, Respiratory)       │
│  ├── In-Call Clinical Scribing Drawer (Subjective, Objective, Assessment)   │
│  └── End-to-End Encrypted Consultation Chat Channel                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                       HIPAA Security & Platform Core                        │
│  ├── Web Crypto AES-GCM 256-bit Encryption / Decryption Service             │
│  ├── FHIR R4 & HL7 Interoperability Converter (Export / Import JSON)        │
│  ├── Browser Push & In-App Notification Dispatcher                          │
│  ├── Tamper-Evident HIPAA Audit Log System                                  │
│  └── Reactive LocalStorage Persistent Store with Live Sync Simulation       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Data Entities
- **PatientProfile**: ID, MRN (Medical Record Number), Name, DOB, Gender, Blood Type, Allergies, Chronic Conditions, Insurance Provider, Emergency Contact.
- **ProviderProfile**: ID, NPI (National Provider Identifier), Name, Title, Specialty, Credentials, Hospital Affiliation, Availability Slots.
- **Appointment**: ID, PatientID, ProviderID, DateTime, Type (Virtual Consultation, Follow-up, Routine Review), Status (Scheduled, In-Progress, Completed, Cancelled), ReasonForVisit, EncryptedSessionKey.
- **ConsultationSession**: ID, AppointmentID, StartTime, EndTime, VitalsStream, ClinicalNotes (SOAP format: Subjective, Objective, Assessment, Plan), DiagnosisCodes (ICD-10), E-PrescriptionsIssued.
- **Prescription**: ID, MedicationName, Dosage, Frequency, Route, Quantity, RefillsRemaining, PrescribingDoctor, Pharmacy, PrescribedDate, NextDoseTime, AdherenceRate.
- **EHRRecord (FHIR Bundle)**: Standard FHIR R4 resources (`Patient`, `Observation`, `Condition`, `MedicationRequest`, `Encounter`).
- **AuditLogEntry**: Timestamp, UserRole, Action (ViewedRecord, ExportedFHIR, EncryptedSessionInitiated, PrescribedMedication), IP/DeviceFingerprint, Status.

---

## 5. Implementation Sequence

1. **Enterprise Foundation & Security Core**:
   - Web Crypto 256-bit AES-GCM encryption/decryption utilities.
   - Comprehensive TypeScript data contracts for EHR, FHIR R4, prescriptions, and consultations.
   - Persistent mock database seeded with realistic medical records, providers, and schedules.
   - Multi-Factor Authentication state machine and HIPAA audit logging.
2. **Clinical Navigation & Top Bar**:
   - Strict 3-zone header with role toggle (Patient ↔ Clinician), notification tray, and MFA badge.
   - Dark/light responsive styling with Tailwind and shadcn-style component primitives.
3. **Patient Portal**:
   - Interactive appointment scheduler with specialty filtering and calendar slot selection.
   - Active prescription and regimen tracker with automated countdowns and refill request actions.
   - Push notification simulation system for medication reminders and appointment confirmations.
   - 1-click patient medical summary export (PDF/Printable view and raw FHIR JSON).
4. **Clinician Workstation**:
   - High-density daily appointment queue with triage urgency flags.
   - Patient electronic health records viewer with longitudinal lab trends and medication history.
   - E-prescription authoring modal with drug interaction checks and digital signature.
5. **Secure Virtual Consultation Suite**:
   - Video consultation interface with audio/video controls and dual streams.
   - Real-time biometric vitals monitor with canvas-rendered dynamic ECG rhythm.
   - In-call SOAP note drawer for real-time clinician charting.
   - Encrypted in-call chat with verifiable encryption badge.
6. **FHIR R4 & Interoperability Hub**:
   - Interactive export/import tool for FHIR R4 bundles and HL7 formatted messages.
   - Schema validator displaying raw JSON and visual resource breakdown.
