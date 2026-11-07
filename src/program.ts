import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { registerDeploysCommands } from "./commands/deploys.js";
import { registerEnvCommands } from "./commands/env.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerServicesCommands } from "./commands/services.js";
import { registerSetupCommand } from "./commands/setup.js";
import type { ProgramDeps } from "./context.js";

export function buildProgram(deps: ProgramDeps): Command {
  const program = new Command()
    .name("render-cli")
    .description("Manage Render.com services from the command line")
    .version(packageJson.version)
    .showHelpAfterError()
    .configureOutput({
      writeOut: (text) => deps.io.out(text.replace(/\n$/, "")),
      writeErr: (text) => deps.io.err(text.replace(/\n$/, "")),
    });

  registerSetupCommand(program, deps);
  registerEnvCommands(program, deps);
  registerServicesCommands(program, deps);
  registerDeploysCommands(program, deps);
  registerLogsCommand(program, deps);
  return program;
}
