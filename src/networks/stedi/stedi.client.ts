/**
 * Thin HTTP client for Stedi Healthcare APIs.
 * Keep-alive pooled (connection reuse matters at volume), hard
 * timeout budget, no retries here — retry policy lives in the
 * adapter where it can distinguish retryable failures.
 */
import { Agent, request } from 'undici';

export class StediClient {
  private readonly agent: Agent;

  constructor(
    private readonly baseUrl = process.env.STEDI_BASE_URL ?? '',
    private readonly apiKey = process.env.STEDI_API_KEY ?? '',
    private readonly timeoutMs = Number(process.env.STEDI_TIMEOUT_MS ?? 60_000),
  ) {
    this.agent = new Agent({
      keepAliveTimeout: 30_000,
      connections: 128,               // per-origin socket cap
    });
  }

  async post(path: string, body: unknown): Promise<{ status: number; body: any; raw: string }> {
    const res = await request(`${this.baseUrl}${path}`, {
      method: 'POST',
      dispatcher: this.agent,
      headers: {
        authorization: this.apiKey,   // Stedi uses the key directly; adjust per docs
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });
    const raw = await res.body.text();
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* non-JSON error body */ }
    return { status: res.statusCode, body: parsed, raw };
  }
}
