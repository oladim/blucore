/**
 * IDEMPOTENCY — Redis-backed with in-flight locking.
 * Duplicate POSTs (client retries under load) return the original
 * result instead of generating duplicate billable Stedi transactions.
 */
import { Injectable, ConflictException } from '@nestjs/common';
import Redis from 'ioredis';

const TTL_SECONDS = 60 * 60 * 24; // 24h result retention
const LOCK_TTL_MS = 65_000;       // > max downstream timeout

@Injectable()
export class IdempotencyService {
  constructor(private readonly redis: Redis) {}

  private key(tenantId: string, k: string) { return `idem:${tenantId}:${k}`; }

  /** Returns cached result if replay; acquires lock if first-seen. */
  async begin(tenantId: string, idemKey: string): Promise<{ replay: unknown } | { lock: true }> {
    const key = this.key(tenantId, idemKey);
    const existing = await this.redis.get(key);
    if (existing) {
      const parsed = JSON.parse(existing);
      if (parsed.state === 'in_flight') {
        throw new ConflictException('Request with this Idempotency-Key is already in flight');
      }
      return { replay: parsed.result };
    }
    const acquired = await this.redis.set(
      key, JSON.stringify({ state: 'in_flight' }), 'PX', LOCK_TTL_MS, 'NX',
    );
    if (!acquired) throw new ConflictException('Request with this Idempotency-Key is already in flight');
    return { lock: true };
  }

  async complete(tenantId: string, idemKey: string, result: unknown): Promise<void> {
    await this.redis.set(
      this.key(tenantId, idemKey),
      JSON.stringify({ state: 'done', result }),
      'EX', TTL_SECONDS,
    );
  }

  async release(tenantId: string, idemKey: string): Promise<void> {
    await this.redis.del(this.key(tenantId, idemKey));
  }
}
