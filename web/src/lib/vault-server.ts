export interface WorkerConfig {
  workerUrl: string;
  apiKey: string;
}

export function getWorkerConfig(): WorkerConfig {
  const workerUrl = (process.env.WORKER_URL || "").replace(/\/+$/, "");
  const apiKey = process.env.WORKER_API_KEY || process.env.CLIENT_API_KEY || "";

  if (!workerUrl) {
    throw new Error("WORKER_URL_MISSING");
  }

  if (!apiKey) {
    throw new Error("WORKER_API_KEY_MISSING");
  }

  return { workerUrl, apiKey };
}

export function getWorkerHost(): string {
  const workerUrl = process.env.WORKER_URL || "";
  try {
    return workerUrl ? new URL(workerUrl).host : "unknown";
  } catch {
    return "unknown";
  }
}

export async function workerJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { workerUrl, apiKey } = getWorkerConfig();
  const headers = new Headers(init.headers);
  headers.set("x-gpt-api-key", apiKey);

  const res = await fetch(`${workerUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });

  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Worker request failed: ${res.status}`;
    throw new Error(message);
  }

  return data as T;
}
