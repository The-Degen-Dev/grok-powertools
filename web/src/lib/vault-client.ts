import type { VaultPreview } from "./vault-types";

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

export function fetchVaultPreview() {
  return json<VaultPreview>("/api/vault/preview");
}

export function fetchVaultGaps() {
  return json("/api/vault/gaps");
}
