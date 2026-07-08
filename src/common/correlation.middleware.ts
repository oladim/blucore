/** Opens the per-request context (correlation id now; tenant filled
 *  in by the auth guard) for the ENTIRE request via AsyncLocalStorage. */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { tenantContext, TenantContext } from '../tenancy/tenant-context';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const incoming = req.headers['x-correlation-id'];
    const correlationId =
      typeof incoming === 'string' && /^[0-9a-f-]{36}$/i.test(incoming)
        ? incoming
        : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('x-correlation-id', correlationId);

    const ctx: Partial<TenantContext> = { correlationId };
    tenantContext.run(ctx as TenantContext, () => next());
  }
}
