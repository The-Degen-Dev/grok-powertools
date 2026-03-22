/**
 * JWT verification for sync endpoints.
 * Tokens are signed by Auth.js using AUTH_SECRET (HMAC-SHA256).
 */

interface JWTPayload {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
  iat?: number;
  exp?: number;
}

async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function base64UrlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<JWTPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  const key = await importKey(secret);
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = base64UrlDecode(signature);

  const sigBuffer = new ArrayBuffer(sig.byteLength);
  new Uint8Array(sigBuffer).set(sig);
  const dataBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(dataBuffer).set(data);
  const valid = await crypto.subtle.verify("HMAC", key, sigBuffer, dataBuffer);
  if (!valid) return null;

  const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as JWTPayload;

  if (decoded.exp && decoded.exp * 1000 < Date.now()) {
    return null;
  }

  return decoded;
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}
