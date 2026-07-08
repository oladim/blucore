/** Tenant-scoped transaction history — support/debug surface and,
 *  later, the PMS-facing self-serve inspection feature. */
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../tenancy/auth.guard';
import { DbService } from '../../tenancy/db.service';

@Controller('v1/transactions')
@UseGuards(AuthGuard)
export class TransactionsController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('payerId') payerId?: string,
    @Query('limit') limit = '50',
  ) {
    // RLS guarantees tenant scoping even here — metadata only, no PHI columns.
    return this.db.query(
      `SELECT id, correlation_id, type, origin_channel, payer_id, network,
              status, latency_total_ms, latency_downstream_ms, created_at, responded_at
       FROM transactions
       WHERE ($1::timestamptz IS NULL OR created_at >= $1)
         AND ($2::timestamptz IS NULL OR created_at <  $2)
         AND ($3::uuid IS NULL OR payer_id = $3)
       ORDER BY created_at DESC
       LIMIT LEAST($4::int, 200)`,
      [from ?? null, to ?? null, payerId ?? null, Number(limit)],
    );
  }

  @Get(':id/events')
  async events(@Param('id', ParseUUIDPipe) id: string) {
    return this.db.query(
      `SELECT status, detail, occurred_at FROM transaction_events
       WHERE transaction_id = $1 ORDER BY occurred_at ASC`, [id],
    );
  }
}
