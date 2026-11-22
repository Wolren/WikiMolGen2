/**
 * One HTTP client for the lookup services.
 *
 * Every request gets a deadline and a short session cache. A transient failure gets one
 * retry with backoff; a definitive answer, such as a 404, does not. Metadata calls opt out
 * of the retry so a figure does not wait on a source that is already slow.
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_CACHE_MS = 300_000;
const MAX_CACHE_ENTRIES = 80;

export interface RequestOptions {
  /** Deadline for one attempt. */
  timeoutMs?: number;
  /** Extra attempts after the first, for a network error, a 429 or a 5xx. */
  retries?: number;
  /** How long a successful answer is reused; 0 disables caching. */
  cacheMs?: number;
  /** Request init, for a POST body or extra headers. */
  init?: RequestInit;
}

/** A response with a non-success status. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** A request that could not reach the service, or ran out of time. */
export class NetworkError extends Error {
  readonly timeout: boolean;

  constructor(message: string, timeout: boolean) {
    super(message);
    this.name = "NetworkError";
    this.timeout = timeout;
  }
}

interface CacheEntry {
  at: number;
  value: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();

/** Drop every cached answer; tests use this, and a reload starts a fresh module. */
export function clearRequestCache(): void {
  cache.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function cacheKey(kind: string, url: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" ? `${kind}:${url}` : "";
}

function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  if (key === "" || ttl <= 0) return load();
  const hit = cache.get(key);
  if (hit !== undefined && Date.now() - hit.at <= ttl) return hit.value as Promise<T>;

  const value = load().catch((error: unknown) => {
    if (cache.get(key)?.value === value) cache.delete(key);
    throw error;
  });
  cache.set(key, { at: Date.now(), value });
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

function firstLine(text: string): string {
  return text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
}

/** The response, after one deadline and the allowed retries. */
async function request(url: string, options: RequestOptions): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = 1 + Math.max(0, options.retries ?? DEFAULT_RETRIES);
  let lastError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options.init,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt + 1 < attempts) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const detail = await response.text().catch(() => "");
      const line = firstLine(detail);
      throw new HttpError(
        response.status,
        line === "" ? `HTTP ${response.status}` : `HTTP ${response.status}: ${line}`,
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      lastError = error;
      if (attempt + 1 < attempts) {
        await sleep(300 * (attempt + 1));
        continue;
      }
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      throw new NetworkError(
        timedOut
          ? `no answer within ${timeoutMs / 1000} s`
          : error instanceof Error
            ? error.message
            : String(error),
        timedOut,
      );
    }
  }

  throw new NetworkError(
    lastError instanceof Error ? lastError.message : String(lastError),
    false,
  );
}

/** A JSON answer, cached for a GET. */
export async function requestJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const ttl = options.cacheMs ?? DEFAULT_CACHE_MS;
  return cached(cacheKey("json", url, options.init), ttl, async () => {
    const response = await request(url, options);
    return (await response.json()) as T;
  });
}

/** A text answer, cached for a GET. */
export async function requestText(url: string, options: RequestOptions = {}): Promise<string> {
  const ttl = options.cacheMs ?? DEFAULT_CACHE_MS;
  return cached(cacheKey("text", url, options.init), ttl, async () => {
    const response = await request(url, options);
    return response.text();
  });
}

/** A binary answer, cached for a GET. */
export async function requestBytes(url: string, options: RequestOptions = {}): Promise<Uint8Array> {
  const ttl = options.cacheMs ?? DEFAULT_CACHE_MS;
  return cached(cacheKey("bytes", url, options.init), ttl, async () => {
    const response = await request(url, options);
    return new Uint8Array(await response.arrayBuffer());
  });
}
