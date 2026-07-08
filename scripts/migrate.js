/* Minimal forward-only migration runner. Swap for node-pg-migrate
 * or drizzle-kit when migrations multiply. */
const { readdirSync, readFileSync } = require('fs');
const { join } = require('path');
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY, applied_at timestamptz DEFAULT now())`);
  const applied = new Set(
    (await client.query('SELECT name FROM _migrations')).rows.map((r) => r.name),
  );
  const dir = join(__dirname, '..', 'db', 'migrations');
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.sql') || applied.has(file)) continue;
    console.log(`applying ${file}`);
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  }
  await client.end();
  console.log('migrations complete');
})().catch((e) => { console.error(e); process.exit(1); });
