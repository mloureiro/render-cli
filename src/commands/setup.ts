import type { Command } from "commander";
import { RenderApiError } from "../client.js";
import { type ProgramDeps, UsageError } from "../context.js";
import {
  API_KEY_ENV,
  API_KEY_URL,
  credentialsPath,
  serializeCredentials,
  upsertEnvLine,
} from "../credentials.js";

const OWNER_ONLY = 0o600;

interface SetupOptions {
  browser: boolean;
  config: boolean;
  envFile?: string;
}

export function registerSetupCommand(program: Command, deps: ProgramDeps): void {
  const { io, env, files, system } = deps;

  async function readKey(): Promise<string> {
    const key = io.stdinIsTTY ? await io.promptHidden("Paste the API key: ") : await io.readStdin();
    if (!key.trim()) throw new UsageError("No API key provided");
    return key.trim();
  }

  async function verify(apiKey: string): Promise<void> {
    try {
      const workspaces = await deps.createClient({ apiKey }).listWorkspaces();
      io.out(`Key accepted; workspaces: ${workspaces.map((w) => w.name).join(", ") || "none"}`);
    } catch (error) {
      if (error instanceof RenderApiError && error.status === 401) {
        throw new UsageError("Render rejected this API key");
      }
      throw error;
    }
  }

  async function writeEnvFile(path: string, apiKey: string): Promise<void> {
    const existing = (await files.read(path)) ?? "";
    await files.write(path, upsertEnvLine(existing, API_KEY_ENV, apiKey), OWNER_ONLY);
    io.out(`Wrote ${API_KEY_ENV} to ${path}`);
    if ((await system.isGitIgnored(path)) === false) {
      io.err(
        `Warning: ${path} is not ignored by git; add it to .gitignore so the key is never committed`,
      );
    }
  }

  const setup = program
    .command("setup")
    .description("create a Render API key in the browser and store it for render-cli")
    .option("--no-browser", "print the URL instead of opening it")
    .option("--no-config", "do not save the key in the render-cli credentials file")
    .option("--env-file <path>", `also write ${API_KEY_ENV} to this .env file`)
    .action(async (options: SetupOptions) => {
      const configPath = credentialsPath(env, system.homeDir);
      const askWhereToStore =
        io.stdinIsTTY &&
        setup.getOptionValueSource("config") === "default" &&
        options.envFile === undefined;

      io.out(`Create an API key at ${API_KEY_URL}`);
      if (options.browser && io.stdinIsTTY && !(await system.openUrl(API_KEY_URL))) {
        io.err("Could not open a browser; open the URL above manually");
      }

      const apiKey = await readKey();
      await verify(apiKey);

      const saveConfig = askWhereToStore
        ? await io.confirm(`Save it to ${configPath}?`, true)
        : options.config;
      const envFile = askWhereToStore
        ? (
            await io.ask(`Also write ${API_KEY_ENV} to a .env file? Path, or empty to skip: `)
          ).trim()
        : options.envFile;

      if (saveConfig) {
        await files.write(configPath, serializeCredentials(apiKey), OWNER_ONLY);
        io.out(`Saved to ${configPath}`);
      }
      if (envFile) await writeEnvFile(envFile, apiKey);
      if (!saveConfig && !envFile) {
        io.out(`Not saved. Export ${API_KEY_ENV} in your shell to use it.`);
      }

      const envKey = env[API_KEY_ENV]?.trim();
      if (envKey && envKey !== apiKey) {
        io.err(`Note: ${API_KEY_ENV} is set in this shell and takes precedence over the saved key`);
      }
    });
}
