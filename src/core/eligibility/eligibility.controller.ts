import {
  Body, Controller, Get, Headers, HttpCode, NotFoundException,
  Param, ParseUUIDPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../../tenancy/auth.guard';
import { requireTenant } from '../../tenancy/tenant-context';
import { EligibilityService } from './eligibility.service';
import { LedgerService } from '../transactions/ledger.service';
import { IdempotencyService } from '../../common/idempotency.service';
import { EligibilityOutcome } from '../../canonical/eligibility';

const InquirySchema = z.object({
  payer: z.object({ id: z.string().uuid() }),
  provider: z.object({
    npi: z.string().regex(/^\d{10}$/),
    organizationName: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    taxId: z.string().optional(),
  }),
  subscriber: z.object({
    memberId: z.string().min(1),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    groupNumber: z.string().optional(),
  }),
  dependent: z.object({
    firstName: z.string(),
    lastName: z.string(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    relationshipCode: z.enum(['01', '19', '34', 'G8']).optional(),
  }).optional(),
  serviceTypeCodes: z.array(z.string()).default(['30']),
  dateOfService: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

@Controller('v1/eligibility-checks')
@UseGuards(AuthGuard)
export class EligibilityController {
  constructor(
    private readonly eligibility: EligibilityService,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: unknown,
    @Headers('idempotency-key') idemKey?: string,
  ) {
    const input = InquirySchema.parse(body);
    const { tenantId } = requireTenant();

    if (idemKey) {
      const state = await this.idempotency.begin(tenantId, idemKey);
      if ('replay' in state) return state.replay;
      try {
        const result = await this.eligibility.check(input);
        const payload = { transactionId: result.transactionId, ...result.outcome };
        await this.idempotency.complete(tenantId, idemKey, payload);
        return payload;
      } catch (e) {
        await this.idempotency.release(tenantId, idemKey);
        throw e;
      }
    }

    const result = await this.eligibility.check(input);
    return { transactionId: result.transactionId, ...result.outcome };
  }


  /** Worklist for the verification screen (display fields only). */
  @Get()
  async list(@Query('from') from?: string, @Query('to') to?: string) {
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    return this.ledger.listEligibilityDisplay(
      100,
      from && dateRe.test(from) ? from : undefined,
      to && dateRe.test(to) ? to : undefined,
    );
  }

  /** Resubmit a past inquiry as a new transaction (server-side PHI). */
  @Post(':id/reverify')
  @HttpCode(201)
  async reverify(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.eligibility.reverify(id);
    return { transactionId: result.transactionId, ...result.outcome };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const outcome = await this.ledger.getOutcome<EligibilityOutcome>(id);
    if (!outcome) throw new NotFoundException();
    return { transactionId: id, ...outcome };
  }
}
