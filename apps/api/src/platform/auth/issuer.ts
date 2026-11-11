import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

export interface Issuer {
  /** Which actor this issuer represents. Drives authorization, never the audience string. */
  actor: 'customer' | 'employee';
  /** The `iss` claim value, e.g. http://localhost:3000/customer */
  issuer: string;
  /** The `aud` claim value the verifier enforces. */
  audience: string;
  jwks: () => Promise<{ keys: JWK[] }>;
  issue: (claims: Record<string, unknown>, expiresIn?: string) => Promise<string>;
}

/**
 * A local RS256 JWT issuer standing in for Cognito (customers) or Entra ID (employees).
 * Level B — simulated. The same key material is served as JWKS and consumed by the verifier,
 * so the production verification path (jose + JWKS + issuer/audience) is exercised for real.
 * Only the identity of the issuer is local.
 */
export async function createLocalIssuer(
  actor: Issuer['actor'],
  issuer: string,
  audience: string,
): Promise<Issuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);

  return {
    actor,
    issuer,
    audience,
    jwks: async () => ({ keys: [{ ...publicJwk, alg: 'RS256', use: 'sig', kid: 'local-dev' }] }),
    issue: (claims, expiresIn = '1h') =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'local-dev' })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(privateKey),
  };
}
