/**
 * WORKER TIER — BullMQ consumers.
 * stedi-outbound: rate-limited to contracted throughput (backpressure
 * lives HERE, not in ad-hoc sleeps). inbound-webhooks: async 277
 * processing → ledger completion → delivery.
 */
import { INestApplicationContext } from '@nestjs/common';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { REDIS } from './queues.module';
import { logger } from '../common/redacting-logger';

export async function startWorkers(app: INestApplicationContext): Promise<Worker[]> {
  const connection = app.get<Redis>(REDIS);

  const inbound = new Worker(
    'inbound-webhooks',
    async (job) => {
      // TODO: parse Stedi async 277 payload → fromStedi277 →
      // resolve tx by correlation/control number → ledger.completeAsync
      // → DeliveryService.deliver
      logger.info({ jobId: job.id }, 'processing inbound webhook');
    },
    { connection, concurrency: 16 },
  );

  const outbound = new Worker(
    'stedi-outbound',
    async (job) => {
      // Batch/deferred submissions when volume demands (overnight
      // verification runs). Real-time path stays in the API tier.
      logger.info({ jobId: job.id }, 'processing outbound job');
    },
    {
      connection,
      concurrency: 32,
      limiter: {
        max: Number(process.env.STEDI_RATE_LIMIT_PER_SEC ?? 8),
        duration: 1_000,
      },
    },
  );

  return [inbound, outbound];
}
