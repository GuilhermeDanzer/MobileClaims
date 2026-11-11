import type { Pool } from 'pg';

import * as claimsRepo from '../db/claims-repo';
import * as notificationsRepo from '../db/notifications-repo';
import { LegacyGatewayError } from '../integrations/legacy/http-gateway';
import type { LegacyClaimsGateway } from '../integrations/legacy/types';
import { CircuitOpenError, type CircuitBreaker } from '../platform/circuit-breaker';
import { increment } from '../platform/metrics';

export interface DeliverPayload {
  claimId: string;
  reference: string;
  customerId: string;
}

/**
 * Delivers an accepted claim to the legacy claims system. Extracted from the worker so the
 * failure paths (reject, retry, breaker, recovery) are testable with a simulated gateway.
 *
 * Throws for transient failures (so the caller retries) and returns normally for success or
 * permanent rejection (so the caller completes the message).
 */
export async function deliverClaim(
  pool: Pool,
  gateway: LegacyClaimsGateway,
  breaker: CircuitBreaker,
  payload: DeliverPayload,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT claim_id FROM claims WHERE claim_id = $1 FOR UPDATE', [payload.claimId]);
    const claim = await claimsRepo.getClaimById(client, payload.customerId, payload.claimId);
    if (!claim) throw new Error(`claim ${payload.claimId} not found`);
    if (claim.intake_status === 'legacy_accepted' || claim.intake_status === 'legacy_rejected') {
      await client.query('COMMIT');
      return;
    }
    const documents = await claimsRepo.listDocuments(client, payload.claimId);

    if (documents.some((d) => d.status !== 'complete')) throw new Error('Evidence is still pending');

    // Record the transition once; retries must not duplicate "sending" in the timeline.
    const latest = await claimsRepo.getLatestStatus(client, payload.claimId);
    if (latest !== 'sent_to_legacy') {
      await claimsRepo.insertStatusEvent(client, {
        claimId: payload.claimId,
        status: 'sent_to_legacy',
        label: 'Sending to claims system',
        source: 'platform',
      });
    }

    let result;
    try {
      result = await breaker.run(() =>
        gateway.createClaim({
          reference: claim.reference,
          policyNumber: claim.policy_number ?? '',
          incidentDescription: claim.incident_description ?? undefined,
          documentNames: documents.map((d) => d.file_name),
        }),
      );
    } catch (error) {
      if (error instanceof CircuitOpenError) throw error; // transient: retry later
      if (error instanceof LegacyGatewayError && error.status && [400, 422].includes(error.status)) {
        // Permanent rejection: record it and do not retry.
        await claimsRepo.insertStatusEvent(client, {
          claimId: payload.claimId,
          status: 'legacy_rejected',
          label: 'Rejected by claims system',
          source: 'legacy',
        });
        await notificationsRepo.insertNotification(client, {
          customerId: payload.customerId,
          claimId: payload.claimId,
          title: 'Action needed',
          body: `Your claim ${payload.reference} needs review. Please contact support.`,
        });
        await claimsRepo.markLegacyRejected(client, payload.claimId);
        await client.query('COMMIT');
        increment('claims.legacy_rejected');
        return;
      }
      throw error; // transient 5xx/network/timeout: retry
    }

    await claimsRepo.insertStatusEvent(client, {
      claimId: payload.claimId,
      status: 'legacy_accepted',
      label: `Received by claims system (${result.legacyClaimNumber})`,
      source: 'legacy',
    });
    await notificationsRepo.insertNotification(client, {
      customerId: payload.customerId,
      claimId: payload.claimId,
      title: 'Claim received',
      body: `Your claim ${payload.reference} is now with the claims team.`,
    });
    // Advance intake state and make the claim eligible for status reconciliation.
    await claimsRepo.markLegacyAccepted(client, payload.claimId, result.legacyClaimNumber);
    await client.query('COMMIT');
    increment('claims.delivered_to_legacy');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
