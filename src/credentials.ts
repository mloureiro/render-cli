import { join } from "node:path";
import { type ProgramDeps, UsageError } from "./context.js";

export const API_KEY_URL = "https://dashboard.render.com/u/settings?add-api-key";
export const API_KEY_ENV = "RENDER_API_KEY";

export type KeySource = "env" | "config" | "render-cli";

export interface ResolvedKey {
  apiKey: string;
  source: KeySource;
}

type Env = ProgramDeps["env"];

export function credentialsPath(env: Env, homeDir: string): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || join(homeDir, ".config");
  return join(configHome, "render-cli", "credentials.json");
}

export function renderCliConfigPath(env: Env, homeDir: string): string {
  const expand = (path: string) => (path.startsWith("~/") ? join(homeDir, path.slice(2)) : path);
  if (env.RENDER_CLI_CONFIG_PATH) return expand(env.RENDER_CLI_CONFIG_PATH);
  return join(expand(env.RENDER_CLI_CONFIG_DIR || join(homeDir, ".render")), "cli.yaml");
}

export function serializeCredentials(apiKey: string): string {
  return `${JSON.stringify({ apiKey }, null, 2)}\n`;
}

export function parseCredentials(contents: string): string | undefined {
  try {
    const { apiKey } = JSON.parse(contents) as { apiKey?: unknown };
    return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function parseRenderCliKey(contents: string, nowMs: number): string | undefined {
  const apiBlock = contents.match(/^api:\s*\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? "";
  const key = apiBlock.match(/^[ \t]+key:[ \t]*["']?([^"'\s]+)["']?/m)?.[1];
  const expiresAt = Number(apiBlock.match(/^[ \t]+expires_at:[ \t]*(\d+)/m)?.[1] ?? 0);
  if (!key) return undefined;
  if (expiresAt > 0 && expiresAt * 1000 <= nowMs) return undefined;
  return key;
}

export function upsertEnvLine(contents: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=.*$`, "m");
  if (pattern.test(contents)) return contents.replace(pattern, () => line);
  const separator = contents === "" || contents.endsWith("\n") ? "" : "\n";
  return `${contents}${separator}${line}\n`;
}

export async function findApiKey({
  env,
  files,
  system,
}: Pick<ProgramDeps, "env" | "files" | "system">): Promise<ResolvedKey | undefined> {
  const fromEnv = env[API_KEY_ENV]?.trim();
  if (fromEnv) return { apiKey: fromEnv, source: "env" };

  const stored = await files.read(credentialsPath(env, system.homeDir));
  const fromConfig = stored === undefined ? undefined : parseCredentials(stored);
  if (fromConfig) return { apiKey: fromConfig, source: "config" };

  const renderCli = await files.read(renderCliConfigPath(env, system.homeDir));
  const fromRenderCli =
    renderCli === undefined ? undefined : parseRenderCliKey(renderCli, system.now());
  if (fromRenderCli) return { apiKey: fromRenderCli, source: "render-cli" };

  return undefined;
}

export async function requireApiKey(deps: ProgramDeps): Promise<string> {
  const found = await findApiKey(deps);
  if (found) return found.apiKey;
  if (!deps.io.stdinIsTTY) {
    throw new UsageError(`No Render API key found; run "render-cli setup" or set ${API_KEY_ENV}`);
  }
  deps.io.err(`No saved API key; "render-cli setup" stores one. Create a key at ${API_KEY_URL}`);
  const prompted = (await deps.io.promptHidden("Render API key: ")).trim();
  if (!prompted) throw new UsageError("No API key provided");
  return prompted;
}
