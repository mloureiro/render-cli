import type { Command } from "commander";
import type { Deploy } from "../client.js";
import { type ProgramDeps, UsageError } from "../context.js";
import { details, duration, firstLine, table, time } from "../format.js";
import { resolveTarget, serviceRef, withServiceOption } from "../target.js";

const SUCCEEDED_STATUSES = new Set(["live"]);
const FAILED_STATUSES = new Set([
  "build_failed",
  "update_failed",
  "pre_deploy_failed",
  "canceled",
  "deactivated",
]);

function positiveInteger(name: string, max?: number) {
  return (value: string) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || (max !== undefined && parsed > max)) {
      throw new UsageError(`${name} must be a whole number from 1${max ? ` to ${max}` : ""}`);
    }
    return parsed;
  };
}

const commitLabel = (deploy: Deploy) =>
  deploy.commit?.id
    ? `${deploy.commit.id.slice(0, 7)} ${firstLine(deploy.commit.message, 50)}`
    : (deploy.image?.ref ?? "");

function describeDeploy(deploy: Deploy): string[] {
  return details([
    ["id", deploy.id],
    ["status", deploy.status],
    ["trigger", deploy.trigger],
    ["commit", deploy.commit?.id],
    ["message", firstLine(deploy.commit?.message, 200)],
    ["image", deploy.image?.ref],
    ["created", time(deploy.createdAt)],
    ["started", time(deploy.startedAt)],
    ["finished", time(deploy.finishedAt)],
    ["duration", duration(deploy.startedAt ?? deploy.createdAt, deploy.finishedAt)],
  ]);
}

export function registerDeploysCommands(program: Command, deps: ProgramDeps): void {
  const { io, system } = deps;
  const deploys = withServiceOption(
    program.command("deploys").description("inspect the deploys of a service"),
  );
  const target = () => resolveTarget(deps, serviceRef(deploys, deps));

  async function requireDeploy(deployId: string) {
    const resolved = await target();
    const deploy = await resolved.client.getDeploy(resolved.serviceId, deployId);
    if (!deploy) throw new UsageError(`No deploy ${deployId} on ${resolved.label}`);
    return { ...resolved, deploy };
  }

  deploys
    .command("list")
    .alias("ls")
    .description("list the most recent deploys")
    .option(
      "-n, --limit <count>",
      "how many deploys to show (max 100)",
      positiveInteger("--limit", 100),
      10,
    )
    .option("--json", "print JSON")
    .action(async (options: { limit: number; json?: boolean }) => {
      const { client, serviceId } = await target();
      const list = await client.listDeploys(serviceId, options.limit);
      if (options.json) {
        io.out(JSON.stringify(list, null, 2));
        return;
      }
      if (list.length === 0) {
        io.err("No deploys");
        return;
      }
      const rows = list.map((deploy) => [
        deploy.id,
        deploy.status ?? "",
        deploy.trigger ?? "",
        time(deploy.createdAt),
        time(deploy.finishedAt),
        commitLabel(deploy),
      ]);
      for (const line of table(
        ["ID", "STATUS", "TRIGGER", "CREATED", "FINISHED", "COMMIT"],
        rows,
      )) {
        io.out(line);
      }
    });

  deploys
    .command("get")
    .description("show one deploy")
    .argument("<deploy-id>")
    .option("--json", "print JSON")
    .action(async (deployId: string, options: { json?: boolean }) => {
      const { deploy } = await requireDeploy(deployId);
      if (options.json) io.out(JSON.stringify(deploy, null, 2));
      else for (const line of describeDeploy(deploy)) io.out(line);
    });

  deploys
    .command("wait")
    .description("wait until a deploy is live; exits non-zero if it fails or is canceled")
    .argument("<deploy-id>")
    .option("--interval <seconds>", "seconds between checks", positiveInteger("--interval"), 5)
    .option(
      "--timeout <seconds>",
      "give up after this many seconds",
      positiveInteger("--timeout"),
      1800,
    )
    .action(async (deployId: string, options: { interval: number; timeout: number }) => {
      const resolved = await target();
      const deadline = system.now() + options.timeout * 1000;
      let lastStatus: string | undefined;

      for (;;) {
        const deploy = await resolved.client.getDeploy(resolved.serviceId, deployId);
        if (!deploy) throw new UsageError(`No deploy ${deployId} on ${resolved.label}`);
        const status = deploy.status ?? "unknown";
        if (status !== lastStatus) {
          io.out(`${new Date(system.now()).toISOString().replace(/\.\d+Z$/, "Z")}  ${status}`);
          lastStatus = status;
        }
        if (SUCCEEDED_STATUSES.has(status)) {
          io.out(`Deploy ${deployId} is live`);
          return;
        }
        if (FAILED_STATUSES.has(status)) {
          throw new Error(
            `Deploy ${deployId} ended with status ${status}; see its logs with: render-cli logs -s ${resolved.serviceId} --deploy ${deployId}`,
          );
        }
        if (system.now() >= deadline) {
          throw new Error(
            `Gave up after ${options.timeout}s; deploy ${deployId} is still ${status}`,
          );
        }
        await system.sleep(options.interval * 1000);
      }
    });
}
