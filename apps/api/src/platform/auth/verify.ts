import type { FastifyRequest } from 'fastify';
import { createLocalJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { unauthorized } from '../errors';
import type { Issuer } from './issuer';

export interface AuthContext {
  actor: 'customer' | 'employee';
  customerId?: string;
  role?: string;
}

/**
 * Verifies a bearer token against every configured issuer and maps it to an AuthContext.
 * A token must match exactly one issuer; otherwise it is rejected.
 */
export async function verifyToken(token: string, issuers: Issuer[]): Promise<AuthContext> {
  for (const issuer of issuers) {
    try {
      const jwks = createLocalJWKSet(await issuer.jwks());
      const { payload } = await jwtVerify(token, jwks, {
        issuer: issuer.issuer,
        audience: issuer.audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'sub'],
      });
      return mapPayload(payload, issuer);
    } catch {
      // This issuer did not accept the token; try the next one.
    }
  }
  throw unauthorized();
}

function mapPayload(payload: JWTPayload, issuer: Issuer): AuthContext {
  if (issuer.actor === 'customer') {
    return { actor: 'customer', customerId: payload.sub };
  }
  return { actor: 'employee', role: typeof payload.role === 'string' ? payload.role : undefined };
}

/**
 * Fastify preHandler: extracts the bearer token, verifies it, and attaches request.auth.
 * Apply to authenticated routes only.
 */
export function buildAuth(issuers: Issuer[]) {
  return async function authPreHandler(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw unauthorized();
    }
    request.auth = await verifyToken(header.slice('Bearer '.length), issuers);
  };
}
