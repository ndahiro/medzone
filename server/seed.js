/**
 * Seeds the MedZone database with the demo dataset from server/seed-data.js.
 *
 *   npm run db:seed
 *
 * Idempotent for records with explicit primary keys (upsert). Vitals telemetry
 * has no natural key, so the demo patient's vitals rows are replaced.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { closePool, query } from './db.js';
import { insertRow, upsertRow } from './repository.js';
import * as m from './mappers.js';
import {
  SEED_APPOINTMENTS,
  SEED_AUDIT_LOGS,
  SEED_CONSULTANT_NOTES,
  SEED_FOLLOW_UPS,
  SEED_NOTIFICATIONS,
  SEED_PATIENTS,
  SEED_PRESCRIPTIONS,
  SEED_PROVIDERS,
  SEED_REFERRALS,
  SEED_SOAP_NOTES,
  SEED_USERS,
} from './seed-data.js';

export async function seed() {
  // Patient charts and nested US Core resources.
  for (const patient of SEED_PATIENTS) {
    await upsertRow('patients', m.patientColumns(patient));
    for (const allergy of patient.allergies) {
      await upsertRow('allergies', m.allergyColumns(patient.id, allergy));
    }
    for (const condition of patient.conditions) {
      await upsertRow('conditions', m.conditionColumns(patient.id, condition));
    }
    for (const lab of patient.recentLabs) {
      await upsertRow('lab_results', m.labColumns(patient.id, lab));
    }
    await query('DELETE FROM vitals_readings WHERE patient_id = ?', [patient.id]);
    for (const vitals of patient.vitalsHistory) {
      await insertRow('vitals_readings', m.vitalsColumns(patient.id, vitals));
    }
  }

  // Providers and their availability slots.
  for (const provider of SEED_PROVIDERS) {
    await upsertRow('providers', m.providerColumns(provider));
    for (let i = 0; i < provider.availableTimes.length; i += 1) {
      await upsertRow('provider_availability', {
        provider_id: provider.id,
        slot: provider.availableTimes[i],
        position: i,
      });
    }
  }

  for (const appointment of SEED_APPOINTMENTS) {
    await upsertRow('appointments', m.appointmentColumns(appointment));
  }
  for (const prescription of SEED_PRESCRIPTIONS) {
    await upsertRow('prescriptions', m.prescriptionColumns(prescription));
  }
  for (const log of SEED_AUDIT_LOGS) {
    await upsertRow('audit_logs', m.auditLogColumns(log));
  }
  for (const notification of SEED_NOTIFICATIONS) {
    await upsertRow('notifications', m.notificationColumns(notification));
  }
  for (const followUp of SEED_FOLLOW_UPS) {
    await upsertRow('follow_ups', m.followUpColumns(followUp));
  }
  // Visit notes are keyed to their appointment. The old clinic-wide singleton
  // (`soap-current`) was a cross-patient hazard; remove it when re-seeding.
  await query('DELETE FROM soap_notes WHERE id = ?', ['soap-current']);
  for (const { appointmentId, note } of SEED_SOAP_NOTES) {
    await upsertRow('soap_notes', m.soapColumns(`soap-${appointmentId}`, note, appointmentId));
  }
  for (const note of SEED_CONSULTANT_NOTES) {
    await upsertRow('consultant_notes', m.consultantNoteColumns(note));
  }
  for (const referral of SEED_REFERRALS) {
    await upsertRow('referrals', m.referralColumns({ ...referral, status: referral.status }));
    // Preserve the seeded triage state: upsert always writes pending, so
    // restore non-pending seeded statuses explicitly.
    if (referral.status && referral.status !== 'pending') {
      await query('UPDATE referrals SET status = ? WHERE id = ?', [referral.status, referral.id]);
    }
  }

  // RBAC users. Upserted by unique username so re-seeding never duplicates
  // accounts and never clobbers an admin-changed password: existing rows keep
  // their stored hash; only brand-new seed users are inserted.
  //
  // The demo accounts ship with well-known passwords, so they are DEVELOPMENT
  // fixtures: a production seed skips them unless the operator explicitly opts
  // in with SEED_DEMO_USERS=1 (e.g. a staging demo box).
  const { hashPassword, isPlaceholderSecret, PASSWORD_MIN_LENGTH } = await import('./auth.js');
  const isProduction = process.env.NODE_ENV === 'production';
  const seedDemoUsers = !isProduction || process.env.SEED_DEMO_USERS === '1';
  if (isProduction && seedDemoUsers) {
    console.warn(
      '[medzone-api] SEED_DEMO_USERS=1 in production: seeding demo accounts with published passwords. Do not do this on a live instance.'
    );
  }
  if (seedDemoUsers) {
    for (const seedUser of SEED_USERS) {
      const existing = await query('SELECT id FROM users WHERE username = ?', [seedUser.username]);
      if (existing.length === 0) {
        await insertRow('users', {
          username: seedUser.username,
          display_name: seedUser.displayName,
          password_hash: await hashPassword(seedUser.password),
          modules: JSON.stringify(seedUser.modules),
          is_admin: seedUser.isAdmin ? 1 : 0,
          role: seedUser.role || 'patient',
          patient_id: seedUser.patientId || null,
          provider_id: seedUser.providerId || null,
        });
      } else {
        // Backfill the role on databases seeded before roles existed, the chart
        // link on databases seeded before users.patient_id existed, and the
        // provider binding on databases seeded before users.provider_id existed.
        await query('UPDATE users SET role = ? WHERE username = ?', [seedUser.role || 'patient', seedUser.username]);
        await query('UPDATE users SET patient_id = ? WHERE username = ?', [
          seedUser.patientId || null,
          seedUser.username,
        ]);
        await query('UPDATE users SET provider_id = ? WHERE username = ?', [
          seedUser.providerId || null,
          seedUser.username,
        ]);
        // Backfill the display name too: an older seed (or the Uganda purge
        // script) can leave a stale name on a demo account, and the name is
        // stamped onto audit rows and chat transcripts, so a stale value
        // makes the whole suite assert against a person who is not there.
        // The password hash is deliberately left alone: re-seeding must never
        // clobber a password an operator changed.
        await query('UPDATE users SET display_name = ? WHERE username = ?', [
          seedUser.displayName,
          seedUser.username,
        ]);
      }
    }
  }

  // Safety net: when no admin exists (fresh database seeded without the admin
  // row, or an older DB migrated forward), create one from environment
  // variables so the instance is never left without an administrator.
  // In production the password is mandatory and must be a real secret — the
  // published development default is never acceptable for a live instance.
  const { countUsers } = await import('./repository.js');
  const adminCount = await query('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1');
  if (Number(adminCount[0]?.count ?? 0) === 0 && (await countUsers()) >= 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const alreadyThere = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (alreadyThere.length === 0) {
      const adminPassword = process.env.ADMIN_PASSWORD || '';
      if (isProduction && (adminPassword.length < PASSWORD_MIN_LENGTH || isPlaceholderSecret(adminPassword))) {
        throw new Error(
          `Refusing to seed the first administrator in production without a real ADMIN_PASSWORD ` +
            `(at least ${PASSWORD_MIN_LENGTH} characters, not a placeholder). ` +
            'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'base64url\'))"'
        );
      }
      const { ALLOWED_MODULES } = await import('./auth.js');
      await insertRow('users', {
        username,
        display_name: process.env.ADMIN_DISPLAY_NAME || 'Administrator',
        password_hash: await hashPassword(adminPassword || 'Admin123'),
        modules: JSON.stringify(ALLOWED_MODULES),
        is_admin: 1,
        role: 'admin',
      });
    }
  }
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  seed()
    .then(async () => {
      console.log('[medzone-api] seed data loaded');
      await closePool();
    })
    .catch(async (err) => {
      console.error('[medzone-api] seeding failed:', err.message);
      await closePool();
      process.exitCode = 1;
    });
}
