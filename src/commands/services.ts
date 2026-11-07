import type { Command } from "commander";
import type { Service } from "../client.js";
import { type ProgramDeps, UsageError } from "../context.js";
import { details, table } from "../format.js";
import { planServiceUpdate, type UpdateFlags } from "../service-update.js";
import { createApiClient, resolveService } from "../target.js";

interface UpdateOptions extends UpdateFlags {
  dryRun?: boolean;
  yes?: boolean;
}

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

  services
    .command("update")
    .description("change a service's root dir, build/start command or auto-deploy")
    .argument("<id-or-name>")
    .option("--root-dir <dir>", 'directory the build runs in; "" clears it')
    .option("--build-command <cmd>", "build command")
    .option("--start-command <cmd>", "start command")
    .option("--auto-deploy <yes|no>", "deploy on every push to the branch")
    .option("--dry-run", "only show what would change")
    .option("-y, --yes", "apply without asking for confirmation")
    .action(async (ref: string, options: UpdateOptions) => {
      const flags: UpdateFlags = {
        rootDir: options.rootDir,
        buildCommand: options.buildCommand,
        startCommand: options.startCommand,
        autoDeploy: options.autoDeploy,
      };
      const { client, service } = await resolveService(deps, ref);
      const { changes, body } = planServiceUpdate(service, flags);
      const label = `${service.name} (${service.id})`;

      if (changes.length === 0) {
        io.out(`${label} already has these settings`);
        return;
      }
      io.out(`Changes to ${label}:`);
      for (const { field, from, to } of changes) {
        io.out(`  ${field}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
      }
      if (options.dryRun) return;

      if (!options.yes) {
        if (!io.stdinIsTTY) {
          throw new UsageError("Refusing to apply without confirmation; pass --yes");
        }
        if (!(await io.confirm(`Apply to ${label}?`))) {
          io.err("Aborted");
          return;
        }
      }

      await client.updateService(service.id, body);
      io.out(`Updated ${label}`);
    });
}
