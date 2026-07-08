import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { CryptoService } from './common/crypto.service';
import { IdempotencyService } from './common/idempotency.service';
import { DbService } from './tenancy/db.service';
import { AuthGuard } from './tenancy/auth.guard';
import { QueuesModule } from './queues/queues.module';
import { NetworkRegistry } from './networks/network.registry';
import { StediAdapter } from './networks/stedi/stedi.adapter';
import { StediWebhookController } from './networks/stedi/stedi.webhook.controller';
import { RoutingService } from './core/routing/routing.service';
import { PayersController } from './core/routing/payers.controller';
import { LedgerService } from './core/transactions/ledger.service';
import { TransactionsController } from './core/transactions/transactions.controller';
import { EligibilityService } from './core/eligibility/eligibility.service';
import { EligibilityController } from './core/eligibility/eligibility.controller';
import { ClaimStatusService } from './core/claim-status/claim-status.service';
import { DeliveryService } from './core/delivery/delivery.service';
import { HealthController } from './health.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), QueuesModule],
  controllers: [
    HealthController,
    EligibilityController,
    TransactionsController,
    PayersController,
    StediWebhookController,
  ],
  providers: [
    // common
    CryptoService, IdempotencyService,
    // tenancy
    DbService, AuthGuard,
    // networks
    NetworkRegistry, StediAdapter,
    // core
    RoutingService, LedgerService, DeliveryService,
    EligibilityService, ClaimStatusService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
