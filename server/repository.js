/**
 * MedZone backend - repository (data access) layer.
 *
 * Every function translates between MySQL rows and the domain objects exposed
 * by the REST API. All SQL is parameterized.
 */
import { query, queryOne } from './db.js';
import {
  appointmentColumns,
  auditLogColumns,
  chatMessageColumns,
  consultantNoteColumns,
  consultationRequestColumns,
  isoToUtcDateTime,
  mapAppointment,
  mapAuditLog,
  mapChatMessage,
  mapConsultantNote,
  mapConsultationRequest,
  mapFollowUp,
  mapNotification,
  mapPatient,
  mapPrescription,
  mapProvider,
  mapReferral,
  mapRoomSignal,
  mapSoapNote,
  mapUserRow,
  mapVisitAttachment,
  mapVisitGuest,
  mapVisitInvite,
  mapVitalsRow,
  notificationColumns,
  overlayPatientAvatars,
  patientColumns,
  prescriptionColumns,
  referralColumns,
  soapColumns,
  followUpColumns,
  visitAttachmentColumns,
} from './mappers.js';
import { decryptTranscript } from './crypto.js';
import { SOAP_NOTE_ID } from './seed-data.js';

const ALLOWED_PRESCRIPTION_FIELDS = new Set([
  'status',
  'next_dose_minutes',
  'adherence_percentage',
  'remaining_refills',
]);

/**
 * Fallback visit transition table (mirrors server/visitStatus.js).
 * Injected `canTransitionVisit` from app.js takes precedence; this keeps
 * direct repository callers and unit tests safe.
 */
