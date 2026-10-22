/**
 * MedZone backend entry point.
 *
 *   npm run server        # start the API on PORT (default 3001)
 *   npm run server:dev    # start with Node's file watcher
 *
 * Concurrency: set WORKERS=N to fork N processes via node:cluster (one event
 * loop per core). Each worker holds its own MySQL pool, so keep
 *   DB_POOL_SIZE x WORKERS < MySQL max_connections (compose sets 300).
 * Single-process mode (WORKERS unset/1) is unchanged and best for dev.
 *
 * Requires a MySQL instance; see docker-compose.yml and npm run db:setup.
 */
import 'dotenv/config';
import cluster from 'node:cluster';
import os from 'node:os';
import app from './server/app.js';
import { closePool, isDatabaseReachable } from './server/db.js';
import { getJwtSecret } from './server/auth.js';
import { getPhiSecret } from './server/crypto.js';
import { isMfaRequired } from './server/totp.js';

const port = Number(process.env.PORT || 3001);
const workers = Math.max(1, Number(process.env.WORKERS || 1));

if (workers > 1 && cluster.isPrimary) {
  const count = Math.min(workers, os.cpus().length);
  console.log(`[medzone-api] primary ${process.pid} forking ${count} workers`);
  for (let i = 0; i < count; i += 1) cluster.fork();
  cluster.on('exit', (worker, code) => {
    console.warn(`[medzone-api] worker ${worker.process.pid} exited (${code}), reforking`);
    cluster.fork();
  });
  const stopAll = (signal) => {
    console.log(`[medzone-api] primary received ${signal}, stopping workers`);
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill(signal);
  };
  process.on('SIGINT', () => stopAll('SIGINT'));
  process.on('SIGTERM', () => stopAll('SIGTERM'));
} else {
  // Fail fast on missing or placeholder production secrets. The same checks
  // run lazily per request, but a server that listens first and then 500s
  // every request is worse than one that refuses to boot.
  try {
    getJwtSecret();
    getPhiSecret();
  } catch (err) {
    console.error(`[medzone-api] refusing to start: ${err.message}`);
    process.exit(1);
  }

  const server = app.listen(port, async () => {
    console.log(`[medzone-api] listening on http://localhost:${port} (pid ${process.pid})`);
    console.log(
      `[medzone-api] MFA (TOTP) enforcement: ${
        isMfaRequired()
          ? 'ENABLED — each account enrolls its own authenticator'
          : 'disabled — set MFA_REQUIRED=true to require a second factor'
      }`
    );
    const reachable = await isDatabaseReachable();
    if (reachable) {
      console.log('[medzone-api] MySQL connection established');
    } else {
      console.warn(
        '[medzone-api] MySQL is UNREACHABLE. Start it with `docker compose up -d`, ' +
          'then run `npm run db:setup`. The React client will show empty states until then.'
      );
    }
  });

  const shutdown = async (signal) => {
    console.log(`[medzone-api] received ${signal}, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
