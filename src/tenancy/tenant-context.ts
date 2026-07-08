/** Per-request tenant context, carried via AsyncLocalStorage so any
 *  layer (repos, audit, logger) can read it without prop-drilling. */
import { AsyncLocalStorage } from 'async_hooks';
import { OriginChannel } from '../canonical/common';

export interface TenantContext {
  tenantId: string;
  channel: OriginChannel;
  initiatorRef: string;       // api_key id | patient_identity id | user id
  scopes: string[];
  correlationId: string;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

export function requireTenant(): TenantContext {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new Error('No tenant context — request bypassed auth guard');
  return ctx;
}
