-- =============================================================================
-- MedZone - Telemedicine & Follow-ups Platform
-- MySQL 8 relational schema
--
-- This schema is the server-side system of record for the entities the React
-- client previously held in localStorage. Column names and ENUM members mirror
-- the TypeScript contracts in src/types/index.ts so the API can serialize rows
-- directly into those shapes.
--
-- Security note: chat messages are stored as AES-256-GCM ciphertext only
-- (cipher_text / iv_hex / salt_hex). Plaintext PHI is never persisted here.
-- User passwords are stored as bcrypt hashes only (password_hash column);
-- plaintext passwords are never persisted.
--
-- All statements are idempotent (CREATE TABLE IF NOT EXISTS) so this file can be
-- applied repeatedly without destroying existing records.
-- =============================================================================

-- RBAC user accounts (mirrors the elgon user-management pattern).
-- Declared before `patients`, so patient_id is indexed but carries no foreign
-- key here; migrate.js adds the constraint after both tables exist.
-- `modules` is a JSON array of MedZone sidebar module keys the user may open:
-- dashboard, followups, contacts, appointments, availability.
CREATE TABLE IF NOT EXISTS users (
  id             INT           NOT NULL AUTO_INCREMENT,
  username       VARCHAR(64)   NOT NULL,
  display_name   VARCHAR(128)  NOT NULL,
  -- Registration avatar as an image data URL (JPEG/PNG/WebP). MEDIUMTEXT holds
  -- the 512 KB upload cap after base64 expansion.
  avatar_url     MEDIUMTEXT    NULL,
  password_hash  VARCHAR(255)  NOT NULL,
  modules        JSON          NOT NULL,
  is_admin       TINYINT(1)    NOT NULL DEFAULT 0,
  role           ENUM('patient','clinician','admin') NOT NULL DEFAULT 'patient',
  -- Chart this account belongs to. Patient logins are bound to exactly one
  -- patient row so the API can scope every read to their own record; staff
  -- accounts leave it NULL and read the clinic. NULL for patient rows means
  -- "no chart linked" — such a session receives no chart data at all.
  patient_id     VARCHAR(64)   NULL,
  -- Provider this clinician practises as. A clinician bound to a provider reads
  -- only the visits booked with that provider (their own patients); a clinician
  -- left NULL is a covering/supervising account and keeps the clinic-wide read.
  -- Administrators always read the clinic. NULL for patients and admins.
  provider_id    VARCHAR(64)   NULL,
  -- Per-user TOTP secret (RFC 6238), encrypted at rest with the PHI key.
  -- Each account owns its own secret, so a code proves possession for that
  -- account only (the old deployment-wide secret proved nothing about which
  -- account was signing in). NULL = no authenticator enrolled.
  mfa_secret      TEXT         NULL,
  -- Set by the first successful verification. NULL while enrollment is still
  -- pending, which is how the API knows to ask for it again.
  mfa_enrolled_at DATETIME     NULL,
  -- Highest 30-second time step already accepted for this account. This is the
  -- single-use ledger: it lives in the shared row rather than in one process's
  -- memory, so a code cannot be replayed against another API worker.
  mfa_last_step   BIGINT       NULL,
  -- Session epoch. Included in every session token and compared against this
  -- row on each request; a password change/reset increments it so tokens
  -- minted before the change stop working instead of surviving for 12 hours.
  token_version  INT           NOT NULL DEFAULT 0,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_patient (patient_id),
  KEY idx_users_provider (provider_id),
  KEY idx_users_token_version (token_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Each user carries a clinical role driving which dashboard renders:
-- patient (PatientDashboard), clinician (ClinicianDashboard),
-- admin (AdminDashboard + full module grants).
-- Existing databases gain this column via server/migrate.js.

CREATE TABLE IF NOT EXISTS patients (
  id                           VARCHAR(64)  NOT NULL,
  mrn                          VARCHAR(32)  NOT NULL,
  name                         VARCHAR(255) NOT NULL,
  dob                          DATE         NOT NULL,
  age                          INT          NOT NULL,
  gender                       VARCHAR(32)  NOT NULL,
  blood_type                   VARCHAR(32)  NOT NULL,
  email                        VARCHAR(255) NOT NULL,
  phone                        VARCHAR(64)  NOT NULL,
  avatar_url                   VARCHAR(255) NOT NULL,
  address                      VARCHAR(512) NOT NULL,
  emergency_contact_name       VARCHAR(255) NOT NULL,
  emergency_contact_relation   VARCHAR(64)  NOT NULL,
  emergency_contact_phone      VARCHAR(64)  NOT NULL,
  insurance_provider           VARCHAR(255) NOT NULL,
  insurance_policy_number      VARCHAR(64)  NOT NULL,
  insurance_group_number       VARCHAR(64)  NOT NULL,
  created_at                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_patients_mrn (mrn)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- AllergyIntolerance (US Core): substance SNOMED CT concept.
CREATE TABLE IF NOT EXISTS allergies (
  id             VARCHAR(64)  NOT NULL,
  patient_id     VARCHAR(64)  NOT NULL,
  substance      VARCHAR(255) NOT NULL,
  reaction       VARCHAR(255) NOT NULL,
  severity       ENUM('mild','moderate','severe') NOT NULL,
  code_system    VARCHAR(255) NOT NULL,
  code           VARCHAR(64)  NOT NULL,
  code_display   VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_allergies_patient (patient_id),
  CONSTRAINT fk_allergies_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Condition (US Core): SNOMED CT concept plus ICD-10-CM crosswalk.
CREATE TABLE IF NOT EXISTS conditions (
  id               VARCHAR(64)  NOT NULL,
  patient_id       VARCHAR(64)  NOT NULL,
  name             VARCHAR(255) NOT NULL,
  icd10            VARCHAR(16)  NOT NULL,
  snomed_system    VARCHAR(255) NOT NULL,
  snomed_code      VARCHAR(64)  NOT NULL,
  snomed_display   VARCHAR(255) NOT NULL,
  diagnosed_date   DATE         NOT NULL,
  status           ENUM('active','managed','resolved') NOT NULL,
  PRIMARY KEY (id),
  KEY idx_conditions_patient (patient_id),
  CONSTRAINT fk_conditions_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Laboratory Observation (US Core): LOINC-coded.
CREATE TABLE IF NOT EXISTS lab_results (
  id               VARCHAR(64)  NOT NULL,
  patient_id       VARCHAR(64)  NOT NULL,
  test_name        VARCHAR(255) NOT NULL,
  category         ENUM('Metabolic','Lipid','Hematology','Endocrine') NOT NULL,
  loinc_system     VARCHAR(255) NOT NULL,
  loinc_code       VARCHAR(64)  NOT NULL,
  loinc_display    VARCHAR(255) NOT NULL,
  value            VARCHAR(64)  NOT NULL,
  unit             VARCHAR(64)  NOT NULL,
  reference_range  VARCHAR(64)  NOT NULL,
  result_date      DATE         NOT NULL,
  status           ENUM('normal','abnormal','critical') NOT NULL,
  PRIMARY KEY (id),
  KEY idx_labs_patient (patient_id),
  CONSTRAINT fk_labs_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vitals_readings (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patient_id        VARCHAR(64)  NOT NULL,
  heart_rate        INT          NOT NULL,
  systolic          INT          NOT NULL,
  diastolic         INT          NOT NULL,
  spo2              INT          NOT NULL,
  respiratory_rate  INT          NOT NULL,
  temperature       DECIMAL(5,2) NOT NULL,
  recorded_at       DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_vitals_patient_time (patient_id, recorded_at),
  CONSTRAINT fk_vitals_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Practitioner (US Core): NPI identifier.
CREATE TABLE IF NOT EXISTS providers (
  id                VARCHAR(64)   NOT NULL,
  npi               VARCHAR(16)   NOT NULL,
  name              VARCHAR(255)  NOT NULL,
  title             VARCHAR(128)  NOT NULL,
  specialty         VARCHAR(255)  NOT NULL,
  hospital          VARCHAR(255)  NOT NULL,
  rating            DECIMAL(3,2)  NOT NULL,
  reviews_count     INT           NOT NULL,
  avatar_url        VARCHAR(255)  NOT NULL,
  bio               TEXT          NOT NULL,
  consultation_fee  DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_providers_npi (npi)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS provider_availability (
  provider_id  VARCHAR(64) NOT NULL,
  slot         VARCHAR(16) NOT NULL,
  position     INT         NOT NULL,
  PRIMARY KEY (provider_id, slot),
  CONSTRAINT fk_availability_provider FOREIGN KEY (provider_id) REFERENCES providers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS appointments (
  id                       VARCHAR(64)  NOT NULL,
  patient_id               VARCHAR(64)  NOT NULL,
  provider_id              VARCHAR(64)  NOT NULL,
  patient_name             VARCHAR(255) NOT NULL,
  patient_mrn              VARCHAR(32)  NOT NULL,
  patient_age              INT          NOT NULL,
  patient_gender           VARCHAR(32)  NOT NULL,
  provider_name            VARCHAR(255) NOT NULL,
  provider_title           VARCHAR(128) NOT NULL,
  provider_specialty       VARCHAR(255) NOT NULL,
  provider_avatar          VARCHAR(255) NOT NULL,
  appointment_date         DATE         NOT NULL,
  appointment_time         VARCHAR(16)  NOT NULL,
  -- Instant stored UTC-normalized plus the originating offset so the API can
  -- re-emit a lossless ISO 8601 dateTime for FHIR Encounter.period.start.
  scheduled_start_utc      DATETIME     NOT NULL,
  scheduled_start_offset   SMALLINT     NOT NULL DEFAULT 0,
  type                     ENUM('Virtual Consultation','Follow-Up','Specialist Review','Prescription Refill') NOT NULL,
  status                   ENUM('scheduled','in-progress','completed','cancelled') NOT NULL,
  reason_for_visit         TEXT         NOT NULL,
  triage_priority          ENUM('routine','urgent','priority') NOT NULL,
  room_code                VARCHAR(64)  NOT NULL,
  notes_snippet            TEXT         NULL,
  encrypted_session_key    VARCHAR(255) NOT NULL,
  -- Shared waiting-room dispatch (HCW@Home "waiting rooms dispatched across
  -- several doctors"): any clinician may pick up a checked-in patient, which
  -- records who claimed the visit. The booked provider is preserved so the
  -- original appointment record stays intact.
  claimed_by_user_id       INT          NULL,
  claimed_by_name          VARCHAR(255) NULL,
  claimed_at               DATETIME     NULL,
  created_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_appointments_patient (patient_id),
  KEY idx_appointments_start (scheduled_start_utc),
  -- Concurrency indexes (50+ pairs): scoped schedule reads and the shared
  -- waiting-room scan (status + time) must not full-scan under burst load.
  KEY idx_appointments_patient_status (patient_id, status),
  KEY idx_appointments_provider_status (provider_id, status),
  KEY idx_appointments_status_start (status, scheduled_start_utc),
  CONSTRAINT fk_appointments_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE,
  CONSTRAINT fk_appointments_provider FOREIGN KEY (provider_id) REFERENCES providers (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- MedicationRequest (US Core): optional RxNorm concept; NULL when unresolved.
CREATE TABLE IF NOT EXISTS prescriptions (
  id                    VARCHAR(64)  NOT NULL,
  patient_id            VARCHAR(64)  NOT NULL,
  patient_name          VARCHAR(255) NOT NULL,
  medication_name       VARCHAR(255) NOT NULL,
  rxnorm_system         VARCHAR(255) NULL,
  rxnorm_code           VARCHAR(64)  NULL,
  rxnorm_display        VARCHAR(255) NULL,
  dosage                VARCHAR(64)  NOT NULL,
  route                 ENUM('Oral','Sublingual','Inhalation','Topical','Subcutaneous') NOT NULL,
  frequency             VARCHAR(255) NOT NULL,
  quantity              INT          NOT NULL,
  total_refills         INT          NOT NULL,
  remaining_refills     INT          NOT NULL,
  prescribing_doctor    VARCHAR(255) NOT NULL,
  prescribed_date       DATE         NOT NULL,
  pharmacy              VARCHAR(255) NOT NULL,
  instructions          TEXT         NOT NULL,
  status                ENUM('active','refill-requested','completed') NOT NULL,
  next_dose_minutes     INT          NOT NULL,
  -- Absolute instant the next dose is due. Written whenever next_dose_minutes
  -- is set, so the countdown is clock-driven and consistent across clients
  -- instead of a fabricated client-side ticker. NULL for rows written before
  -- this column existed; the API then falls back to the stored minutes.
  next_dose_at          DATETIME     NULL,
  adherence_percentage  INT          NOT NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prescriptions_patient (patient_id),
  CONSTRAINT fk_prescriptions_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS soap_notes (
  id             VARCHAR(64)  NOT NULL,
  appointment_id VARCHAR(64)  NULL,
  subjective     TEXT         NOT NULL,
  objective      TEXT         NOT NULL,
  assessment     TEXT         NOT NULL,
  plan           TEXT         NOT NULL,
  last_updated   VARCHAR(64)  NOT NULL,
  signed_by      VARCHAR(255) NULL,
  is_signed      TINYINT(1)   NOT NULL DEFAULT 0,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Encrypted consultation transcript. Only ciphertext is stored.
CREATE TABLE IF NOT EXISTS chat_messages (
  id             VARCHAR(64)  NOT NULL,
  appointment_id VARCHAR(64)  NOT NULL,
  sender_role    ENUM('patient','clinician') NOT NULL,
  sender_name    VARCHAR(255) NOT NULL,
  sent_at        VARCHAR(32)  NOT NULL,
  cipher_text    TEXT         NOT NULL,
  iv_hex         VARCHAR(64)  NOT NULL,
  salt_hex       VARCHAR(64)  NOT NULL,
  is_encrypted   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_messages_appointment (appointment_id),
  KEY idx_messages_created (created_at),
  -- Live-chat poll (50+ pairs): per-room transcript fetch + prune must seek by
  -- (visit, recency) instead of scanning the table.
  KEY idx_messages_appointment_created (appointment_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id           VARCHAR(64)  NOT NULL,
  logged_at    DATETIME     NOT NULL,
  user_role    ENUM('patient','clinician') NOT NULL,
  user_name    VARCHAR(255) NOT NULL,
  action       ENUM('VIEW_RECORD','EXPORT_FHIR','EXPORT_PDF','START_CONSULTATION','SIGN_SOAP_NOTE','ISSUE_PRESCRIPTION','REQUEST_REFILL','MFA_VERIFIED','REQUEST_CONSULTATION','CHECK_IN','CANCEL_VISIT','S2S_CONSENT','S2S_TURN') NOT NULL,
  details      TEXT         NOT NULL,
  target_mrn   VARCHAR(32)  NULL,
  ip_masked    VARCHAR(64)  NOT NULL,
  status       ENUM('VERIFIED_HIPAA','FLAGGED') NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_logged_at (logged_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
  id             VARCHAR(64)  NOT NULL,
  title          VARCHAR(255) NOT NULL,
  message        TEXT         NOT NULL,
  type           ENUM('medication','appointment','security','clinical') NOT NULL,
  created_at     DATETIME     NOT NULL,
  display_time   VARCHAR(64)  NOT NULL,
  read_flag      TINYINT(1)   NOT NULL DEFAULT 0,
  action_payload VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_notifications_read (read_flag),
  KEY idx_notifications_created (created_at),
  -- Bootstrap + ticker read (50+ pairs): time-ordered scan must stay indexed
  -- even as the table grows; read_flag stays a separate low-cardinality key.
  KEY idx_notifications_read_created (read_flag, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS follow_ups (
  id                   VARCHAR(64)  NOT NULL,
  patient_id           VARCHAR(64)  NULL,
  code                 VARCHAR(32)  NOT NULL,
  title                VARCHAR(255) NOT NULL,
  status               ENUM('Active','Closed','Pending') NOT NULL,
  created_date         VARCHAR(64)  NOT NULL,
  description          TEXT         NOT NULL,
  created_by_name      VARCHAR(255) NOT NULL,
  created_by_email     VARCHAR(255) NOT NULL,
  created_by_initials  VARCHAR(8)   NOT NULL,
  created_by_current   TINYINT(1)   NOT NULL DEFAULT 0,
  practitioner_name    VARCHAR(255) NOT NULL,
  practitioner_email   VARCHAR(255) NOT NULL,
  practitioner_initials VARCHAR(8)  NOT NULL,
  practitioner_current TINYINT(1)   NOT NULL DEFAULT 0,
  practitioner_group   VARCHAR(128) NOT NULL,
  patient_name         VARCHAR(255) NOT NULL,
  patient_email        VARCHAR(255) NOT NULL,
  patient_initials     VARCHAR(8)   NOT NULL,
  PRIMARY KEY (id),
  KEY idx_follow_ups_patient (patient_id),
  CONSTRAINT fk_follow_ups_patient FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consultant clinical notes: authored by a clinician per patient, downloaded
-- as PDF by the patient portal. title/body hold AES-256-GCM ciphertext
-- (encryptField/decryptField), matching the soap_notes PHI-at-rest rule.
CREATE TABLE IF NOT EXISTS consultant_notes (
  id           VARCHAR(64)  NOT NULL,
  patient_id   VARCHAR(64)  NOT NULL,
  patient_name VARCHAR(255) NOT NULL,
  patient_mrn  VARCHAR(32)  NOT NULL,
  author_name  VARCHAR(255) NOT NULL,
  author_role  ENUM('patient','clinician') NOT NULL DEFAULT 'clinician',
  title        TEXT         NOT NULL,
  body         TEXT         NOT NULL,
  created_at   VARCHAR(64)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_consultant_notes_patient (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Consultation requests (HCW@Home "consultation request form" parity): a
-- patient asks the care team for a visit; a clinician triages each request
-- (pending -> accepted, which schedules an appointment, or declined).
-- `details`/`contact` are plaintext administrative data, never PHI narrative.
CREATE TABLE IF NOT EXISTS consultation_requests (
  id             VARCHAR(64)  NOT NULL,
  patient_id     VARCHAR(64)  NOT NULL,
  patient_name   VARCHAR(255) NOT NULL,
  patient_mrn    VARCHAR(32)  NOT NULL,
  patient_age    INT          NOT NULL,
  patient_gender VARCHAR(32)  NOT NULL,
  topic          VARCHAR(255) NOT NULL,
  urgency        ENUM('routine','urgent') NOT NULL DEFAULT 'routine',
  preferred_date DATE         NOT NULL,
  details        TEXT         NOT NULL,
  contact        VARCHAR(255) NOT NULL,
  status         ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  created_at     VARCHAR(64)  NOT NULL,
  reviewed_by    VARCHAR(255) NULL,
  reviewed_at    VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  KEY idx_consultation_requests_status (status),
  KEY idx_consultation_requests_patient (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Specialist referrals (both directions): clinician refers the patient to a
-- specialty/provider, or the patient requests a specialty referral. One
-- shared triage inbox: pending -> accepted/declined, accepted -> completed.
-- `reason`/`notes` are administrative, never encrypted narrative.
CREATE TABLE IF NOT EXISTS referrals (
  id                        VARCHAR(64)  NOT NULL,
  patient_id                VARCHAR(64)  NOT NULL,
  patient_name              VARCHAR(255) NOT NULL,
  patient_mrn               VARCHAR(32)  NOT NULL,
  patient_age               INT          NOT NULL,
  patient_gender            VARCHAR(32)  NOT NULL,
  specialty                 VARCHAR(255) NOT NULL,
  referred_to_provider_id   VARCHAR(64)  NULL,
  referred_to_provider_name VARCHAR(255) NULL,
  reason                    TEXT         NOT NULL,
  priority                  ENUM('routine','urgent') NOT NULL DEFAULT 'routine',
  notes                     TEXT         NOT NULL,
  status                    ENUM('pending','accepted','declined','completed') NOT NULL DEFAULT 'pending',
  source                    ENUM('clinician','patient') NOT NULL DEFAULT 'clinician',
  created_by                VARCHAR(255) NOT NULL,
  created_at                VARCHAR(64)  NOT NULL,
  reviewed_by               VARCHAR(255) NULL,
  reviewed_at               VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  KEY idx_referrals_status (status),
  KEY idx_referrals_patient (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- WebRTC signaling relay for an open tele-visit room. Rows are short-lived
-- control-plane messages only (SDP offers/answers, ICE candidates, presence
-- heartbeats) — no media ever touches the server, and the table doubles as
-- the room's presence channel so participants can see whether the other side
-- is actually connected. Scoped to participants of the visit by the API.
CREATE TABLE IF NOT EXISTS room_signals (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  appointment_id VARCHAR(64)  NOT NULL,
  sender_id      INT          NOT NULL,
  sender_role    ENUM('patient','clinician') NOT NULL,
  sender_name    VARCHAR(255) NOT NULL,
  kind           ENUM('join','ping','offer','answer','candidate','bye') NOT NULL,
  payload        MEDIUMTEXT   NULL,
  created_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_room_signals_visit (appointment_id, id),
  -- Signaling poll (50+ pairs x 1.5s poll): cursor + presence reads must seek
  -- by (visit, id) and (visit, time) under concurrent heartbeats.
  KEY idx_room_signals_visit_created (appointment_id, created_at),
  KEY idx_room_signals_visit_kind_created (appointment_id, kind, created_at),
  CONSTRAINT fk_room_signals_visit FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Guest invitations for a live visit (family / next of kin, translator,
-- consulting specialist, observer). The roster is owned by the visit so both
-- participants see the same list; guests themselves join through the host.
CREATE TABLE IF NOT EXISTS visit_guests (
  id             VARCHAR(64)  NOT NULL,
  appointment_id VARCHAR(64)  NOT NULL,
  name           VARCHAR(128) NOT NULL,
  role           ENUM('Family','Translator','Specialist','Observer') NOT NULL,
  invited_by     VARCHAR(255) NOT NULL,
  created_at     DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_visit_guests_visit (appointment_id, created_at),
  CONSTRAINT fk_visit_guests_visit FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Patient invitation links (HCW@Home "invite patient in seconds by SMS, Email
-- or WhatsApp" parity). A clinician mints a single-click join token for one
-- visit; opening the link takes an already-authenticated participant straight
-- into that visit's lobby, with no navigation and nothing to install. The
-- token is opaque, single-purpose, expiring, and revocable — it never carries
-- chart data itself, only the visit it points at.
CREATE TABLE IF NOT EXISTS visit_invites (
  token          VARCHAR(64)  NOT NULL,
  appointment_id VARCHAR(64)  NOT NULL,
  channel        ENUM('link','sms','email','whatsapp') NOT NULL DEFAULT 'link',
  created_by     VARCHAR(255) NOT NULL,
  created_at     DATETIME     NOT NULL,
  expires_at     DATETIME     NOT NULL,
  revoked        TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (token),
  KEY idx_visit_invites_appointment (appointment_id),
  CONSTRAINT fk_visit_invites_visit FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- In-visit file & image exchange (HCW@Home "send attachment or image").
-- content and file_name are AES-256-GCM ciphertext at rest (encryptField),
-- matching the SOAP-note and consultant-note PHI rule; mime_type and size
-- stay plaintext because they carry no PHI and drive rendering.
CREATE TABLE IF NOT EXISTS visit_attachments (
  id             VARCHAR(64)  NOT NULL,
  appointment_id VARCHAR(64)  NOT NULL,
  sender_id      INT          NOT NULL,
  sender_role    ENUM('patient','clinician') NOT NULL,
  sender_name    VARCHAR(255) NOT NULL,
  file_name      TEXT         NOT NULL,
  mime_type      VARCHAR(128) NOT NULL,
  size_bytes     INT          NOT NULL,
  content        MEDIUMTEXT   NOT NULL,
  created_at     DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_visit_attachments_visit (appointment_id, created_at),
  CONSTRAINT fk_visit_attachments_visit FOREIGN KEY (appointment_id)
    REFERENCES appointments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
