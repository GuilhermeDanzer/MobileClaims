import { z } from 'zod';

import type {
  LegacyClaimStatus,
  LegacyClaimsGateway,
  LegacyCreateClaimInput,
  LegacyCreateClaimResult,
} from './types'

/** Thrown when the legacy HTTP call fails (network, timeout, or non-2xx). */
export class LegacyGatewayError extends Error {
  constructor(
    message: string,
    /** HTTP status when the failure came from a response; undefined for network/timeout. */
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'LegacyGatewayError'
  }
}

/**
 * The production adapter (Level A code): real HTTPS with an idempotency key (the platform
 * claim reference) and a timeout. Locally it points at apps/onprem-stub on :4000; in
 * production it points at the on-premises system over VPN/Direct Connect.
 */
export class HttpLegacyClaimsGateway implements LegacyClaimsGateway {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 5_000,
  ) {}

  async createClaim(
    input: LegacyCreateClaimInput,
  ): Promise<LegacyCreateClaimResult> {
    const response = await fetch(`${this.baseUrl}/claims`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reference: input.reference,
        policyNumber: input.policyNumber,
        incidentDescription: input.incidentDescription,
        documents: input.documentNames.map(name => ({ name })),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok)
      throw new LegacyGatewayError(
        `createClaim failed: HTTP ${response.status}`,
        response.status,
      )
    return z.object({ legacyClaimNumber: z.string().min(1), receivedAt: z.string().min(1) }).parse(await response.json())
  }

  async getStatus(reference: string): Promise<LegacyClaimStatus> {
    const response = await fetch(
      `${this.baseUrl}/claims/${encodeURIComponent(reference)}/status`,
      {
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    )
    if (!response.ok)
      throw new LegacyGatewayError(
        `getStatus failed: HTTP ${response.status}`,
        response.status,
      )
    return z.object({ reference: z.string().min(1), status: z.string().min(1), updatedAt: z.string().min(1) }).parse(await response.json())
  }
}
