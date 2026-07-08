/**
 * PHI CANARY — CI gate. A fake member identity is logged through the
 * redacting logger; if it ever appears in the captured stream, the
 * build FAILS. Convention doesn't survive scale — only automation.
 */
import pino from 'pino';

const CANARY_MEMBER_ID = 'CANARY-MBR-99887766';
const CANARY_DOB = '1999-12-31';

describe('PHI never reaches the log stream', () => {
  it('redacts member identifiers from structured logs', async () => {
    const chunks: string[] = [];
    const stream = { write: (s: string) => { chunks.push(s); } };

    // Same redaction formatter as production logger
    const { logger } = await import('../src/common/redacting-logger');
    const testLogger = pino(
      { formatters: (logger as any)[pino.symbols.formattersSym] ?? {} },
      stream as any,
    );

    testLogger.info({
      correlationId: 'abc',
      subscriber: { memberId: CANARY_MEMBER_ID, dateOfBirth: CANARY_DOB },
      memberId: CANARY_MEMBER_ID,
    }, 'eligibility received');

    const output = chunks.join('');
    expect(output).not.toContain(CANARY_MEMBER_ID);
    expect(output).not.toContain(CANARY_DOB);
  });
});
