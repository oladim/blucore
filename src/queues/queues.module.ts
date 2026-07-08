/**
 * QUEUES — load leveling + per-network rate control.
 * The Stedi outbound queue's limiter sits just under the contracted
 * rate: you can scale API pods infinitely, but payers throttle YOU.
 * Network #2 gets its own queue + limiter.
 */
import { Global, Inject, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export const REDIS = 'REDIS';
export const STEDI_OUTBOUND_QUEUE = 'STEDI_OUTBOUND_QUEUE';
export const INBOUND_QUEUE = 'INBOUND_QUEUE';

export const InjectRedis = () => Inject(REDIS);
export const InjectInboundQueue = () => Inject(INBOUND_QUEUE);

const redisProvider = {
  provide: REDIS,
  useFactory: () => new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
  }),
};

const stediOutbound = {
  provide: STEDI_OUTBOUND_QUEUE,
  useFactory: (redis: Redis) => new Queue('stedi-outbound', { connection: redis }),
  inject: [REDIS],
};

const inbound = {
  provide: INBOUND_QUEUE,
  useFactory: (redis: Redis) => new Queue('inbound-webhooks', { connection: redis }),
  inject: [REDIS],
};

@Global()
@Module({
  providers: [redisProvider, stediOutbound, inbound,
    { provide: Redis, useExisting: REDIS }],
  exports: [REDIS, STEDI_OUTBOUND_QUEUE, INBOUND_QUEUE, Redis],
})
export class QueuesModule {}
