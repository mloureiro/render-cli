import { vi } from "vitest";
import type { ClientOptions, RenderClient, Service, Workspace } from "../src/client.js";
import type { ProgramDeps } from "../src/context.js";
import { buildProgram } from "../src/program.js";

export const HOME = "/home/test";

export interface HarnessOptions {
  envVars?: Record<string, string>;
  services?: Service[];
  workspaces?: Workspace[];
  env?: Record<string, string | undefined>;
  stdinIsTTY?: boolean;
  stdin?: string;
  prompt?: string;
  confirm?: boolean;
  answer?: string;
  files?: Record<string, string>;
  gitIgnored?: boolean;
  openUrl?: boolean;
  now?: number;
  listWorkspaces?: RenderClient["listWorkspaces"];
}

export function harness(options: HarnessOptions = {}) {
  const store = new Map(Object.entries(options.envVars ?? {}));
  const files = new Map(Object.entries(options.files ?? {}));
  const modes = new Map<string, number>();
  const out: string[] = [];
  const err: string[] = [];
  const clientOptions: ClientOptions[] = [];

  const client = {
    listEnvVars: vi.fn(async () => [...store].map(([key, value]) => ({ key, value }))),
    getEnvVar: vi.fn(async (_id: string, key: string) => {
      const value = store.get(key);
      return value === undefined ? undefined : { key, value };
    }),
    setEnvVar: vi.fn(async (_id: string, key: string, input) => {
      const value = "value" in input ? input.value : "generated";
      store.set(key, value);
      return { key, value };
    }),
    deleteEnvVar: vi.fn(async (_id: string, key: string) => store.delete(key)),
    getService: vi.fn(async () => undefined),
    findServicesByName: vi.fn(async (name: string) =>
      (options.services ?? []).filter((service) => service.name === name),
    ),
    triggerDeploy: vi.fn(async () => ({ id: "dep-123" })),
    listWorkspaces: vi.fn(
      options.listWorkspaces ??
        (async () => options.workspaces ?? [{ id: "tea-1", name: "My Workspace" }]),
    ),
  } satisfies RenderClient;

  const io = {
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
    stdinIsTTY: options.stdinIsTTY ?? false,
    readStdin: vi.fn(async () => options.stdin ?? ""),
    promptHidden: vi.fn(async () => options.prompt ?? ""),
    confirm: vi.fn(async () => options.confirm ?? false),
    ask: vi.fn(async () => options.answer ?? ""),
  };

  const system = {
    homeDir: HOME,
    now: () => options.now ?? Date.UTC(2026, 10, 6),
    openUrl: vi.fn(async () => options.openUrl ?? true),
    isGitIgnored: vi.fn(async () => options.gitIgnored),
  };

  const deps: ProgramDeps = {
    env: { RENDER_API_KEY: "rnd_key", RENDER_SERVICE: "srv-abc", ...options.env },
    createClient: (opts) => {
      clientOptions.push(opts);
      return client;
    },
    io,
    system,
    files: {
      read: async (path) => files.get(path),
      write: async (path, contents, mode) => {
        files.set(path, contents);
        modes.set(path, mode);
      },
    },
  };

  const program = buildProgram(deps);
  program.exitOverride();

  const run = (...args: string[]) => program.parseAsync(["node", "render-cli", ...args]);
  const output = () => [...out, ...err].join("\n");
  return { run, store, files, modes, out, err, output, client, clientOptions, io, system };
}
