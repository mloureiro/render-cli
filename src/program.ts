import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { registerEnvCommands } from "./commands/env.js";
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
  return program;
}
