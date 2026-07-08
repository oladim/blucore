/**
 * CHANNEL-AWARE AUTHENTICATION
 * ─────────────────────────────────────────────────────────────────
 *  pms      → X-Api-Key header  → hashed lookup, scopes, per-key rate limit
 *  patient  → Bearer JWT        → patient_identity; may ONLY query coverage
 *                                 bound to their own verified identity
 *  internal → Bearer JWT (staff)→ role-based access within tenant
 *
 * On success: populates AsyncLocalStorage tenant context. The DB
 * layer then issues `SET LOCAL app.tenant_id` per transaction so
 * Postgres RLS backstops every query.
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { tenantContext, TenantContext } from './tenant-context';
import { DbService } from './db.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly db: DbService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    const apiKey = req.headers['x-api-key'];
    let ctx: TenantContext;

    if (typeof apiKey === 'string') {
      ctx = await this.authenticateApiKey(apiKey, req.correlationId);
    } else if (typeof req.headers.authorization === 'string') {
      ctx = await this.authenticateJwt(req.headers.authorization, req.correlationId);
    } else {
      throw new UnauthorizedException('Missing credentials');
    }

    // Populate the context opened by CorrelationMiddleware.
    const store = tenantContext.getStore();
    if (!store) throw new UnauthorizedException('Request context missing');
    Object.assign(store, ctx);
    return true;
  }

  private async authenticateApiKey(raw: string, correlationId: string): Promise<TenantContext> {
    const hashed = createHash('sha256').update(raw).digest('hex');
    // Auth lookup runs via a SECURITY DEFINER path (tenant unknown pre-auth).
    const row = await this.db.authQuery(
      `SELECT id, tenant_id, scopes FROM api_keys
       WHERE hashed_key = $1 AND status = 'active'
         AND (expires_at IS NULL OR expires_at > now())`,
      [hashed],
    );
    if (!row) throw new UnauthorizedException('Invalid API key');
    return {
      tenantId: row.tenant_id,
      channel: 'pms',
      initiatorRef: row.id,
      scopes: row.scopes,
      correlationId,
    };
  }

  private async authenticateJwt(header: string, correlationId: string): Promise<TenantContext> {
    // TODO: verify signature against your IdP JWKS (issuer/audience from env).
    // Distinguish patient tokens (claim channel=patient, sub → patient_identities)
    // from staff tokens (channel=internal, roles claim).
    throw new UnauthorizedException('JWT auth not yet configured');
  }
}
