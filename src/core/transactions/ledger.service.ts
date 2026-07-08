/**
 * TRANSACTION LEDGER — system of record & dispute arbiter.
 * Stores canonical + raw payloads (encrypted), status timeline,
 * latency split. Doubles as audit trail and client-facing history.
 */
import { Injectable } from '@nestjs/common';
import { DbService } from '../../tenancy/db.service';
import { CryptoService } from '../../common/crypto.service';
import { requireTenant } from '../../tenancy/tenant-context';
import { Origin, TransactionType } from '../../canonical/common';

@Injectable()
export class LedgerService {
  constructor(
    private readonly db: DbService,
    private readonly crypto: CryptoService,
  ) {}

  async open(params: {
    type: TransactionType;
    origin: Origin;
    correlationId: string;
    payerId: string;
    idempotencyKey?: string;
    canonicalRequest: unknown;
    dateOfService?: string;
  }): Promise<string> {
    const enc = this.crypto.encryptJson(params.canonicalRequest);
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO transactions
         (tenant_id, correlation_id, idempotency_key, type,
          origin_channel, initiator_ref, payer_id,
          request_canonical_enc, phi_key_version, status, date_of_service)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'received',$10)
       RETURNING id`,
      [
        params.origin.tenantId, params.correlationId, params.idempotencyKey ?? null,
        params.type, params.origin.channel, params.origin.initiatorRef,
        params.payerId, enc.ciphertext, enc.keyVersion,
        params.dateOfService ?? null,
      ],
    );
    await this.event(rows[0].id, 'received');
    await this.audit('tx.create', rows[0].id);
    return rows[0].id;
  }

  async markRouted(txId: string, network: string): Promise<void> {
    await this.db.query(
      `UPDATE transactions SET status='routed', network=$2 WHERE id=$1`, [txId, network],
    );
    await this.event(txId, 'routed', { network });
  }

  async complete(txId: string, params: {
    status: 'responded' | 'payer_rejected' | 'failed' | 'timeout';
    canonicalResponse?: unknown;
    rawRequest?: string;
    rawResponse?: string;
    error?: unknown;
    latencyTotalMs: number;
    latencyDownstreamMs?: number;
  }): Promise<void> {
    const respEnc = params.canonicalResponse ? this.crypto.encryptJson(params.canonicalResponse) : null;
    const rawReqEnc = params.rawRequest ? this.crypto.encrypt(params.rawRequest) : null;
    const rawResEnc = params.rawResponse ? this.crypto.encrypt(params.rawResponse) : null;

    await this.db.query(
      `UPDATE transactions SET
         status=$2, response_canonical_enc=$3, raw_request_enc=$4, raw_response_enc=$5,
         error=$6, latency_total_ms=$7, latency_downstream_ms=$8, responded_at=now()
       WHERE id=$1`,
      [
        txId, params.status,
        respEnc?.ciphertext ?? null, rawReqEnc?.ciphertext ?? null, rawResEnc?.ciphertext ?? null,
        params.error ? JSON.stringify(params.error) : null,
        params.latencyTotalMs, params.latencyDownstreamMs ?? null,
      ],
    );
    await this.event(txId, params.status);
  }

  async getOutcome<T>(txId: string): Promise<T | null> {
    const rows = await this.db.query<{ response_canonical_enc: Buffer | null }>(
      `SELECT response_canonical_enc FROM transactions WHERE id=$1`, [txId],
    );
    const enc = rows[0]?.response_canonical_enc;
    if (!enc) return null;
    await this.audit('phi.read', txId);
    return this.crypto.decryptJson<T>(enc);
  }


  /**
   * Worklist rows for the insurance-verification screen.
   * Decrypts only the display-necessary fields; one audit event per
   * list access (not per row) to avoid audit flooding.
   */
  async listEligibilityDisplay(limit = 100, from?: string, to?: string): Promise<EligibilityDisplayRow[]> {
    const rows = await this.db.query<any>(
      `SELECT t.id, t.status, t.created_at, t.responded_at,
              t.request_canonical_enc, t.response_canonical_enc,
              p.name AS payer_name
       FROM transactions t
       LEFT JOIN payers p ON p.id = t.payer_id
       WHERE t.type = 'eligibility'
         AND ($2::date IS NULL OR COALESCE(t.date_of_service, t.created_at::date) >= $2)
         AND ($3::date IS NULL OR COALESCE(t.date_of_service, t.created_at::date) <= $3)
       ORDER BY COALESCE(t.date_of_service, t.created_at::date) ASC, t.created_at DESC
       LIMIT LEAST($1::int, 200)`,
      [limit, from ?? null, to ?? null],
    );

    const ctx = requireTenant();
    await this.db.query(
      `INSERT INTO audit_events (tenant_id, actor_type, actor_ref, action, metadata)
       VALUES ($1,$2,$3,'phi.read', $4)`,
      [ctx.tenantId, ctx.channel, ctx.initiatorRef,
       JSON.stringify({ view: 'eligibility_list', rows: rows.length })],
    );

    return rows.map((r) => {
      let req: any = null; let out: any = null;
      try { if (r.request_canonical_enc) req = this.crypto.decryptJson(r.request_canonical_enc); } catch { /* stale key */ }
      try { if (r.response_canonical_enc) out = this.crypto.decryptJson(r.response_canonical_enc); } catch { /* stale key */ }

      const rejections: any[] = out?.rejections ?? [];
      const hasResponse = out?.status === 'active' || out?.status === 'inactive';
      const uiStatus: EligibilityDisplayRow['uiStatus'] =
        out?.status === 'active' ? 'verified'
        : out?.status === 'inactive' ? 'inactive'
        : r.status === 'payer_rejected' ? 'needs-info'
        : ['failed', 'timeout'].includes(r.status) || out?.status === 'network_error' || out?.status === 'timeout' ? 'error'
        : 'pending';

      const sub = req?.subscriber;
      const prov = req?.provider;
      return {
        transactionId: r.id,
        apptDate: req?.dateOfService ?? r.created_at,
        patient: sub ? `${String(sub.firstName ?? '').charAt(0)}. ${sub.lastName ?? ''}`.trim() : '—',
        provider: prov?.organizationName
          ?? [prov?.firstName, prov?.lastName].filter(Boolean).join(' ')
          ?? '—',
        carrier: r.payer_name ?? '—',
        plan: out?.plan?.planName
          ?? out?.benefits?.find((b: any) => b.infoType === 'active_coverage' && b.planDescription)?.planDescription
          ?? null,
        uiStatus,
        respondedAt: r.responded_at,
        hasResponse,
        hasRejection: rejections.length > 0,
        rejections,
        canRetry: true, // re-verify is always permitted; guidance lives in rejection.action
      };
    });
  }


  async getRequest<T>(txId: string): Promise<T | null> {
    const rows = await this.db.query<{ request_canonical_enc: Buffer | null }>(
      `SELECT request_canonical_enc FROM transactions WHERE id=$1`, [txId],
    );
    const enc = rows[0]?.request_canonical_enc;
    if (!enc) return null;
    await this.audit('phi.read', txId);
    return this.crypto.decryptJson<T>(enc);
  }

  private async event(txId: string, status: string, detail?: unknown): Promise<void> {
    const { tenantId } = requireTenant();
    await this.db.query(
      `INSERT INTO transaction_events (transaction_id, tenant_id, status, detail)
       VALUES ($1,$2,$3,$4)`,
      [txId, tenantId, status, detail ? JSON.stringify(detail) : null],
    );
  }

  private async audit(action: string, txId: string): Promise<void> {
    const ctx = requireTenant();
    await this.db.query(
      `INSERT INTO audit_events (tenant_id, actor_type, actor_ref, action, transaction_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [ctx.tenantId, ctx.channel, ctx.initiatorRef, action, txId],
    );
  }
}

// ── Display list for the verification worklist UI ──────────────
export interface EligibilityDisplayRow {
  transactionId: string;
  apptDate: string;            // dateOfService if provided, else created_at
  patient: string;             // "F. Last" — minimal necessary for the list
  provider: string;
  carrier: string;
  plan: string | null;
  uiStatus: 'verified' | 'inactive' | 'pending' | 'needs-info' | 'error';
  respondedAt: string | null;
  hasResponse: boolean;        // a real coverage answer exists
  hasRejection: boolean;       // payer/network rejections exist
  rejections: unknown[];       // PHI-free by design (codes + guidance)
  canRetry: boolean;
}
