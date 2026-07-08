/**
 * Inbound async results (277s). Verified, then queued — webhook
 * handlers must return fast; processing happens in the worker tier.
 */
import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { StediAdapter } from './stedi.adapter';
import { InjectInboundQueue } from '../../queues/queues.module';

@Controller('v1/webhooks/stedi')
export class StediWebhookController {
  constructor(
    private readonly stedi: StediAdapter,
    @InjectInboundQueue() private readonly inbound: Queue,
  ) {}

  @Post()
  @HttpCode(202)
  async receive(@Headers() headers: Record<string, string>, @Body() body: any) {
    const raw = JSON.stringify(body);
    if (!this.stedi.verifyWebhook(headers, raw)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    await this.inbound.add('stedi-inbound', { raw }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 1000,
    });
    return { accepted: true };
  }
}
