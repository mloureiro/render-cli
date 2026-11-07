import { describe, expect, it, vi } from "vitest";
import { createClient, RenderApiError } from "../src/client.js";

const API_KEY = "rnd_test_key";

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  return { calls, fetch: fetchFn as unknown as typeof fetch };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const envVarPage = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    envVar: { key: `KEY_${from + index}`, value: `v${from + index}` },
    cursor: `cursor-${from + index}`,
  }));

describe("listEnvVars", () => {
  it("follows the cursor of the last item until a short page", async () => {
    const { calls, fetch } = fakeFetch((call) =>
      call.url.searchParams.get("cursor") ? json(envVarPage(100, 3)) : json(envVarPage(0, 100)),
    );
    const client = createClient({ apiKey: API_KEY, fetch });

    const envVars = await client.listEnvVars("srv-abc");

    expect(envVars).toHaveLength(103);
    expect(envVars[102]).toEqual({ key: "KEY_102", value: "v102" });
    expect(calls.map((call) => call.url.search)).toEqual([
      "?limit=100",
      "?limit=100&cursor=cursor-99",
    ]);
    expect(calls[0]?.url.pathname).toBe("/v1/services/srv-abc/env-vars");
    expect(calls[0]?.headers.Authorization).toBe(`Bearer ${API_KEY}`);
  });
});

describe("getEnvVar", () => {
  it("returns undefined when the key does not exist", async () => {
    const { calls, fetch } = fakeFetch(() => json({ message: "not found" }, 404));
    const client = createClient({ apiKey: API_KEY, fetch });

    expect(await client.getEnvVar("srv-abc", "A/B")).toBeUndefined();
    expect(calls[0]?.url.pathname).toBe("/v1/services/srv-abc/env-vars/A%2FB");
  });
});

describe("setEnvVar", () => {
  it("PUTs the value as JSON", async () => {
    const { calls, fetch } = fakeFetch(() => json({ key: "TOKEN", value: "s3cret" }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.setEnvVar("srv-abc", "TOKEN", { value: "s3cret" });

    expect(calls[0]).toMatchObject({ method: "PUT", body: { value: "s3cret" } });
    expect(calls[0]?.headers["Content-Type"]).toBe("application/json");
  });

  it("reports the API error message without the API key", async () => {
    const { fetch } = fakeFetch(() => json({ message: "invalid key name" }, 400));
    const client = createClient({ apiKey: API_KEY, fetch });

    const error = await client.setEnvVar("srv-abc", "bad key", { value: "x" }).catch((e) => e);

    expect(error).toBeInstanceOf(RenderApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe("Failed to set bad key: 400 invalid key name");
    expect(error.message).not.toContain(API_KEY);
  });

  it("waits for Retry-After and retries when rate limited", async () => {
    let attempts = 0;
    const { fetch } = fakeFetch(() =>
      ++attempts === 1
        ? json({ message: "rate limit exceeded" }, 429, { "Retry-After": "2" })
        : json({ key: "A", value: "1" }),
    );
    const sleep = vi.fn(async () => {});
    const client = createClient({ apiKey: API_KEY, fetch, sleep });

    await client.setEnvVar("srv-abc", "A", { value: "1" });

    expect(sleep).toHaveBeenCalledWith(2000);
    expect(attempts).toBe(2);
  });

  it("gives up after repeated rate limiting", async () => {
    const { calls, fetch } = fakeFetch(() => json({ message: "rate limit exceeded" }, 429));
    const client = createClient({ apiKey: API_KEY, fetch, sleep: async () => {} });

    await expect(client.setEnvVar("srv-abc", "A", { value: "1" })).rejects.toThrow(/429/);
    expect(calls).toHaveLength(4);
  });
});

describe("deleteEnvVar", () => {
  it("returns false for a missing key and true after a delete", async () => {
    const { fetch } = fakeFetch((call) =>
      call.url.pathname.endsWith("/GONE")
        ? json({ message: "not found" }, 404)
        : new Response(null, { status: 204 }),
    );
    const client = createClient({ apiKey: API_KEY, fetch });

    expect(await client.deleteEnvVar("srv-abc", "GONE")).toBe(false);
    expect(await client.deleteEnvVar("srv-abc", "HERE")).toBe(true);
  });
});

describe("findServicesByName", () => {
  it("keeps only exact name matches", async () => {
    const { calls, fetch } = fakeFetch(() =>
      json([
        { service: { id: "srv-1", name: "cms", type: "web_service" }, cursor: "c1" },
        { service: { id: "srv-2", name: "cms-staging", type: "web_service" }, cursor: "c2" },
      ]),
    );
    const client = createClient({ apiKey: API_KEY, fetch });

    const services = await client.findServicesByName("cms");

    expect(services.map((service) => service.id)).toEqual(["srv-1"]);
    expect(calls[0]?.url.searchParams.get("name")).toBe("cms");
  });
});

describe("triggerDeploy", () => {
  it("POSTs to the deploys endpoint", async () => {
    const { calls, fetch } = fakeFetch(() => json({ id: "dep-1", status: "created" }, 201));
    const client = createClient({ apiKey: API_KEY, fetch });

    expect(await client.triggerDeploy("srv-abc")).toEqual({ id: "dep-1", status: "created" });
    expect(calls[0]).toMatchObject({ method: "POST", body: {} });
    expect(calls[0]?.url.pathname).toBe("/v1/services/srv-abc/deploys");
  });
});

describe("listDeploys", () => {
  it("unwraps the deploys of one page of the given size", async () => {
    const { calls, fetch } = fakeFetch(() =>
      json([{ deploy: { id: "dep-1", status: "live" }, cursor: "c1" }]),
    );
    const client = createClient({ apiKey: API_KEY, fetch });

    expect(await client.listDeploys("srv-abc", 5)).toEqual([{ id: "dep-1", status: "live" }]);
    expect(calls[0]?.url.pathname).toBe("/v1/services/srv-abc/deploys");
    expect(calls[0]?.url.search).toBe("?limit=5");
  });
});

describe("listLogs", () => {
  it("sends the owner, resource and window as query parameters", async () => {
    const { calls, fetch } = fakeFetch(() => json({ logs: [], hasMore: false }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.listLogs({
      ownerId: "tea-1",
      resource: "srv-abc",
      type: "build",
      startTime: "2026-11-07T09:00:00Z",
      direction: "forward",
      limit: 50,
    });

    expect(calls[0]?.url.pathname).toBe("/v1/logs");
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({
      ownerId: "tea-1",
      resource: "srv-abc",
      type: "build",
      startTime: "2026-11-07T09:00:00Z",
      direction: "forward",
      limit: "50",
    });
  });
});
