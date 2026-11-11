import * as SecureStore from 'expo-secure-store';

import { apiRequest } from './api-client';

/**
 * Customer authentication (Level B — local dev identity).
 *
 * In production the token comes from Cognito; locally it comes from `POST /dev/auth/customer`,
 * which is only registered when the API runs with `APP_ENV=local` + `AUTH_MODE=dev`.
 * The token is stored in SecureStore (Keychain/Keystore), never in SQLite.
 */

const TOKEN_KEY = 'auth.accessToken';

/** The dev identity endpoint returns { accessToken, tokenType }. */
interface DevAuthResponse {
  accessToken: string;
  tokenType: string;
}

export async function signInDev(): Promise<void> {
  const response = await apiRequest<DevAuthResponse>('/dev/auth/customer', { method: 'POST', body: {} });
  await SecureStore.setItemAsync(TOKEN_KEY, response.accessToken);
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getStoredToken(): Promise<string | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  return isTokenExpired(token) ? null : token;
}

/** Reads the JWT `exp` claim without a JWT library (base64 payload, no signature check). */
export function isTokenExpired(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return true; // malformed → treat as expired
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1]!)) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return decodeURIComponent(
    globalThis
      .atob(padded)
      .split('')
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
}
