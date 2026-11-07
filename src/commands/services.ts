import type { Command } from "commander";
import type { Service } from "../client.js";
import type { ProgramDeps } from "../context.js";
import { details, table } from "../format.js";
import { createApiClient, resolveService } from "../target.js";

function describeService(service: Service): string[] {
  const serviceDetails = service.serviceDetails ?? {};
  const native = serviceDetails.envSpecificDetails ?? {};
  return details([
    ["name", service.name],
    ["id", service.id],
    ["type", service.type],
    ["runtime", serviceDetails.runtime],
    ["plan", serviceDetails.plan],
    ["region", serviceDetails.region],
    ["suspended", service.suspended],
    ["repo", service.repo],
    ["branch", service.branch],
    ["root dir", service.rootDir || undefined],
    ["auto-deploy", service.autoDeploy],
    ["build command", native.buildCommand ?? serviceDetails.buildCommand],
    ["start command", native.startCommand],
    ["pre-deploy command", native.preDeployCommand],
    ["dockerfile", native.dockerfilePath],
    ["docker command", native.dockerCommand],
    ["publish path", serviceDetails.publishPath],
    ["health check", serviceDetails.healthCheckPath],
    ["url", serviceDetails.url],
    ["dashboard", service.dashboardUrl],
  ]);
}

export function registerServicesCommands(program: Command, deps: ProgramDeps): void {
  const { io } = deps;
  const services = program.command("services").description("inspect services");

  services
    .command("list")
    .alias("ls")
    .description("list the services the API key can reach")
    .option("--json", "print JSON")
    .action(async (options: { json?: boolean }) => {
      const client = await createApiClient(deps);
      const list = (await client.listServices()).sort((a, b) => a.name.localeCompare(b.name));
      if (options.json) {
        io.out(JSON.stringify(list, null, 2));
        return;
      }
      if (list.length === 0) {
        io.err("No services");
        return;
      }
      const rows = list.map((service) => [
        service.name,
        service.id,
        service.type,
        service.suspended ?? "",
        service.serviceDetails?.url ?? "",
      ]);
      for (const line of table(["NAME", "ID", "TYPE", "SUSPENDED", "URL"], rows)) io.out(line);
    });

  services
    .command("get")
    .description("show a service's settings: runtime, commands, root dir, auto-deploy")
    .argument("<id-or-name>")
    .option("--json", "print JSON")
    .action(async (ref: string, options: { json?: boolean }) => {
      const { service } = await resolveService(deps, ref);
      if (options.json) io.out(JSON.stringify(service, null, 2));
      else for (const line of describeService(service)) io.out(line);
    });
}
