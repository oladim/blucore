/**
 * Single image, two run modes (independent horizontal scaling):
 *   WORKER_MODE=false → HTTP API (stateless; scale on p95/conn count)
 *   WORKER_MODE=true  → BullMQ consumers (scale on queue depth)
 */
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { logger } from './common/redacting-logger';
import { startWorkers } from './queues/workers';

async function bootstrap() {
  if (process.env.WORKER_MODE === 'true') {
    const app = await NestFactory.createApplicationContext(AppModule);
    await startWorkers(app);
    logger.info('worker tier started');
    return;
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576 }), // 1MB — eligibility payloads are small
  );
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  logger.info({ port }, 'api tier started');
}

bootstrap().catch((err) => {
  logger.fatal({ err: err?.message }, 'boot failure');
  process.exit(1);
});
