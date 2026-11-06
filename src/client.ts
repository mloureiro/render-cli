export const DEFAULT_BASE_URL = "https://api.render.com/v1";
const PAGE_SIZE = 100;
const MAX_RATE_LIMIT_RETRIES = 3;

export interface EnvVar {
  key: string;
  value: string;
}

export interface Service {
  id: string;
  name: string;
  type: string;
  slug?: string;
}

export interface Deploy {
  id: string;
  status?: string;
}

export type EnvVarInput = { value: string } | { generateValue: true };

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class RenderApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RenderApiError";
  }
}

export interface RenderClient {
  listEnvVars(serviceId: string): Promise<EnvVar[]>;
  getEnvVar(serviceId: string, key: string): Promise<EnvVar | undefined>;
  setEnvVar(serviceId: string, key: string, input: EnvVarInput): Promise<EnvVar>;
  deleteEnvVar(serviceId: string, key: string): Promise<boolean>;
  getService(serviceId: string): Promise<Service | undefined>;
  findServicesByName(name: string): Promise<Service[]>;
  triggerDeploy(serviceId: string): Promise<Deploy | undefined>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createClient(options: ClientOptions): RenderClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  async function request(method: string, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${options.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        await sleep((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1) * 1000);
        continue;
      }
      return response;
    }
  }

  async function fail(response: Response, context: string): Promise<never> {
    const payload = (await response.json().catch(() => ({}))) as { message?: unknown };
    const detail =
      typeof payload.message === "string" && payload.message
        ? payload.message
        : response.statusText;
    throw new RenderApiError(response.status, `${context}: ${response.status} ${detail}`.trim());
  }

  async function paginate<T, K extends string>(path: string, itemKey: K): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    const separator = path.includes("?") ? "&" : "?";
    for (;;) {
      const query = `limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const response = await request("GET", `${path}${separator}${query}`);
      if (!response.ok) await fail(response, `GET ${path}`);
      const page = (await response.json()) as Array<Record<K, T> & { cursor: string }>;
      for (const entry of page) items.push(entry[itemKey]);
      const last = page.at(-1);
      if (page.length < PAGE_SIZE || !last?.cursor) return items;
      cursor = last.cursor;
    }
  }

  const envVarPath = (serviceId: string, key: string) =>
    `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`;

  return {
    listEnvVars: (serviceId) =>
      paginate<EnvVar, "envVar">(`/services/${encodeURIComponent(serviceId)}/env-vars`, "envVar"),

    async getEnvVar(serviceId, key) {
      const response = await request("GET", envVarPath(serviceId, key));
      if (response.status === 404) return undefined;
      if (!response.ok) await fail(response, `Failed to read ${key}`);
      return (await response.json()) as EnvVar;
    },

    async setEnvVar(serviceId, key, input) {
      const response = await request("PUT", envVarPath(serviceId, key), input);
      if (!response.ok) await fail(response, `Failed to set ${key}`);
      return (await response.json()) as EnvVar;
    },

    async deleteEnvVar(serviceId, key) {
      const response = await request("DELETE", envVarPath(serviceId, key));
      if (response.status === 404) return false;
      if (!response.ok) await fail(response, `Failed to delete ${key}`);
      return true;
    },

    async getService(serviceId) {
      const response = await request("GET", `/services/${encodeURIComponent(serviceId)}`);
      if (response.status === 404) return undefined;
      if (!response.ok) await fail(response, `Failed to read service ${serviceId}`);
      return (await response.json()) as Service;
    },

    async findServicesByName(name) {
      const services = await paginate<Service, "service">(
        `/services?name=${encodeURIComponent(name)}`,
        "service",
      );
      return services.filter((service) => service.name === name);
    },

    async triggerDeploy(serviceId) {
      const response = await request(
        "POST",
        `/services/${encodeURIComponent(serviceId)}/deploys`,
        {},
      );
      if (!response.ok) await fail(response, "Failed to trigger a deploy");
      if (response.status === 202) return undefined;
      return (await response.json()) as Deploy;
    },
  };
}
