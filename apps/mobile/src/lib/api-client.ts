import { randomUUID } from 'expo-crypto';

import { getApiBaseUrl } from './config';

/**
 * Thin fetch wrapper over the claims API. Every call resolves the base URL, attaches the
 * bearer token and a correlation id, times out, and normalises failures into an
 * `ApiRequestError` whose `kind` drives the sync engine's retry decisions.
 */

export type ApiErrorKind = 'auth' | 'permanent' | 'transient' | 'unknown';

export class ApiRequestError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    readonly code: string | null,
    readonly correlationId: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  token?: string | null;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token = null, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const baseUrl = await getApiBaseUrl();
  const correlationId = randomUUID();

  const headers: Record<string, string> = { 'x-correlation-id': correlationId };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    // Aborted means our timeout fired; anything else is a network-level failure.
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ApiRequestError('transient', null, null, correlationId, 'Request timed out');
    }
    throw new ApiRequestError('transient', null, null, correlationId, 'Network request failed');
  }
  clearTimeout(timer);

  const text = await response.text();
  const parsed = parseBody(text);

  if (!response.ok) {
    const envelope = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
    const kind = classify(response.status);
    if (kind === 'auth') notifyUnauthorized(token);
    throw new ApiRequestError(
      kind,
      response.status,
      envelope?.code ?? null,
      correlationId,
      envelope?.message ?? `HTTP ${response.status}`,
    );
  }

  return parsed as T;
}

// A single callback that the session provider registers to react to 401s from anywhere
// (query hooks, the sync engine, etc.).
let unauthorizedHandler: ((token: string | null) => void) | null = null;

export function setUnauthorizedHandler(handler: ((token: string | null) => void) | null): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(token: string | null = null): void {
  unauthorizedHandler?.(token);
}

function parseBody(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function classify(status: number): ApiErrorKind {
  if (status === 401) return 'auth';
  if (status === 429 || status >= 500) return 'transient';
  if (status >= 400) return 'permanent';
  return 'unknown';
}
