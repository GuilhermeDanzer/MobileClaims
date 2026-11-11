/** Local namespace only; authorization remains the backend's responsibility. */
export async function databaseName(owner: string | null, digest: (value: string) => Promise<string>): Promise<string> {
  if (!owner) throw new Error('Sign in to access saved claims');
  return `northwind-customer-${await digest(owner)}.db`;
}

export function customerScope(token: string | null): string | null {
  if (!token) return null;
  try {
    const part = token.split('.')[1]!;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { iss?: unknown; sub?: unknown };
    if (typeof payload.iss !== 'string' || typeof payload.sub !== 'string' || !payload.sub) return null;
    return JSON.stringify([payload.iss, payload.sub]);
  } catch { return null; }
}
