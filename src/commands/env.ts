import type { Command } from "commander";
import { type ProgramDeps, UsageError } from "../context.js";
import { diffEnv, parseEnvFile } from "../env-file.js";
import { resolveTarget, serviceRef, type Target, withServiceOption } from "../target.js";

const MASK = "********";

export function registerEnvCommands(program: Command, deps: ProgramDeps): void {
  const { io } = deps;
  const envCommand = withServiceOption(
    program.command("env").description("manage the environment variables of a service"),
  );

  const target = () => resolveTarget(deps, serviceRef(envCommand, deps));

  async function deployIfRequested(
    shouldDeploy: boolean | undefined,
    { client, serviceId }: Target,
  ) {
    if (!shouldDeploy) return;
    const deploy = await client.triggerDeploy(serviceId);
    io.out(deploy ? `Deploy triggered: ${deploy.id}` : "Deploy queued");
  }

  async function readRequiredFile(path: string): Promise<string> {
    const contents = await deps.files.read(path);
    if (contents === undefined) throw new UsageError(`File not found: ${path}`);
    return contents;
  }

  async function readValue(key: string, valueArg: string | undefined): Promise<string> {
    if (valueArg !== undefined) return valueArg;
    if (!io.stdinIsTTY) return (await io.readStdin()).replace(/\r?\n$/, "");
    return io.promptHidden(`Value for ${key}: `);
  }

  envCommand
    .command("list")
    .alias("ls")
    .description("list environment variables (values are masked unless --show-values)")
    .option("--show-values", "print the actual values")
    .option("--json", "print JSON")
    .action(async (options: { showValues?: boolean; json?: boolean }) => {
      const { client, serviceId } = await target();
      const envVars = (await client.listEnvVars(serviceId)).sort((a, b) =>
        a.key.localeCompare(b.key),
      );
      const shown = envVars.map(({ key, value }) => ({
        key,
        value: options.showValues ? value : MASK,
      }));

      if (options.json) {
        io.out(JSON.stringify(shown, null, 2));
        return;
      }
      if (shown.length === 0) {
        io.err("No environment variables");
        return;
      }
      const width = Math.max(...shown.map(({ key }) => key.length));
      for (const { key, value } of shown) io.out(`${key.padEnd(width)}  ${value}`);
    });

  envCommand
    .command("get")
    .description("print the value of one environment variable")
    .argument("<key>")
    .action(async (key: string) => {
      const { client, serviceId, label } = await target();
      const envVar = await client.getEnvVar(serviceId, key);
      if (!envVar) throw new UsageError(`${key} is not set on ${label}`);
      io.out(envVar.value);
    });

  envCommand
    .command("set")
    .description(
      "create or update an environment variable; without [value] it is read from stdin or a hidden prompt",
    )
    .argument("<key>")
    .argument(
      "[value]",
      "the value (ends up in shell history; prefer stdin or the prompt for secrets)",
    )
    .option("--generate", "let Render generate a random value")
    .option("--deploy", "trigger a deploy afterwards")
    .action(
      async (
        key: string,
        valueArg: string | undefined,
        options: { generate?: boolean; deploy?: boolean },
      ) => {
        if (options.generate && valueArg !== undefined) {
          throw new UsageError("Pass either a value or --generate, not both");
        }
        const resolved = await target();
        const input = options.generate
          ? ({ generateValue: true } as const)
          : { value: await readValue(key, valueArg) };
        await resolved.client.setEnvVar(resolved.serviceId, key, input);
        io.out(`Set ${key} on ${resolved.label}`);
        await deployIfRequested(options.deploy, resolved);
      },
    );

  envCommand
    .command("unset")
    .alias("rm")
    .description("delete one or more environment variables")
    .argument("<keys...>")
    .option("--deploy", "trigger a deploy afterwards")
    .action(async (keys: string[], options: { deploy?: boolean }) => {
      const resolved = await target();
      let deleted = 0;
      for (const key of keys) {
        if (await resolved.client.deleteEnvVar(resolved.serviceId, key)) {
          deleted++;
          io.out(`Deleted ${key} from ${resolved.label}`);
        } else {
          io.err(`${key} is not set on ${resolved.label}`);
        }
      }
      if (deleted > 0) await deployIfRequested(options.deploy, resolved);
    });

  envCommand
    .command("import")
    .description("set every variable from a .env file, showing the changes first")
    .argument("<file>", "path to a .env file, or - for stdin")
    .option("--dry-run", "only show what would change")
    .option("--prune", "also delete variables that are not in the file")
    .option("-y, --yes", "apply without asking for confirmation")
    .option("--deploy", "trigger a deploy afterwards")
    .action(
      async (
        file: string,
        options: { dryRun?: boolean; prune?: boolean; yes?: boolean; deploy?: boolean },
      ) => {
        const local = parseEnvFile(
          file === "-" ? await io.readStdin() : await readRequiredFile(file),
        );
        const resolved = await target();
        const diff = diffEnv(await resolved.client.listEnvVars(resolved.serviceId), local);
        const removals = options.prune ? diff.removed : [];

        for (const key of diff.added) io.out(`+ ${key}`);
        for (const key of diff.changed) io.out(`~ ${key}`);
        for (const key of removals) io.out(`- ${key}`);
        io.out(
          `${diff.added.length} to add, ${diff.changed.length} to change, ${removals.length} to delete, ${diff.unchanged.length} unchanged`,
        );
        if (!options.prune && diff.removed.length > 0) {
          io.out(
            `${diff.removed.length} on Render but not in the file (kept; --prune deletes them)`,
          );
        }

        const updates = [...diff.added, ...diff.changed];
        if (updates.length + removals.length === 0 || options.dryRun) return;

        if (!options.yes) {
          if (!io.stdinIsTTY || file === "-") {
            throw new UsageError("Refusing to apply without confirmation; pass --yes");
          }
          if (!(await io.confirm(`Apply these changes to ${resolved.label}?`))) {
            io.err("Aborted");
            return;
          }
        }

        for (const key of updates) {
          await resolved.client.setEnvVar(resolved.serviceId, key, { value: local[key] ?? "" });
        }
        for (const key of removals) await resolved.client.deleteEnvVar(resolved.serviceId, key);
        io.out(`Applied ${updates.length + removals.length} change(s) to ${resolved.label}`);
        await deployIfRequested(options.deploy, resolved);
      },
    );
}
