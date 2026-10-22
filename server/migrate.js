/**
 * Applies server/schema.sql to the configured MySQL database.
 *
 *   npm run db:migrate
 *
 * Idempotent: the schema uses CREATE TABLE IF NOT EXISTS, so re-running it never
 * destroys existing records. Statements run on a dedicated connection with
 * multipleStatements enabled. Drops are never issued here.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mysql from 'mysql2/promise';
import { dbConfig } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Creates a secondary index only when it does not already exist. */
async function ensureIndex(connection, table, indexName, createSql) {
  const [rows] = await connection.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [table, indexName]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    await connection.query(createSql);
  }
}

export async function migrate() {
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  const connection = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
  try {
    await connection.query(schema);
    // Forward-migration: databases created before the users.role column
    // existed need it added (schema.sql covers fresh installs).
    const [cols] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
    );
    if (!Array.isArray(cols) || cols.length === 0) {
      await connection.query(
        `ALTER TABLE users ADD COLUMN role ENUM('patient','clinician','admin') NOT NULL DEFAULT 'patient'`
      );
    }
    // Forward-migration: bind patient logins to their chart. Databases
    // created before users.patient_id existed need the column added; the
    // foreign key is added separately below because the users table is
    // declared before patients in schema.sql.
    const [patientCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'patient_id'`
    );
    if (!Array.isArray(patientCol) || patientCol.length === 0) {
      await connection.query('ALTER TABLE users ADD COLUMN patient_id VARCHAR(64) NULL');
    }
    await ensureIndex(
      connection,
      'users',
      'idx_users_patient',
      'CREATE INDEX idx_users_patient ON users (patient_id)'
    );
    const [fkRows] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
         AND CONSTRAINT_NAME = 'fk_users_patient' LIMIT 1`
    );
    if (!Array.isArray(fkRows) || fkRows.length === 0) {
      await connection.query(
        `ALTER TABLE users ADD CONSTRAINT fk_users_patient
         FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE SET NULL`
      );
    }
    // Forward-migration: bind a clinician login to the provider they practise
    // as, so the schedule can be scoped to the patients who booked with them.
    // The foreign key is added separately because providers is declared after
    // users in schema.sql (same reason as users.patient_id above).
    const [providerCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'provider_id'`
    );
    if (!Array.isArray(providerCol) || providerCol.length === 0) {
      await connection.query('ALTER TABLE users ADD COLUMN provider_id VARCHAR(64) NULL');
    }
    await ensureIndex(
      connection,
      'users',
      'idx_users_provider',
      'CREATE INDEX idx_users_provider ON users (provider_id)'
    );
    const [providerFk] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
         AND CONSTRAINT_NAME = 'fk_users_provider' LIMIT 1`
    );
    if (!Array.isArray(providerFk) || providerFk.length === 0) {
      await connection.query(
        `ALTER TABLE users ADD CONSTRAINT fk_users_provider
         FOREIGN KEY (provider_id) REFERENCES providers (id) ON DELETE SET NULL`
      );
    }
    // Forward-migration: registration avatar. Stored as a data URL on the
    // account so every role can carry one without touching patient/provider
    // chart rows; unlimited length is unnecessary because the API caps uploads.
    const [avatarCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url'`
    );
    if (!Array.isArray(avatarCol) || avatarCol.length === 0) {
      await connection.query('ALTER TABLE users ADD COLUMN avatar_url MEDIUMTEXT NULL');
    }
    // Forward-migration: session revocation epoch. Existing tokens omit the
    // claim and default to 0, so deploying this does not sign anyone out until
    // their password next rotates. schema.sql covers fresh installs.
    const [tokenVersionCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'token_version'`
    );
    if (!Array.isArray(tokenVersionCol) || tokenVersionCol.length === 0) {
      await connection.query(
        'ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0'
      );
    }
    // Forward-migration: per-user MFA. Deployments that only had the shared
    // MFA_TOTP_SECRET keep the enforcement flag (see isMfaRequired) but each
    // account must enroll its own authenticator before its sessions pass.
    const [mfaSecretCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mfa_secret'`
    );
    if (!Array.isArray(mfaSecretCol) || mfaSecretCol.length === 0) {
      await connection.query('ALTER TABLE users ADD COLUMN mfa_secret TEXT NULL');
    }
    const [mfaEnrolledCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mfa_enrolled_at'`
    );
    if (!Array.isArray(mfaEnrolledCol) || mfaEnrolledCol.length === 0) {
      await connection.query('ALTER TABLE users ADD COLUMN mfa_enrolled_at DATETIME NULL');
    }
    const [mfaStepCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mfa_last_step'`
    );
    if (!Array.isArray(mfaStepCol) || mfaStepCol.length === 0) {
      await connection.query('ALTER TABLE users ADD COLUMN mfa_last_step BIGINT NULL');
    }
    // Forward-migration: widen the audit action ENUM for the waiting-room
    // and consultation-request flows (schema.sql covers fresh installs).
    const [actionCol] = await connection.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND COLUMN_NAME = 'action'`
    );
    const actionType = Array.isArray(actionCol) && actionCol[0] ? String(actionCol[0].COLUMN_TYPE) : '';
    if (actionType && !actionType.includes('S2S_CONSENT')) {
      await connection.query(
        `ALTER TABLE audit_logs MODIFY action ENUM('VIEW_RECORD','EXPORT_FHIR','EXPORT_PDF','START_CONSULTATION','SIGN_SOAP_NOTE','ISSUE_PRESCRIPTION','REQUEST_REFILL','MFA_VERIFIED','REQUEST_CONSULTATION','CHECK_IN','CANCEL_VISIT','S2S_CONSENT','S2S_TURN') NOT NULL`
      );
    } else if (actionType && !actionType.includes('REQUEST_CONSULTATION')) {
      await connection.query(
        `ALTER TABLE audit_logs MODIFY action ENUM('VIEW_RECORD','EXPORT_FHIR','EXPORT_PDF','START_CONSULTATION','SIGN_SOAP_NOTE','ISSUE_PRESCRIPTION','REQUEST_REFILL','MFA_VERIFIED','REQUEST_CONSULTATION','CHECK_IN','CANCEL_VISIT') NOT NULL`
      );
    }
    // Forward-migration: time-ordered indexes for the capped bootstrap reads
    // (chat transcript, notifications). Idempotent via existence checks.
    await ensureIndex(
      connection,
      'chat_messages',
      'idx_messages_created',
      'CREATE INDEX idx_messages_created ON chat_messages (created_at)'
    );
    await ensureIndex(
      connection,
      'notifications',
      'idx_notifications_created',
      'CREATE INDEX idx_notifications_created ON notifications (created_at)'
    );
    // Forward-migration: 50-pair concurrency indexes (scoped schedule reads,
    // waiting-room scan, live-chat poll, signaling poll, ticker reads).
    await ensureIndex(
      connection,
      'appointments',
      'idx_appointments_patient_status',
      'CREATE INDEX idx_appointments_patient_status ON appointments (patient_id, status)'
    );
    await ensureIndex(
      connection,
      'appointments',
      'idx_appointments_provider_status',
      'CREATE INDEX idx_appointments_provider_status ON appointments (provider_id, status)'
    );
    await ensureIndex(
      connection,
      'appointments',
      'idx_appointments_status_start',
      'CREATE INDEX idx_appointments_status_start ON appointments (status, scheduled_start_utc)'
    );
    await ensureIndex(
      connection,
      'chat_messages',
      'idx_messages_appointment_created',
      'CREATE INDEX idx_messages_appointment_created ON chat_messages (appointment_id, created_at)'
    );
    await ensureIndex(
      connection,
      'room_signals',
      'idx_room_signals_visit_created',
      'CREATE INDEX idx_room_signals_visit_created ON room_signals (appointment_id, created_at)'
    );
    await ensureIndex(
      connection,
      'room_signals',
      'idx_room_signals_visit_kind_created',
      'CREATE INDEX idx_room_signals_visit_kind_created ON room_signals (appointment_id, kind, created_at)'
    );
    await ensureIndex(
      connection,
      'notifications',
      'idx_notifications_read_created',
      'CREATE INDEX idx_notifications_read_created ON notifications (read_flag, created_at)'
    );
    // Forward-migration: absolute next-dose instant. Databases created before
    // the column existed keep working (the API falls back to next_dose_minutes)
    // and gain it here. schema.sql covers fresh installs.
    const [doseCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prescriptions' AND COLUMN_NAME = 'next_dose_at'`
    );
    if (!Array.isArray(doseCol) || doseCol.length === 0) {
      await connection.query('ALTER TABLE prescriptions ADD COLUMN next_dose_at DATETIME NULL');
      // Backfill from the stored countdown so existing rows become
      // clock-driven immediately instead of waiting for the next update.
      await connection.query(
        'UPDATE prescriptions SET next_dose_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL next_dose_minutes MINUTE) WHERE next_dose_at IS NULL'
      );
    }
    // Forward-migration: shared waiting-room claim bookkeeping. Databases
    // created before the columns existed gain them here; schema.sql covers
    // fresh installs.
    const [claimCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'appointments' AND COLUMN_NAME = 'claimed_by_user_id'`
    );
    if (!Array.isArray(claimCol) || claimCol.length === 0) {
      await connection.query('ALTER TABLE appointments ADD COLUMN claimed_by_user_id INT NULL');
      await connection.query('ALTER TABLE appointments ADD COLUMN claimed_by_name VARCHAR(255) NULL');
      await connection.query('ALTER TABLE appointments ADD COLUMN claimed_at DATETIME NULL');
    }
    // Forward-migration: bind legacy name/email follow-up rows to a chart id so
    // panel scoping never relies on a non-unique display name. Existing rows
    // are backfilled by exact name + email; unmatched rows stay NULL and are
    // treated as clinic-wide only for covering clinicians/admins.
    const [followUpPatientCol] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'follow_ups' AND COLUMN_NAME = 'patient_id'`
    );
    if (!Array.isArray(followUpPatientCol) || followUpPatientCol.length === 0) {
      await connection.query('ALTER TABLE follow_ups ADD COLUMN patient_id VARCHAR(64) NULL AFTER id');
    }
    await connection.query(
      `UPDATE follow_ups f
         JOIN patients p ON p.name = f.patient_name AND p.email = f.patient_email
          SET f.patient_id = p.id
        WHERE f.patient_id IS NULL`
    );
    await ensureIndex(
      connection,
      'follow_ups',
      'idx_follow_ups_patient',
      'CREATE INDEX idx_follow_ups_patient ON follow_ups (patient_id)'
    );
    const [followUpFk] = await connection.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'follow_ups'
         AND CONSTRAINT_NAME = 'fk_follow_ups_patient' LIMIT 1`
    );
    if (!Array.isArray(followUpFk) || followUpFk.length === 0) {
      await connection.query(
        `ALTER TABLE follow_ups ADD CONSTRAINT fk_follow_ups_patient
         FOREIGN KEY (patient_id) REFERENCES patients (id) ON DELETE SET NULL`
      );
    }
  } finally {
    await connection.end();
  }
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  migrate()
    .then(() => console.log('[medzone-api] schema applied'))
    .catch((err) => {
      console.error('[medzone-api] migration failed:', err.message);
      process.exitCode = 1;
    });
}
