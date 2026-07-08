/**
 * DELIVERY SERVICE — how results reach the client.
 * ─────────────────────────────────────────────────────────────────
 * Today: one strategy — 'poll' (result persisted; client GETs it).
 * Later: 'webhook' push to PMS endpoints (signed, retried, DLQ'd)
 * and per-tenant configuration. New modes are new strategy classes;
 * callers never change.
 */
import { Injectable } from '@nestjs/common';
import { logger } from '../../common/redacting-logger';

export interface DeliveryStrategy {
  readonly mode: 'poll' | 'webhook';
  deliver(tenantId: string, transactionId: string, outcome: unknown): Promise<void>;
}

class PollDelivery implements DeliveryStrategy {
  readonly mode = 'poll' as const;
  async deliver(tenantId: string, transactionId: string): Promise<void> {
    // Result already persisted in the ledger — polling endpoint serves it.
    logger.info({ tenantId, transactionId, mode: 'poll' }, 'result available for poll');
  }
}

@Injectable()
export class DeliveryService {
  private readonly strategies: DeliveryStrategy[] = [new PollDelivery()];

  async deliver(tenantId: string, transactionId: string, outcome: unknown): Promise<void> {
    // Later: look up tenant delivery config; select strategy accordingly.
    await this.strategies[0].deliver(tenantId, transactionId, outcome);
  }
}
