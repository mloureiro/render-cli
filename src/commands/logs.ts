import type { Command } from "commander";
import type { LogEntry, LogQuery } from "../client.js";
import { type ProgramDeps, UsageError } from "../context.js";
import { resolveService, serviceRef, withServiceOption } from "../target.js";

const MAX_PAGE = 100;
const DEPLOY_LOG_GRACE_MS = 60_000;

interface LogsOptions {
  deploy?: string;
  type?: string;
  limit: number;
  since?: string;
  until?: string;
  json?: boolean;
}

function isoTime(name: string) {
  return (value: string) => {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
      throw new UsageError(`${name} must be a date/time such as 2026-11-07T10:00:00Z`);
    return new Date(parsed).toISOString();
  };
}

function positiveInteger(value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1)
    throw new UsageError("--limit must be a whole number from 1");
  return parsed;
}

const label = (entry: LogEntry, name: string) =>
  entry.labels.find((candidate) => candidate.name === name)?.value;

export function registerLogsCommand(program: Command, deps: ProgramDeps): void {
  const { io, system } = deps;
  const logs = withServiceOption(
    program
      .command("logs")
      .description("print build and runtime logs of a service, oldest first")
      .option("--deploy <deploy-id>", "only logs from the time window of this deploy")
      .option("--type <type>", "build, app or request")
      .option("-n, --limit <count>", "maximum number of lines", positiveInteger, 100)
      .option("--since <time>", "start of the time window (ISO 8601)", isoTime("--since"))
      .option("--until <time>", "end of the time window (ISO 8601)", isoTime("--until"))
      .option("--json", "print JSON"),
  );

  logs.action(async (options: LogsOptions) => {
    const { client, service } = await resolveService(deps, serviceRef(logs, deps));
    if (!service.ownerId) throw new UsageError(`Render did not return the owner of ${service.id}`);

    let startTime = options.since;
    let endTime = options.until;
    if (options.deploy) {
      const deploy = await client.getDeploy(service.id, options.deploy);
      if (!deploy)
        throw new UsageError(`No deploy ${options.deploy} on ${service.name} (${service.id})`);
      startTime ??= deploy.startedAt ?? deploy.createdAt;
      endTime ??= deploy.finishedAt
        ? new Date(Date.parse(deploy.finishedAt) + DEPLOY_LOG_GRACE_MS).toISOString()
        : new Date(system.now()).toISOString();
    }

    const direction = startTime ? "forward" : "backward";
    const query: LogQuery = {
      ownerId: service.ownerId,
      resource: service.id,
      type: options.type,
      startTime,
      endTime,
      direction,
    };

    const entries: LogEntry[] = [];
    for (;;) {
      const page = await client.listLogs({
        ...query,
        limit: Math.min(MAX_PAGE, options.limit - entries.length),
      });
      entries.push(...page.logs);
      if (!page.hasMore || entries.length >= options.limit) break;
      query.startTime = page.nextStartTime;
      query.endTime = page.nextEndTime;
    }

    const ordered = direction === "backward" ? entries.reverse() : entries;
    const shown = ordered.slice(0, options.limit);
    if (options.json) {
      io.out(JSON.stringify(shown, null, 2));
      return;
    }
    if (shown.length === 0) {
      io.err("No logs in this window");
      return;
    }
    for (const entry of shown) {
      const type = label(entry, "type");
      io.out(`${entry.timestamp}${type ? ` [${type}]` : ""} ${entry.message.trimEnd()}`);
    }
  });
}
