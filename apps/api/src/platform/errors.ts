/**
 * The single error type thrown by handlers and mapped to the API envelope by the
 * Fastify error handler. Keeps every error response consistent:
 *
 *   { error: { code, message, correlationId } }
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function badRequest(message: string, code = 'INVALID_REQUEST'): ApiError {
  return new ApiError(400, code, message);
}

export function unauthorized(message = 'Authentication required'): ApiError {
  return new ApiError(401, 'UNAUTHENTICATED', message);
}

export function forbidden(message = 'Not allowed'): ApiError {
  return new ApiError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Not found'): ApiError {
  return new ApiError(404, 'NOT_FOUND', message);
}

export function rateLimited(message = 'Too many requests, try again later'): ApiError {
  return new ApiError(429, 'RATE_LIMITED', message);
}
