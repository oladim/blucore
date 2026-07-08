import { Controller, Get } from '@nestjs/common';
import Redis from 'ioredis';
import { DbService } from './tenancy/db.service';

@Controller()
export class HealthController {
  constructor(private readonly db: DbService, private readonly redis: Redis) {}

  /** Liveness — process is up. */
  @Get('health')
  health() { return { status: 'ok' }; }

  /** Readiness — dependencies reachable. K8s gates traffic on this. */
  @Get('ready')
  async ready() {
    await this.db.referenceQuery('SELECT 1');
    await this.redis.ping();
    return { status: 'ready' };
  }
}
