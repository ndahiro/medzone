/**
 * MedZone backend - MySQL connection pool.
 *
 * Uses mysql2/promise with `dateStrings` enabled so DATE/DATETIME values come
 * back as the exact strings stored in MySQL. That avoids Node implicitly
 * re-interpreting them in the host timezone, which matters for clinical
 * timestamps.
 *
 * Concurrency sizing: one bootstrap costs ~10 pooled queries, so size the
 * pool for peak concurrent users, not total users. Rule of thumb:
 *   DB_POOL_SIZE x WORKERS < MySQL max_connections (compose sets 300).
 * The default below (25) sustains a 500-user burst on a single worker with
 * queueing; raise it (and WORKERS) for headroom. See .env.example.
 *
 * 50-pair note: bcrypt (login) and PBKDF2 (PHI decrypt) are CPU-bound and run
 * on the event loop. 100 near-simultaneous logins on ONE process starve the
 * loop so MySQL handshakes hit connectTimeout even though the database is
 * healthy. Production for this tier is WORKERS=4 (see .env.example) — the pool
 * below only controls MySQL concurrency, not CPU. Warm the pool at boot so
 * the first burst does not also pay TCP+TLS handshake latency.
 */
import mysql from 'mysql2/promise';

export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'medzone',
  password: process.env.DB_PASSWORD || 'medzone',
  database: process.env.DB_NAME || 'medzone',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 25),
  queueLimit: 0,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000),
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
  charset: 'utf8mb4_unicode_ci',
};

const pool = mysql.createPool(dbConfig);

/** Pre-opens pool connections so the first burst skips handshake latency. */
export async function warmPool() {
  const target = Math.min(
    Number(process.env.DB_POOL_SIZE || 25),
    25
  );
  await Promise.allSettled(
    Array.from({ length: Math.max(1, target) }, () => pool.query('SELECT 1'))
  );
}

/** Runs a parameterized query and returns the rows (SELECT) or result (DML). */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/** Runs a query returning only the first row, or null. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] ?? null;
}

/** Verifies the pool can reach MySQL; used by the health endpoint. */
export async function isDatabaseReachable() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool() {
  await pool.end();
}
