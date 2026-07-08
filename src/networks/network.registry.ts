import { Injectable } from '@nestjs/common';
import { ClearinghouseNetwork } from './network.interface';

/** Networks self-register at module init; routing resolves by name. */
@Injectable()
export class NetworkRegistry {
  private readonly networks = new Map<string, ClearinghouseNetwork>();

  register(network: ClearinghouseNetwork): void {
    this.networks.set(network.name, network);
  }

  get(name: string): ClearinghouseNetwork {
    const n = this.networks.get(name);
    if (!n) throw new Error(`Unknown network: ${name}`);
    return n;
  }

  names(): string[] {
    return [...this.networks.keys()];
  }
}
