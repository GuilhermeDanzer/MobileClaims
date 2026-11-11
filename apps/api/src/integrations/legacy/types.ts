/**
 * Contract the platform uses to talk to the on-premises claims system. This is a real
 * system boundary (ADR-012): production speaks HTTPS to the legacy system; locally the
 * same HTTP adapter speaks to apps/onprem-stub.
 */
export interface LegacyCreateClaimInput {
  reference: string;
  policyNumber: string;
  incidentDescription?: string;
  documentNames: string[];
}

export interface LegacyCreateClaimResult {
  legacyClaimNumber: string;
  receivedAt: string;
}

export interface LegacyClaimStatus {
  reference: string;
  status: string;
  updatedAt: string;
}

export interface LegacyClaimsGateway {
  createClaim(input: LegacyCreateClaimInput): Promise<LegacyCreateClaimResult>;
  getStatus(reference: string): Promise<LegacyClaimStatus>;
}
