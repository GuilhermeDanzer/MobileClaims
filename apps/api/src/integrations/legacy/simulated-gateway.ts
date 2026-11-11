import type {
  LegacyClaimStatus,
  LegacyClaimsGateway,
  LegacyCreateClaimInput,
  LegacyCreateClaimResult,
} from './types';

export interface SimulatedLegacyConfig {
  createClaim?: (input: LegacyCreateClaimInput) => Promise<LegacyCreateClaimResult>;
  getStatus?: (reference: string) => Promise<LegacyClaimStatus>;
}

/**
 * Deterministic, socket-free gateway for unit tests. Configured per test so failure
 * behaviour is explicit rather than emergent.
 */
export class SimulatedLegacyClaimsGateway implements LegacyClaimsGateway {
  constructor(private readonly config: SimulatedLegacyConfig) {}

  async createClaim(input: LegacyCreateClaimInput): Promise<LegacyCreateClaimResult> {
    if (!this.config.createClaim) throw new Error('createClaim not configured on simulated gateway');
    return this.config.createClaim(input);
  }

  async getStatus(reference: string): Promise<LegacyClaimStatus> {
    if (!this.config.getStatus) throw new Error('getStatus not configured on simulated gateway');
    return this.config.getStatus(reference);
  }
}