function defaultCanTransitionVisit(from, to) {
  const legal = {
    scheduled: ['in-progress', 'cancelled'],
    'in-progress': ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  return legal[from]?.includes(to) ?? false;
}

export async function insertRow(table, columns) {
  const keys = Object.keys(columns);
  const sql = `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys
    .map(() => '?')
    .join(', ')})`;
  await query(sql, Object.values(columns));
}

export async function upsertRow(table, columns) {
  const keys = Object.keys(columns);
  const updates = keys
    .filter((k) => k !== 'id')
    .map((k) => `\`${k}\` = VALUES(\`${k}\`)`)
    .join(', ');
  const sql = `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES (${keys
    .map(() => '?')
    .join(', ')})${updates ? ` ON DUPLICATE KEY UPDATE ${updates}` : ''}`;
  await query(sql, Object.values(columns));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Near-static reference data cache (see getProviders).
let providersCache = { at: 0, data: null };

export async function getProviders() {
  // Near-static reference data: cache briefly so a 500-user burst does not
  // re-read providers + slots on every bootstrap. TTL is env-tunable.
  const ttlMs = Number(process.env.PROVIDERS_CACHE_TTL_MS || 30000);
  const now = Date.now();
  if (providersCache.data && now - providersCache.at < ttlMs) return providersCache.data;
  const rows = await query('SELECT * FROM providers ORDER BY name');
  const slots = await query('SELECT * FROM provider_availability ORDER BY position');
  const providers = rows.map((row) =>
    mapProvider(
      row,
      slots.filter((s) => s.provider_id === row.id).map((s) => s.slot)
    )
  );
  providersCache = { at: now, data: providers };
  return providers;
}

/**
 * Sentinel for a patient session whose account has no chart linked: it matches
 * no row, so a scoped read returns nothing instead of widening to the clinic.
 */
export const NO_CHART = '\u0000no-chart';

/** Ownership checks (HCW@Home isConsultationOwner parity). */
export async function appointmentBelongsTo(appointmentId, patientId) {
  if (!appointmentId || !patientId) return false;
  const row = await queryOne('SELECT patient_id FROM appointments WHERE id = ?', [appointmentId]);
  return !!row && row.patient_id === patientId;
}

/**
 * Raw appointment row for policy decisions.
 *
 * Room admission and transcript routes must inspect the visit state
 * (patient_id, status, room_code) before the record is ever mapped for the
 * client; the mapped shape deliberately hides those raw columns.
 */
export async function getAppointmentRow(id) {
  return queryOne('SELECT * FROM appointments WHERE id = ?', [id]);
}

/** Raw prescription row for transition policy decisions (no mapping). */
export async function getPrescriptionRow(id) {
  return queryOne('SELECT * FROM prescriptions WHERE id = ?', [id]);
}

/**
 * Attach nested chart rows (allergies, conditions, labs, vitals) to patient
 * records in one round-trip per collection.
 */
async function attachPatientDetails(rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const [allergies, conditions, labs, vitals] = await Promise.all([
    query(`SELECT * FROM allergies WHERE patient_id IN (${placeholders}) ORDER BY id`, ids),
    query(`SELECT * FROM conditions WHERE patient_id IN (${placeholders}) ORDER BY id`, ids),
    query(
      `SELECT * FROM lab_results WHERE patient_id IN (${placeholders}) ORDER BY result_date DESC`,
      ids
    ),
    query(
      `SELECT * FROM vitals_readings WHERE patient_id IN (${placeholders}) ORDER BY recorded_at`,
      ids
    ),
  ]);
  return rows.map((row) =>
    mapPatient(row, {
      allergies: allergies.filter((item) => item.patient_id === row.id),
      conditions: conditions.filter((item) => item.patient_id === row.id),
      labs: labs.filter((item) => item.patient_id === row.id),
      vitals: vitals.filter((item) => item.patient_id === row.id),
    })
  );
}

/**
 * Chart read for one id. Never guesses another row: missing or sentinel ids
 * return null so a session cannot inherit the clinic's first patient.
 */
export async function getPatient(patientId = null) {
  if (!patientId || patientId === NO_CHART) return null;
  const row = await queryOne('SELECT * FROM patients WHERE id = ?', [patientId]);
  if (!row) return null;
  const [mapped] = await attachPatientDetails([row]);
  return mapped;
}

/** MRN of one chart (audit target resolution for patient-authored entries). */
export async function getPatientMrn(patientId) {
  if (!patientId || patientId === NO_CHART) return null;
  const row = await queryOne('SELECT mrn FROM patients WHERE id = ?', [patientId]);
  return row?.mrn ?? null;
}

/** Clinic directory: every chart, used by staff bootstrap and chart pickers. */
async function getPatients() {
  const rows = await query('SELECT * FROM patients ORDER BY name');
  return attachPatientDetails(rows);
}

/**
 * Registration portraits for patient accounts, keyed indirectly by chart.
 * The bootstrap overlays these on chart rows so both the patient and staff
 * report views show the same current likeness.
 */
async function getPatientAccountAvatarRows() {
  return query(
    `SELECT patient_id, avatar_url FROM users
      WHERE role = 'patient' AND patient_id IS NOT NULL
        AND avatar_url IS NOT NULL AND avatar_url <> ''
      ORDER BY id`
  );
}

/**
 * The patients who have booked with one provider — a bound clinician's
 * directory. Join-based (not a stored denormalisation) so a visit booked by
 * the patient immediately brings that chart into the provider's list.
 */
export async function getProviderPatients(providerId, userId = null) {
  if (!providerId) return [];
  const rows = await query(
    `SELECT DISTINCT p.* FROM patients p
       JOIN appointments a ON a.patient_id = p.id
      WHERE a.provider_id = ? OR a.claimed_by_user_id = ?
      ORDER BY p.name`,
    [providerId, userId ?? null]
  );
  return attachPatientDetails(rows);
}

/**
 * True when a bound clinician may treat this chart. The relationship is
 * established by a visit booked with their provider, or by a shared
 * waiting-room visit they claimed. Covering clinicians/admins never call this
 * because they have no provider scope and keep the clinic-wide read.
 */
export async function providerCanAccessPatient(providerId, userId, patientId) {
  if (!providerId || !patientId) return false;
  const row = await queryOne(
    `SELECT 1 AS ok FROM appointments
      WHERE patient_id = ?
        AND (provider_id = ? OR claimed_by_user_id = ?)
      LIMIT 1`,
    [patientId, providerId, userId ?? null]
  );
  return !!row;
}

/**
 * Recent vitals telemetry for one chart, oldest first.
 *
 * This replaces the former client-side synthetic ticker: the consultation room
 * reads whatever the clinic has actually recorded, and the API scopes the read
 * to the chart so a patient session can never pull another patient's vitals.
 */
export async function getVitalsReadings(patientId, limit = 60) {
  if (!patientId) return [];
  const cap = String(Math.min(Math.max(Number(limit) || 60, 1), 500));
  const rows = await query(
    'SELECT * FROM vitals_readings WHERE patient_id = ? ORDER BY recorded_at DESC, id DESC LIMIT ?',
    [patientId, cap]
  );
  return rows.map(mapVitalsRow).reverse();
}

/**
 * Visits for one chart (a patient session) or one provider (a clinician bound
 * to a provider). Neither scope supplied keeps the clinic-wide read used by
 * administrators and covering clinicians.
 */
export async function getAppointments(patientId = null, providerId = null, userId = null) {
  if (patientId) {
    const rows = await query(
      'SELECT * FROM appointments WHERE patient_id = ? ORDER BY scheduled_start_utc',
      [patientId]
    );
    return rows.map(mapAppointment);
  }
  if (providerId) {
    // The panel is the provider's own bookings plus anything they picked up
    // from the shared waiting room. Keep this predicate in step with
    // providerCanAccessPatient and the collection reads below.
    const rows = await query(
      `SELECT * FROM appointments
        WHERE provider_id = ? OR claimed_by_user_id = ?
        ORDER BY scheduled_start_utc`,
      [providerId, userId ?? null]
    );
    return rows.map(mapAppointment);
  }
  const rows = await query('SELECT * FROM appointments ORDER BY scheduled_start_utc');
  return rows.map(mapAppointment);
}

export async function getPrescriptions(patientId = null, providerId = null, userId = null) {
  if (patientId) {
    const rows = await query(
      'SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY prescribed_date DESC, id',
      [patientId]
    );
    return rows.map(mapPrescription);
  }
  if (providerId) {
    // A bound clinician sees the medication list of their own panel only:
    // every chart with a visit booked with them, plus any waiting-room visit
    // they claimed.
    const rows = await query(
      `SELECT DISTINCT p.* FROM prescriptions p
         JOIN appointments a ON a.patient_id = p.patient_id
        WHERE a.provider_id = ? OR a.claimed_by_user_id = ?
        ORDER BY p.prescribed_date DESC, p.id`,
      [providerId, userId ?? null]
    );
    return rows.map(mapPrescription);
  }
  const rows = await query('SELECT * FROM prescriptions ORDER BY prescribed_date DESC, id');
  return rows.map(mapPrescription);
}

export async function getAuditLogs(limit = 200, providerId = null, userId = null) {
  if (providerId) {
    // Audit rows carry an MRN, not a chart id. Keep the panel's charts plus
    // clinic-wide rows with no patient target (system/operations events).
    const rows = await query(
      `SELECT l.* FROM audit_logs l
        WHERE l.target_mrn IS NULL OR l.target_mrn = '' OR EXISTS (
          SELECT 1 FROM patients p
            JOIN appointments a ON a.patient_id = p.id
           WHERE p.mrn = l.target_mrn
             AND (a.provider_id = ? OR a.claimed_by_user_id = ?)
        )
        ORDER BY l.logged_at DESC LIMIT ?`,
      [providerId, userId ?? null, String(limit)]
    );
    return rows.map(mapAuditLog);
  }
  const rows = await query('SELECT * FROM audit_logs ORDER BY logged_at DESC LIMIT ?', [String(limit)]);
  return rows.map(mapAuditLog);
}

export async function getNotifications(limit = 200) {
  const rows = await query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?', [String(limit)]);
  return rows.map(mapNotification);
}

/** Every follow-up row (staff directory). */
export async function getFollowUps() {
  const rows = await query('SELECT * FROM follow_ups ORDER BY id');
  return rows.map(mapFollowUp);
}

/**
 * Follow-up for one chart, keyed by the chart id. Legacy rows are backfilled
 * during migration; a null patient_id is never treated as a wildcard.
 */
async function getFollowUp(patientId = null) {
  if (!patientId || patientId === NO_CHART) return null;
  const row = await queryOne(
    'SELECT * FROM follow_ups WHERE patient_id = ? ORDER BY id',
    [patientId],
  );
  return row ? mapFollowUp(row) : null;
}

/**
 * SOAP note for a visit or a chart. Never returns the clinic-wide singleton
 * just because staff asked without a target — that used to attach one
 * patient's note to every clinician session.
 */
export async function getSoapNote(patientId = null, appointmentId = null) {
  if (appointmentId) {
    // Patient scope: a note is only reachable when the visit it belongs to
    // sits on the caller's own chart. Notes with no appointment (the legacy
    // singleton) are not chart-verifiable and stay staff-only. This closed a
    // cross-chart read: the query parameter used to opt out of chart scope.
    if (patientId === NO_CHART) return null;
    if (patientId) {
      const row = await queryOne(
        `SELECT n.* FROM soap_notes n
         INNER JOIN appointments a ON a.id = n.appointment_id
         WHERE (n.appointment_id = ? OR n.id = ?) AND a.patient_id = ?
         ORDER BY n.updated_at DESC LIMIT 1`,
        [appointmentId, `soap-${appointmentId}`, patientId]
      );
      return row ? mapSoapNote(row) : null;
    }
    const row = await queryOne(
      'SELECT * FROM soap_notes WHERE appointment_id = ? OR id = ? ORDER BY updated_at DESC LIMIT 1',
      [appointmentId, `soap-${appointmentId}`]
    );
    return row ? mapSoapNote(row) : null;
  }
  if (patientId && patientId !== NO_CHART) {
    const row = await queryOne(
      `SELECT n.* FROM soap_notes n
       INNER JOIN appointments a ON a.id = n.appointment_id
       WHERE a.patient_id = ?
       ORDER BY n.updated_at DESC LIMIT 1`,
      [patientId]
    );
    return row ? mapSoapNote(row) : null;
  }
  return null;
}

export async function getChatMessages(appointmentId, limit = 500, patientId = null) {
  // Bounded transcript reads: newest N rows, re-sorted chronologically so the
  // client still receives an ordered transcript without full-table scans.
  const cap = String(Math.min(Math.max(Number(limit) || 500, 1), 2000));
  let rows;
  if (appointmentId) {
    rows = await query('SELECT * FROM chat_messages WHERE appointment_id = ? ORDER BY created_at DESC LIMIT ?', [appointmentId, cap]);
  } else if (patientId) {
    rows = await query(
      `SELECT m.* FROM chat_messages m
       JOIN appointments a ON a.id = m.appointment_id
       WHERE a.patient_id = ? ORDER BY m.created_at DESC LIMIT ?`,
      [patientId, cap]
    );
  } else {
    rows = await query('SELECT * FROM chat_messages ORDER BY created_at DESC LIMIT ?', [cap]);
  }
  return rows.map(toClientChatMessage).reverse();
}

// ---------------------------------------------------------------------------
// Users & sessions (RBAC user management, elgon parity)
// ---------------------------------------------------------------------------

export async function getAllUsers() {
  const rows = await query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUserRow);
}

export async function getUserById(id) {
  const row = await queryOne('SELECT * FROM users WHERE id = ?', [id]);
  return row ? mapUserRow(row) : null;
}

/**
 * Raw users row (snake_case, is_admin as 0/1) for re-signing the session
 * cookie. Session claims are built from raw rows, so routes that refresh a
 * claim (MFA verification) need this shape rather than the mapped user.
 */
export async function getUserRowById(id) {
  return queryOne('SELECT * FROM users WHERE id = ?', [id]);
}

export async function getUserWithHashByUsername(username) {
  return queryOne('SELECT * FROM users WHERE username = ?', [username]);
}

export async function createUserRow({
  username,
  displayName,
  passwordHash,
  modules,
  isAdmin,
  role,
  patientId,
  providerId,
  avatarUrl,
}) {
  const result = await query(
    'INSERT INTO users (username, display_name, password_hash, modules, is_admin, role, patient_id, provider_id, avatar_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      username,
      displayName,
      passwordHash,
      JSON.stringify(modules),
      isAdmin ? 1 : 0,
      role || 'patient',
      patientId || null,
      providerId || null,
      avatarUrl || null,
    ]
  );
  return getUserById(result.insertId);
}

