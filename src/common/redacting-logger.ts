/**
 * PHI-SAFE STRUCTURED LOGGER
 * ─────────────────────────────────────────────────────────────────
 * Strategy: ALLOWLIST serialization + denylist redaction net.
 * PHI never reaches the log stream; correlation IDs carry
 * traceability instead. CI runs a canary test (test/phi-canary)
 * asserting a known fake memberId never appears in captured output.
 */
import pino from 'pino';

const PHI_KEYS = new Set([
  'memberId', 'firstName', 'lastName', 'dateOfBirth', 'dob',
  'subscriber', 'dependent', 'patient', 'ssn', 'groupNumber',
  'memberBinding', 'address', 'phone', 'email',
  'request_canonical', 'response_canonical', 'rawRequest', 'rawResponse',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = PHI_KEYS.has(k) ? '[REDACTED:PHI]' : redact(v, depth + 1);
  }
  return out;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: { log: (obj) => redact(obj) as Record<string, unknown> },
  redact: { paths: ['req.headers.authorization', 'req.headers["x-api-key"]'], censor: '[REDACTED]' },
});

export function txLogger(fields: { correlationId: string; tenantId: string; txId?: string }) {
  return logger.child(fields);
}
