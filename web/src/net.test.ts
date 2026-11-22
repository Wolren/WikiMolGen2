import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRequestCache, HttpError, NetworkError, requestJson } from "./net.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  clearRequestCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestJson", () => {
  it("parses and caches a GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson("https://example.test/a")).resolves.toEqual({ ok: 1 });
    await expect(requestJson("https://example.test/a")).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries one 503", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "busy" }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: 2 }, 200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestJson("https://example.test/b", { retries: 1 })).resolves.toEqual({ ok: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "missing" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    const failure = requestJson("https://example.test/c");
    await expect(failure).rejects.toBeInstanceOf(HttpError);
    await expect(failure).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wraps a network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("boom"));
    vi.stubGlobal("fetch", fetchMock);

    const failure = requestJson("https://example.test/d", { retries: 0 });
    await expect(failure).rejects.toBeInstanceOf(NetworkError);
    await expect(failure).rejects.toMatchObject({ timeout: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