export async function updateUserModules(id, modules) {
  await query('UPDATE users SET modules = ? WHERE id = ?', [JSON.stringify(modules), id]);
}

export async function updateUserAdmin(id, isAdmin) {
  await query('UPDATE users SET is_admin = ? WHERE id = ?', [isAdmin ? 1 : 0, id]);
}

export async function updateUserRole(id, role) {
  await query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
}

/** Replaces (or clears, with an empty string) an account's profile avatar. */
export async function updateUserAvatar(id, avatarUrl) {
  await query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl || null, id]);
}

/** Binds an account to a patient chart (or clears it with null). */
export async function updateUserPatient(id, patientId) {
  await query('UPDATE users SET patient_id = ? WHERE id = ?', [patientId || null, id]);
}

/**
 * Stores a freshly generated TOTP secret (already encrypted with the PHI key)
 * and resets the enrollment mark and the single-use ledger with it: a new
 * device must prove itself before the account counts as enrolled again.
 */
export async function setUserMfaSecret(id, encryptedSecret) {
  await query(
    'UPDATE users SET mfa_secret = ?, mfa_enrolled_at = NULL, mfa_last_step = NULL WHERE id = ?',
    [encryptedSecret || null, id]
  );
}

/** Marks enrollment complete on the account's first successful verification. */
export async function activateUserMfa(id) {
  await query(
    'UPDATE users SET mfa_enrolled_at = COALESCE(mfa_enrolled_at, UTC_TIMESTAMP()) WHERE id = ?',
    [id]
  );
}

