/**
 * DB ACCESS WITH RLS ENFORCEMENT
 * Every tenant-scoped statement runs inside a transaction that first
 * executes `SET LOCAL app.tenant_id = $tenant`. Combined with RLS
 * policies, cross-tenant reads are impossible even from buggy SQL.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { requireTenant } from './tenant-context';

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  });

  /** Tenant-scoped query — RLS active. Use for ALL PHI-bearing tables. */
  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { tenantId } = requireTenant();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${tenantId.replace(/'/g, '')}'`);
      const res = await client.query(sql, params);
      await client.query('COMMIT');
      return res.rows as T[];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Shared reference data (payers, payer_routes) — not tenant-scoped, no RLS. */
  async referenceQuery<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  /** Pre-auth lookups only (api key resolution). Never expose to handlers. */
  async authQuery(sql: string, params: unknown[]): Promise<any | null> {
    const res = await this.pool.query(sql, params);
    return res.rows[0] ?? null;
  }

  /** System-scoped (worker jobs that already carry explicit tenant). */
  async systemQuery<T = any>(tenantId: string, sql: string, params: unknown[] = []): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.tenant_id = '${tenantId.replace(/'/g, '')}'`);
      const res = await client.query(sql, params);
      await client.query('COMMIT');
      return res.rows as T[];
    } finally {
      client.release();
    }
  }

  onModuleDestroy() { return this.pool.end(); }
}
