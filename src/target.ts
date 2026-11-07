import type { Command } from "commander";
import type { RenderClient, Service } from "./client.js";
import { type ProgramDeps, UsageError } from "./context.js";
import { requireApiKey } from "./credentials.js";

const SERVICE_ID_PATTERN = /^(srv|crn)-[a-z0-9]+$/;

export interface Target {
  client: RenderClient;
  serviceId: string;
  label: string;
}

export interface ResolvedService {
  client: RenderClient;
  service: Service;
}

export function withServiceOption(command: Command): Command {
  return command.option(
    "-s, --service <id-or-name>",
    "service ID (srv-…) or exact service name; defaults to $RENDER_SERVICE",
  );
}

export function serviceRef(command: Command, deps: ProgramDeps): string {
  const ref = (command.opts<{ service?: string }>().service ?? deps.env.RENDER_SERVICE)?.trim();
  if (!ref)
    throw new UsageError("Missing service: pass --service <id-or-name> or set RENDER_SERVICE");
  return ref;
}

export async function createApiClient(deps: ProgramDeps): Promise<RenderClient> {
  return deps.createClient({ apiKey: await requireApiKey(deps) });
}

async function findByName(client: RenderClient, name: string): Promise<Service> {
  const matches = await client.findServicesByName(name);
  const [match] = matches;
  if (matches.length === 1 && match) return match;
  if (matches.length === 0) throw new UsageError(`No service named "${name}"`);
  const ids = matches.map((service) => service.id).join(", ");
  throw new UsageError(
    `Several services are named "${name}" (${ids}); pass the service ID instead`,
  );
}

export async function resolveTarget(deps: ProgramDeps, ref: string): Promise<Target> {
  const client = await createApiClient(deps);
  if (SERVICE_ID_PATTERN.test(ref)) return { client, serviceId: ref, label: ref };
  const service = await findByName(client, ref);
  return { client, serviceId: service.id, label: `${service.name} (${service.id})` };
}

export async function resolveService(deps: ProgramDeps, ref: string): Promise<ResolvedService> {
  const client = await createApiClient(deps);
  if (!SERVICE_ID_PATTERN.test(ref)) return { client, service: await findByName(client, ref) };
  const service = await client.getService(ref);
  if (!service) throw new UsageError(`No service with ID ${ref}`);
  return { client, service };
}
