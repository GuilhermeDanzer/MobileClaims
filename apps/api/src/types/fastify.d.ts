import type { AuthContext } from '../platform/auth/verify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the auth preHandler on authenticated routes; null otherwise. */
    auth: AuthContext | null;
    /** W3C-friendly correlation id, minted per request and echoed in error envelopes. */
    correlationId: string;
  }
}
