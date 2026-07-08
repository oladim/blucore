/**
 * NETWORK CONTRACT SUITE — every ClearinghouseNetwork implementation
 * must pass this. When adapter #2 arrives it inherits the suite and
 * you KNOW it behaves identically at the boundary.
 */
import { ClearinghouseNetwork } from '../../src/networks/network.interface';

export function runNetworkContract(name: string, factory: () => ClearinghouseNetwork) {
  describe(`ClearinghouseNetwork contract: ${name}`, () => {
    let network: ClearinghouseNetwork;
    beforeAll(() => { network = factory(); });

    it('declares a name and capabilities', () => {
      expect(network.name).toBeTruthy();
      expect(network.capabilities.length).toBeGreaterThan(0);
    });

    // Extend with fixture-driven behavior checks (mocked transport):
    //  - eligibility outcome always carries schemaVersion v1 + meta.network
    //  - AAA rejections always map into the taxonomy (never 'unknown' for known codes)
    //  - 5xx transport => throws (breaker counts it); 4xx business => outcome
    //  - timeouts throw TimeoutError, never hang past budget
  });
}

// ── Invoke the contract for every registered adapter ────────────
import { StediAdapter } from '../../src/networks/stedi/stedi.adapter';
import { NetworkRegistry } from '../../src/networks/network.registry';

runNetworkContract('stedi', () => new StediAdapter(new NetworkRegistry()));

describe('registry', () => {
  it('resolves adapters after registration and rejects unknowns', () => {
    const registry = new NetworkRegistry();
    const stedi = new StediAdapter(registry);
    stedi.onModuleInit();
    expect(registry.get('stedi')).toBe(stedi);
    expect(registry.names()).toEqual(['stedi']);
    expect(() => registry.get('availity')).toThrow('Unknown network: availity');
  });
});