/**
 * Burns one accepted TOTP step for the account.
 *
 * Returns true only for the first use of that step. The WHERE clause is the
 * whole single-use guarantee, and MySQL enforces it, so every API worker (and
 * a restart) shares one ledger — an in-process map could not promise that.
 */
export async function consumeMfaStep(id, step) {
  const result = await query(
    'UPDATE users SET mfa_last_step = ? WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)',
    [step, id, step]
  );
  return Number(result?.affectedRows ?? 0) > 0;
}

/** Clears an account's authenticator (lost device, or an admin reset). */
export async function clearUserMfa(id) {
  await query(
    'UPDATE users SET mfa_secret = NULL, mfa_enrolled_at = NULL, mfa_last_step = NULL WHERE id = ?',
    [id]
  );
}

/**
 * Binds a clinician account to the provider they practise as (or clears the
 * link with null, which restores the covering clinician's clinic-wide read).
 */
export async function updateUserProvider(id, providerId) {
  await query('UPDATE users SET provider_id = ? WHERE id = ?', [providerId || null, id]);
}

/**
 * Rotates a password hash and invalidates every session minted before now.
 * The token epoch is bumped in the same statement, so a stolen cookie cannot
 * outlive the credential it was issued for.
 */
export async function updateUserPasswordHash(id, passwordHash) {
  await query(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
    [passwordHash, id]
  );
}

export async function deleteUserRow(id) {
  await query('DELETE FROM users WHERE id = ?', [id]);
}

export async function countUsers() {
  const row = await queryOne('SELECT COUNT(*) AS count FROM users');
  return Number(row?.count ?? 0);
}

/** Number of accounts holding the admin flag (last-admin safeguards). */
export async function countAdmins() {
  const row = await queryOne('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1');
  return Number(row?.count ?? 0);
}

/**
 * The client's single hydration read.
 *
 * `scope.patientId` restricts every collection to one chart (a patient
 * session, bound to their own patient row). `scope.providerId` restricts the
 * visit list and the patient directory to one clinician's own patients
 * (a clinician login bound to a provider). Neither supplied keeps the
 * clinic-wide read used by administrators and covering clinicians. Staff
 * receive `patients[]` and `followUps[]` with `patient` / `followUp` /
 * `soapNotes` null — never a guessed first-row chart.
 *
 * Audit logs and notifications carry no patient ownership column, so a patient
 * scope receives neither instead of the clinic's operational firehose.
 * Provider directory stays: a patient needs it to book a visit.
 */
