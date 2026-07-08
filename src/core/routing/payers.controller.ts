/** Public payer directory — product surface: which payers do we support? */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../tenancy/auth.guard';
import { DbService } from '../../tenancy/db.service';

@Controller('v1/payers')
@UseGuards(AuthGuard)
export class PayersController {
  constructor(private readonly db: DbService) {}

  @Get()
  async list(@Query('transactionType') type?: string) {
    return this.db.referenceQuery(
      `SELECT p.id, p.name,
              array_agg(DISTINCT t) AS transaction_types
       FROM payers p
       JOIN payer_routes r ON r.payer_id = p.id AND r.status = 'active'
       CROSS JOIN LATERAL unnest(r.transaction_types) AS t
       WHERE p.status = 'active'
         AND ($1::text IS NULL OR $1 = ANY(r.transaction_types))
       GROUP BY p.id, p.name
       ORDER BY p.name`,
      [type ?? null],
    );
  }
}
