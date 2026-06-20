import { parseVaultPreview } from "./vault-types";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: "no-store" });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed: ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export function fetchVaultIdentity() {
  return json<Record<string, unknown>>("/api/vault/identity");
}

export async function fetchVaultPreview() {
  const data = await json<unknown>("/api/vault/preview");
  return parseVaultPreview(data).value;
}

export function fetchVaultGaps() {
  return json("/api/vault/gaps");
}