export async function getBootstrap(scope = {}) {
  const patientId = scope.patientId ?? null;
  const providerId = scope.providerId ?? null;
  const userId = scope.userId ?? null;
  const staff = !patientId;
  const [
    patient,
    patients,
    providers,
    appointments,
    prescriptions,
    followUp,
    followUps,
    soapNotes,
    chatMessages,
    consultantNotes,
    consultationRequests,
    referrals,
    patientAccountAvatars,
  ] = await Promise.all([
    patientId ? getPatient(patientId) : Promise.resolve(null),
    // A clinician bound to a provider receives only their own patients; a
    // covering clinician (no provider link) and an administrator keep the
    // clinic-wide directory.
    patientId ? Promise.resolve([]) : providerId ? getProviderPatients(providerId, userId) : getPatients(),
    getProviders(),
    getAppointments(patientId, providerId, userId),
    getPrescriptions(patientId, providerId, userId),
    getFollowUp(patientId),
    staff ? getFollowUps() : Promise.resolve([]),
    getSoapNote(patientId),
    patientId ? getChatMessages(null, 500, patientId) : Promise.resolve([]),
    getConsultantNotes(patientId, providerId, userId).catch(() => []),
    getConsultationRequests(patientId, providerId, userId).catch(() => []),
    getReferrals(patientId, providerId, userId).catch(() => []),
    getPatientAccountAvatarRows(),
  ]);
  const [auditLogs, notifications] = patientId
    ? [[], []]
    : await Promise.all([getAuditLogs(200, providerId, userId), getNotifications()]);
  // Cap staff bootstrap payloads: a clinic with hundreds of visits must not
  // serialize the whole table into every login (50 pairs logging in at once).
  const BOOTSTRAP_APPOINTMENT_CAP = Math.max(
    1,
    Number(process.env.BOOTSTRAP_APPOINTMENT_CAP || 200)
  );
  const BOOTSTRAP_MESSAGE_CAP = Math.max(
    1,
    Number(process.env.BOOTSTRAP_MESSAGE_CAP || 100)
  );
  const cappedAppointments = patientId
    ? appointments
    : appointments.slice(0, BOOTSTRAP_APPOINTMENT_CAP);
  const cappedMessages = chatMessages.length > BOOTSTRAP_MESSAGE_CAP
    ? chatMessages.slice(-BOOTSTRAP_MESSAGE_CAP)
    : chatMessages;
  // A bound clinician's follow-up inbox is their own panel. Scope by chart id;
  // an unlinked legacy row is not silently visible to every clinician.
  const scopedFollowUps =
    staff && providerId
      ? followUps.filter(f => f.patientId && patients.some(p => p.id === f.patientId))
      : followUps;
  // The chart record and the patient account are separate rows. Prefer the
  // account's registration portrait for both the patient's own view and the
  // staff directory, so a report shows the face the person chose.
  const visiblePatients = overlayPatientAvatars(
    staff ? patients : patient ? [patient] : [],
    patientAccountAvatars
  );
  const scopedPatient = staff ? null : visiblePatients[0] ?? patient;
  return {
    patient: scopedPatient,
    patients: visiblePatients,
    providers,
    appointments: cappedAppointments,
    prescriptions,
    auditLogs,
    notifications,
    followUp,
    followUps: staff ? scopedFollowUps : followUp ? [followUp] : [],
    soapNotes,
    chatMessages: cappedMessages,
    consultantNotes,
    consultationRequests,
    referrals,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createAppointment(appointment) {
  await insertRow('appointments', appointmentColumns(appointment));
  return appointment;
}

/**
 * Finds a live visit already holding the instant for this provider or chart.
 * The 60-second tolerance absorbs clock skew and second-precision storage, so
 * starts booked moments apart still count as the same slot.
 */
export async function findSlotClash(scheduledStartIso, providerId, patientId) {
  const utc = isoToUtcDateTime(scheduledStartIso);
  if (!utc) return null;
  return queryOne(
    `SELECT id FROM appointments
      WHERE status IN ('scheduled', 'in-progress')
        AND ABS(TIMESTAMPDIFF(SECOND, scheduled_start_utc, ?)) < 60
        AND (provider_id = ? OR patient_id = ?)
      LIMIT 1`,
    [utc, providerId, patientId],
  );
}

export async function updateAppointmentStatus(id, status, guards = {}) {
  const canTransition = guards.canTransitionVisit ?? defaultCanTransitionVisit;
  const current = await queryOne('SELECT * FROM appointments WHERE id = ?', [id]);
  if (!current) return null;
  if (current.status === status) return mapAppointment(current);
  if (!canTransition(current.status, status)) return null;
  await query('UPDATE appointments SET status = ? WHERE id = ?', [status, id]);
  const row = await queryOne('SELECT * FROM appointments WHERE id = ?', [id]);
  return row ? mapAppointment(row) : null;
}

export async function createPrescription(prescription) {
  await insertRow('prescriptions', prescriptionColumns(prescription));
  return prescription;
}

export async function updatePrescription(id, patch) {
  const keys = Object.keys(patch).filter((k) => ALLOWED_PRESCRIPTION_FIELDS.has(k));
  if (!keys.length) return null;
  const assignments = keys.map((k) => `\`${k}\` = ?`);
  const values = keys.map((k) => patch[k]);
  if (keys.includes('next_dose_minutes')) {
    // The stored countdown is a projection of an absolute instant: re-stamp
    // the due time whenever the countdown changes so it is time-driven and
    // survives reloads instead of resetting to a stale constant.
    assignments.push('`next_dose_at` = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)');
    values.push(Math.max(0, Math.floor(Number(patch.next_dose_minutes) || 0)));
  }
  await query(
    `UPDATE prescriptions SET ${assignments.join(', ')} WHERE id = ?`,
    [...values, id]
  );
  const row = await queryOne('SELECT * FROM prescriptions WHERE id = ?', [id]);
  return row ? mapPrescription(row) : null;
}

export async function createAuditLog(entry) {
  await insertRow('audit_logs', auditLogColumns(entry));
  return entry;
}

export async function createNotification(notification) {
  await insertRow('notifications', notificationColumns(notification));
  return notification;
}

export async function markNotificationRead(id) {
  await query('UPDATE notifications SET read_flag = 1 WHERE id = ?', [id]);
}

export async function markAllNotificationsRead() {
  await query('UPDATE notifications SET read_flag = 1 WHERE read_flag = 0');
}

export async function createChatMessage(message) {
  await insertRow('chat_messages', chatMessageColumns(message));
  return { ...message, isEncrypted: true };
}

/**
 * Rows written before transcripts moved server-side hold raw hex from the
 * retired client key (derived from the visit id). That key no longer exists in
 * the app, and the payload carries no envelope this server can open, so say so
 * instead of rendering hex as if it were a message.
 */
const LEGACY_CIPHER_HEX = /^(?:[0-9a-f]{2})+$/i;

/**
 * The client shape of a transcript message: plaintext for the participant
 * reading it, plus the fact that the stored row is ciphertext. Cipher material
 * is decrypted here and never leaves the server.
 */
const toClientChatMessage = (row) => {
  const mapped = mapChatMessage(row);
  const legacy = LEGACY_CIPHER_HEX.test(mapped.cipherText || '');
  return {
    id: mapped.id,
    appointmentId: mapped.appointmentId,
    senderRole: mapped.senderRole,
    senderName: mapped.senderName,
    timestamp: mapped.timestamp,
    text: legacy
      ? '[message encrypted under the retired browser key — re-send to record it]'
      : decryptTranscript(mapped.cipherText),
    isEncrypted: mapped.isEncrypted,
  };
};

/** Stable row id for a visit note (or the legacy singleton when no visit). */
const soapNoteIdFor = (appointmentId = null) =>
  appointmentId ? `soap-${appointmentId}` : SOAP_NOTE_ID;

/**
 * Signature metadata for the overwrite guard. Reads only id/is_signed so the
 * route can refuse rewriting a signed note without decrypting any PHI.
 */
export async function getSoapNoteMeta(appointmentId = null) {
  return queryOne('SELECT id, is_signed FROM soap_notes WHERE id = ?', [soapNoteIdFor(appointmentId)]);
}

export async function upsertSoapNote(soapNotes, appointmentId = null) {
  await upsertRow('soap_notes', soapColumns(soapNoteIdFor(appointmentId), soapNotes, appointmentId));
  return getSoapNote(null, appointmentId);
}

export async function getConsultantNotes(patientId = null, providerId = null, userId = null) {
  if (patientId) {
    const rows = await query(
      'SELECT * FROM consultant_notes WHERE patient_id = ? ORDER BY created_at DESC, id DESC',
      [patientId]
    );
    return rows.map(mapConsultantNote);
  }
  if (providerId) {
    const rows = await query(
      `SELECT DISTINCT n.* FROM consultant_notes n
         JOIN appointments a ON a.patient_id = n.patient_id
        WHERE a.provider_id = ? OR a.claimed_by_user_id = ?
        ORDER BY n.created_at DESC, n.id DESC`,
      [providerId, userId ?? null]
    );
    return rows.map(mapConsultantNote);
  }
  const rows = await query('SELECT * FROM consultant_notes ORDER BY created_at DESC, id DESC');
  return rows.map(mapConsultantNote);
}

export async function createConsultantNote(note) {
  const record = { ...note, createdAt: note.createdAt || new Date().toISOString() };
  await insertRow('consultant_notes', consultantNoteColumns(record));
  return record;
}

export async function getConsultationRequests(patientId = null, providerId = null, userId = null) {
  if (patientId) {
    const rows = await query(
      'SELECT * FROM consultation_requests WHERE patient_id = ? ORDER BY created_at DESC, id DESC',
      [patientId]
    );
    return rows.map(mapConsultationRequest);
  }
  if (providerId) {
    const rows = await query(
      `SELECT DISTINCT r.* FROM consultation_requests r
         JOIN appointments a ON a.patient_id = r.patient_id
        WHERE a.provider_id = ? OR a.claimed_by_user_id = ?
        ORDER BY r.created_at DESC, r.id DESC`,
      [providerId, userId ?? null]
    );
    return rows.map(mapConsultationRequest);
  }
  const rows = await query('SELECT * FROM consultation_requests ORDER BY created_at DESC, id DESC');
  return rows.map(mapConsultationRequest);
}

export async function getConsultationRequestRow(id) {
  return queryOne('SELECT * FROM consultation_requests WHERE id = ?', [id]);
}

export async function createConsultationRequest(request) {
  const record = { ...request, createdAt: request.createdAt || new Date().toISOString(), status: 'pending' };
  await insertRow('consultation_requests', consultationRequestColumns(record));
  return record;
}

export async function getReferrals(patientId = null, providerId = null, userId = null) {
  if (patientId) {
    const rows = await query(
      'SELECT * FROM referrals WHERE patient_id = ? ORDER BY created_at DESC, id DESC',
      [patientId]
    );
    return rows.map(mapReferral);
  }
  if (providerId) {
    const rows = await query(
      `SELECT DISTINCT r.* FROM referrals r
         JOIN appointments a ON a.patient_id = r.patient_id
        WHERE a.provider_id = ? OR a.claimed_by_user_id = ?
        ORDER BY r.created_at DESC, r.id DESC`,
      [providerId, userId ?? null]
    );
    return rows.map(mapReferral);
  }
  const rows = await query('SELECT * FROM referrals ORDER BY created_at DESC, id DESC');
  return rows.map(mapReferral);
}

export async function getReferralRow(id) {
  return queryOne('SELECT * FROM referrals WHERE id = ?', [id]);
}

export async function createReferral(referral) {
  const record = {
    ...referral,
    createdAt: referral.createdAt || new Date().toISOString(),
    status: 'pending',
  };
  await insertRow('referrals', referralColumns(record));
  return record;
}

const ALLOWED_REFERRAL_STATUSES = new Set(['accepted', 'declined', 'completed']);

export async function updateReferralStatus(id, status, reviewedBy = null) {
  if (!ALLOWED_REFERRAL_STATUSES.has(status)) return null;
  const current = await queryOne('SELECT * FROM referrals WHERE id = ?', [id]);
  if (!current) return null;
  // Legal transitions: pending -> accepted/declined, accepted -> completed.
  // Completed/declined are terminal; pending cannot jump straight to completed.
  const from = current.status;
  const legal =
    (from === 'pending' && (status === 'accepted' || status === 'declined')) ||
    (from === 'accepted' && status === 'completed');
  if (!legal) return null;
  await query(
    'UPDATE referrals SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    [status, reviewedBy, new Date().toISOString(), id]
  );
  const row = await queryOne('SELECT * FROM referrals WHERE id = ?', [id]);
  return row ? mapReferral(row) : null;
}

const ALLOWED_FOLLOW_UP_STATUSES = new Set(['Active', 'Closed', 'Pending']);

export async function updateFollowUpStatus(id, status) {
  if (!ALLOWED_FOLLOW_UP_STATUSES.has(status)) return null;
  await query('UPDATE follow_ups SET status = ? WHERE id = ?', [status, id]);
  const row = await queryOne('SELECT * FROM follow_ups WHERE id = ?', [id]);
  return row ? mapFollowUp(row) : null;
}

const ALLOWED_REQUEST_STATUSES = new Set(['accepted', 'declined']);

export async function updateConsultationRequestStatus(id, status, reviewedBy = null) {
  if (!ALLOWED_REQUEST_STATUSES.has(status)) return null;
  await query(
    'UPDATE consultation_requests SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    [status, reviewedBy, new Date().toISOString(), id]
  );
  const row = await queryOne('SELECT * FROM consultation_requests WHERE id = ?', [id]);
  return row ? mapConsultationRequest(row) : null;
}

// ---------------------------------------------------------------------------
// Tele-visit room control plane: guest roster + WebRTC signaling relay
// ---------------------------------------------------------------------------

export async function getVisitGuests(appointmentId) {
  const rows = await query(
    'SELECT * FROM visit_guests WHERE appointment_id = ? ORDER BY created_at, id',
    [appointmentId]
  );
  return rows.map(mapVisitGuest);
}

export async function createVisitGuest(guest) {
  await insertRow('visit_guests', {
    id: guest.id,
    appointment_id: guest.appointmentId,
    name: guest.name,
    role: guest.role,
    invited_by: guest.invitedBy,
    created_at: isoToUtcDateTime(guest.createdAt) || isoToUtcDateTime(new Date().toISOString()),
  });
  return guest;
}

export async function deleteVisitGuest(appointmentId, guestId) {
  const result = await query(
    'DELETE FROM visit_guests WHERE appointment_id = ? AND id = ?',
    [appointmentId, guestId]
  );
  return Number(result?.affectedRows ?? 0) > 0;
}

/**
 * Appends one WebRTC control message (SDP / ICE / presence) to the visit's
 * relay. The payload is stored as opaque JSON; media never reaches the API.
 */
export async function insertRoomSignal({ appointmentId, senderId, senderRole, senderName, kind, payload }) {
  const result = await query(
    `INSERT INTO room_signals
       (appointment_id, sender_id, sender_role, sender_name, kind, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [
      appointmentId,
      senderId,
      senderRole,
      senderName,
      kind,
      payload == null ? null : JSON.stringify(payload),
    ]
  );
  return { id: Number(result?.insertId ?? 0) };
}

/**
 * Drops relay rows for one visit older than the retention window. Runs at most
 * once per window per visit (50 pairs x per-signal prune = a DELETE storm, and
 * every DELETE competes with the 1.5s signaling polls for the same rows).
 */
const signalPruneAt = new Map();
export async function pruneRoomSignals(appointmentId, retentionSeconds = 600) {
  const now = Date.now();
  const last = signalPruneAt.get(appointmentId) ?? 0;
  if (now - last < Math.max(60_000, Math.min(Number(retentionSeconds) || 600, 600) * 1000)) return;
  signalPruneAt.set(appointmentId, now);
  if (signalPruneAt.size > 1000) {
    const oldest = signalPruneAt.keys().next();
    if (!oldest.done) signalPruneAt.delete(oldest.value);
  }
  await query(
    'DELETE FROM room_signals WHERE appointment_id = ? AND created_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)',
    [appointmentId, Math.max(60, Number(retentionSeconds) || 600)]
  );
}

/**
 * Signals newer than `afterId` for the visit, in id order — including the
 * caller's own rows, so the client can advance its cursor to an exact id
 * without losing messages that raced the read.
 */
export async function getRoomSignalsSince(appointmentId, afterId, limit = 200) {
  const cap = String(Math.min(Math.max(Number(limit) || 200, 1), 500));
  const rows = await query(
    `SELECT * FROM room_signals
     WHERE appointment_id = ? AND id > ?
     ORDER BY id LIMIT ?`,
    [appointmentId, Math.max(0, Math.floor(Number(afterId) || 0)), cap]
  );
  return rows.map(mapRoomSignal);
}

/**
 * Recent join/ping rows from the other participants: the room's presence
 * channel. A peer that stopped sending heartbeats simply ages out of the
 * window, so "connected" is never assumed from stale state.
 */
// ---------------------------------------------------------------------------
// HCW@Home parity: patient invite links, shared waiting room, attachments
// ---------------------------------------------------------------------------

/** Mints a single-use, expiring patient invitation for one visit. */
export async function createVisitInvite(invite) {
  await insertRow('visit_invites', {
    token: invite.token,
    appointment_id: invite.appointmentId,
    channel: invite.channel,
    created_by: invite.createdBy,
    created_at: isoToUtcDateTime(invite.createdAt) || isoToUtcDateTime(new Date().toISOString()),
    expires_at: isoToUtcDateTime(invite.expiresAt) || isoToUtcDateTime(new Date().toISOString()),
    revoked: 0,
  });
  return invite;
}

/** Raw invite row (policy checks need appointment_id/expires_at/revoked). */
export async function getVisitInviteRow(token) {
  return queryOne('SELECT * FROM visit_invites WHERE token = ?', [token]);
}

/** Revokes every live invite for one visit (re-issuing supersedes them). */
export async function revokeVisitInvites(appointmentId) {
  await query('UPDATE visit_invites SET revoked = 1 WHERE appointment_id = ? AND revoked = 0', [appointmentId]);
}

/**
 * Clinic-wide waiting room (HCW@Home "waiting rooms dispatched across several
 * doctors"): every checked-in visit, whoever it is booked with, so any
 * available clinician can pick up a waiting patient. Not provider-scoped by
 * design — that is the whole point of a shared queue.
 */
export async function getWaitingRoom() {
  const rows = await query(
    `SELECT * FROM appointments WHERE status = 'in-progress' ORDER BY scheduled_start_utc, id`
  );
  return rows.map(mapAppointment);
}

/**
 * Claims a waiting visit for the calling clinician. Idempotent per visit: the
 * first claim wins, a second claim by another account is refused (returns
 * null). The booked provider is preserved; only the claim bookkeeping moves.
 */
export async function claimWaitingVisit(id, { userId, name }) {
  const current = await queryOne('SELECT * FROM appointments WHERE id = ?', [id]);
  if (!current) return null;
  if (current.status !== 'in-progress') return null;
  if (current.claimed_by_user_id && current.claimed_by_user_id !== userId) return null;
  await query(
    'UPDATE appointments SET claimed_by_user_id = ?, claimed_by_name = ?, claimed_at = UTC_TIMESTAMP() WHERE id = ?',
    [userId, name, id]
  );
  const row = await queryOne('SELECT * FROM appointments WHERE id = ?', [id]);
  return row ? mapAppointment(row) : null;
}

/** In-visit attachments for one visit, oldest first. */
export async function getVisitAttachments(appointmentId) {
  const rows = await query(
    'SELECT * FROM visit_attachments WHERE appointment_id = ? ORDER BY created_at, id',
    [appointmentId]
  );
  return rows.map(mapVisitAttachment);
}

/** Stores one attachment (file name and content encrypted at rest). */
export async function createVisitAttachment(attachment) {
  await insertRow('visit_attachments', visitAttachmentColumns(attachment));
  return attachment;
}

/**
 * Anonymised, clinic-level usage statistics (HCW@Home "anonymised statistics").
 * Every value is an aggregate COUNT over operational columns — no chart
 * identifiers, names, MRNs or free text ever leave this function.
 */
export async function getClinicStats() {
  const [
    visitTotals,
    visitByType,
    activePrescriptions,
    pendingRequests,
    referralTotals,
    labTotals,
    auditTotal,
    providerTotal,
    inviteTotal,
    attachmentTotal,
  ] = await Promise.all([
    query('SELECT status, COUNT(*) AS count FROM appointments GROUP BY status'),
    query('SELECT type, COUNT(*) AS count FROM appointments GROUP BY type'),
    query("SELECT COUNT(*) AS count FROM prescriptions WHERE status = 'active'"),
    query("SELECT COUNT(*) AS count FROM consultation_requests WHERE status = 'pending'"),
    query('SELECT status, COUNT(*) AS count FROM referrals GROUP BY status'),
    query("SELECT status, COUNT(*) AS count FROM lab_results GROUP BY status"),
    query('SELECT COUNT(*) AS count FROM audit_logs'),
    query('SELECT COUNT(*) AS count FROM providers'),
    query('SELECT COUNT(*) AS count FROM visit_invites'),
    query('SELECT COUNT(*) AS count FROM visit_attachments'),
  ]);

  const toCountMap = (rows) =>
    Object.fromEntries(rows.map((row) => [row.status ?? row.type, Number(row.count)]));

  const byStatus = toCountMap(visitTotals);
  const byType = toCountMap(visitByType);
  const totalVisits = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
  const completed = byStatus.completed ?? 0;
  const waiting = byStatus['in-progress'] ?? 0;

  return {
    totalVisits,
    byStatus: {
      scheduled: byStatus.scheduled ?? 0,
      inProgress: waiting,
      completed,
      cancelled: byStatus.cancelled ?? 0,
    },
    byType,
    completionRate: totalVisits === 0 ? 0 : Math.round((completed / totalVisits) * 100),
    activePrescriptions: Number(activePrescriptions[0]?.count ?? 0),
    pendingConsultationRequests: Number(pendingRequests[0]?.count ?? 0),
    referrals: {
      pending: toCountMap(referralTotals).pending ?? 0,
      accepted: toCountMap(referralTotals).accepted ?? 0,
      completed: toCountMap(referralTotals).completed ?? 0,
      declined: toCountMap(referralTotals).declined ?? 0,
    },
    labs: {
      normal: toCountMap(labTotals).normal ?? 0,
      abnormal: toCountMap(labTotals).abnormal ?? 0,
      critical: toCountMap(labTotals).critical ?? 0,
    },
    auditEvents: Number(auditTotal[0]?.count ?? 0),
    providers: Number(providerTotal[0]?.count ?? 0),
    invitesIssued: Number(inviteTotal[0]?.count ?? 0),
    attachmentsShared: Number(attachmentTotal[0]?.count ?? 0),
    generatedAt: new Date().toISOString(),
  };
}

export async function getRoomPresence(appointmentId, excludeSenderId, withinSeconds = 30) {
  const rows = await query(
    `SELECT * FROM room_signals
     WHERE appointment_id = ? AND sender_id <> ? AND kind IN ('join','ping')
       AND created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
     ORDER BY id DESC LIMIT 20`,
    [appointmentId, excludeSenderId, Math.max(5, Number(withinSeconds) || 30)]
  );
  const seen = new Set();
  const presence = [];
  for (const row of rows) {
    const signal = mapRoomSignal(row);
    const key = `${signal.senderId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    presence.push(signal);
  }
  return presence;
}
