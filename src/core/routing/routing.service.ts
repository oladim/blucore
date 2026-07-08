/**
 * ROUTING ENGINE — payer → network resolution.
 * One row per payer today (Stedi). Adding network #2 is a config
 * row, not a code change. Directory is Redis-cached: it's read on
 * EVERY transaction and changes rarely.
 */
import { Injectable, ServiceUnavailableException, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { DbService } from '../../tenancy/db.service';
import { NetworkRegistry } from '../../networks/network.registry';
import { ClearinghouseNetwork } from '../../networks/network.interface';
import { CircuitBreaker } from '../../common/circuit-breaker';
import { TransactionType } from '../../canonical/common';

const CACHE_TTL_SEC = 300;

interface Route { network: string; priority: number; config: Record<string, unknown> }

@Injectable()
export class RoutingService {
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly db: DbService,
    private readonly redis: Redis,
    private readonly registry: NetworkRegistry,
  ) {}

  breaker(network: string): CircuitBreaker {
    let b = this.breakers.get(network);
    if (!b) { b = new CircuitBreaker(network); this.breakers.set(network, b); }
    return b;
  }

  async route(payerId: string, type: TransactionType): Promise<{
    network: ClearinghouseNetwork; config: Record<string, unknown>;
  }> {
    const routes = await this.routesFor(payerId, type);
    if (routes.length === 0) {
      throw new NotFoundException(`Payer ${payerId} does not support ${type}`);
    }
    for (const r of routes) {
      if (this.breaker(r.network).isAvailable()) {
        return { network: this.registry.get(r.network), config: r.config };
      }
    }
    throw new ServiceUnavailableException(
      `All networks for payer ${payerId} are temporarily unavailable`,
    );
  }

  private async routesFor(payerId: string, type: TransactionType): Promise<Route[]> {
    const cacheKey = `routes:${payerId}:${type}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Payer directory is shared reference data — not tenant-scoped.
    const rows = await this.db.referenceQuery<Route>(
      `SELECT network, priority, config FROM payer_routes
       WHERE payer_id = $1 AND $2 = ANY(transaction_types) AND status = 'active'
       ORDER BY priority ASC`,
      [payerId, type],
    );
    await this.redis.set(cacheKey, JSON.stringify(rows), 'EX', CACHE_TTL_SEC);
    return rows;
  }

  /** Admin invalidation hook — call whenever routes change. */
  async invalidate(payerId: string): Promise<void> {
    await this.redis.del(`routes:${payerId}:eligibility`, `routes:${payerId}:claim_status`);
  }
}
