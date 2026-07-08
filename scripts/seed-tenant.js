/* Usage: node --env-file=.env scripts/seed-tenant.js "Practice Name" [plaintext-key]
 * Creates a tenant + hashed API key. Prints the plaintext key ONCE. */
const { Client } = require('pg');
const { createHash, randomBytes } = require('crypto');

(async () => {
  const name = process.argv[2];
  if (!name) { console.error('Usage: node scripts/seed-tenant.js "Practice Name" [key]'); process.exit(1); }

  const plaintext = process.argv[3] ?? randomBytes(24).toString('base64url');
  const hashed = createHash('sha256').update(plaintext).digest('hex');

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const t = await db.query(
    `INSERT INTO tenants (name, kind) VALUES ($1, 'practice') RETURNING id`, [name]);
  const tenantId = t.rows[0].id;

  await db.query(
    `INSERT INTO api_keys (tenant_id, hashed_key, label, scopes)
     VALUES ($1, $2, 'seeded key', '{eligibility:write,transactions:read}')`,
    [tenantId, hashed]);

  await db.end();
  console.log(`Tenant:  ${name}`);
  console.log(`ID:      ${tenantId}`);
  console.log(`API key: ${plaintext}   <-- shown ONCE, save it now`);
})().catch((e) => { console.error(e.message); process.exit(1); });