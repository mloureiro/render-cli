import { describe, expect, it, vi } from "vitest";
import type { ClientOptions, EnvVarInput, RenderClient, Service } from "../src/client.js";
import { buildProgram } from "../src/program.js";

const SECRET = "super-secret-value";

interface Setup {
  envVars?: Record<string, string>;
  services?: Service[];
  env?: Record<string, string | undefined>;
  stdinIsTTY?: boolean;
  stdin?: string;
  prompt?: string;
  confirm?: boolean;
  files?: Record<string, string>;
}

function setup(options: Setup = {}) {
  const store = new Map(Object.entries(options.envVars ?? {}));
  const out: string[] = [];
  const err: string[] = [];
  const clientOptions: ClientOptions[] = [];
  const setCalls: Array<{ key: string; input: EnvVarInput }> = [];

  const client: RenderClient = {
    listEnvVars: async () => [...store].map(([key, value]) => ({ key, value })),
    getEnvVar: async (_id, key) => {
      const value = store.get(key);
      return value === undefined ? undefined : { key, value };
    },
    setEnvVar: async (_id, key, input) => {
      setCalls.push({ key, input });
      const value = "value" in input ? input.value : "generated";
      store.set(key, value);
      return { key, value };
    },
    deleteEnvVar: async (_id, key) => store.delete(key),
    getService: async () => undefined,
    findServicesByName: async (name) => (options.services ?? []).filter((s) => s.name === name),
    triggerDeploy: vi.fn(async () => ({ id: "dep-123" })),
  };

  const promptHidden = vi.fn(async () => options.prompt ?? "");
  const confirm = vi.fn(async () => options.confirm ?? false);

  const program = buildProgram({
    env: { RENDER_API_KEY: "rnd_key", RENDER_SERVICE: "srv-abc", ...options.env },
    createClient: (opts) => {
      clientOptions.push(opts);
      return client;
    },
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      stdinIsTTY: options.stdinIsTTY ?? false,
      readStdin: async () => options.stdin ?? "",
      promptHidden,
      confirm,
      readFile: async (path) => {
        const contents = options.files?.[path];
        if (contents === undefined) throw new Error(`ENOENT: ${path}`);
        return contents;
      },
    },
  });
  program.exitOverride();

  const run = (...args: string[]) => program.parseAsync(["node", "render-env", ...args]);
  const output = () => [...out, ...err].join("\n");
  return { run, store, out, err, output, client, clientOptions, setCalls, promptHidden, confirm };
}

describe("authentication", () => {
  it("uses RENDER_API_KEY", async () => {
    const { run, clientOptions } = setup();
    await run("list");
    expect(clientOptions[0]?.apiKey).toBe("rnd_key");
  });

  it("prompts for the key without echo when it is missing on a terminal", async () => {
    const { run, clientOptions, promptHidden } = setup({
      env: { RENDER_API_KEY: undefined },
      stdinIsTTY: true,
      prompt: "rnd_prompted",
    });
    await run("list");
    expect(promptHidden).toHaveBeenCalledWith("Render API key: ");
    expect(clientOptions[0]?.apiKey).toBe("rnd_prompted");
  });

  it("fails when the key is missing and there is no terminal", async () => {
    const { run } = setup({ env: { RENDER_API_KEY: undefined } });
    await expect(run("list")).rejects.toThrow(/RENDER_API_KEY is not set/);
  });
});

describe("service selection", () => {
  it("resolves a service by exact name", async () => {
    const { run, out } = setup({
      env: { RENDER_SERVICE: undefined },
      services: [{ id: "srv-cms1", name: "tunadao-cms", type: "web_service" }],
    });
    await run("set", "--service", "tunadao-cms", "A", "1");
    expect(out).toContain("Set A on tunadao-cms (srv-cms1)");
  });

  it("rejects an ambiguous name", async () => {
    const { run } = setup({
      services: [
        { id: "srv-1", name: "api", type: "web_service" },
        { id: "srv-2", name: "api", type: "web_service" },
      ],
    });
    await expect(run("-s", "api", "list")).rejects.toThrow(/srv-1, srv-2/);
  });

  it("rejects an unknown name", async () => {
    const { run } = setup();
    await expect(run("-s", "nope", "list")).rejects.toThrow(/No service named "nope"/);
  });

  it("requires a service", async () => {
    const { run } = setup({ env: { RENDER_SERVICE: undefined } });
    await expect(run("list")).rejects.toThrow(/Missing service/);
  });
});

describe("list", () => {
  it("masks values by default", async () => {
    const { run, out } = setup({ envVars: { TOKEN: SECRET, A: "1" } });
    await run("list");
    expect(out).toEqual(["A      ********", "TOKEN  ********"]);
  });

  it("shows values with --show-values", async () => {
    const { run, out } = setup({ envVars: { TOKEN: SECRET } });
    await run("list", "--show-values", "--json");
    expect(JSON.parse(out.join("\n"))).toEqual([{ key: "TOKEN", value: SECRET }]);
  });
});

describe("get", () => {
  it("prints the value", async () => {
    const { run, out } = setup({ envVars: { TOKEN: SECRET } });
    await run("get", "TOKEN");
    expect(out).toEqual([SECRET]);
  });

  it("fails for a missing key", async () => {
    const { run } = setup();
    await expect(run("get", "NOPE")).rejects.toThrow(/NOPE is not set on srv-abc/);
  });
});

describe("set", () => {
  it("reads the value from stdin without the trailing newline and does not echo it", async () => {
    const { run, store, output } = setup({ stdin: `${SECRET}\n` });
    await run("set", "TOKEN");
    expect(store.get("TOKEN")).toBe(SECRET);
    expect(output()).not.toContain(SECRET);
  });

  it("prompts with hidden input on a terminal", async () => {
    const { run, store, promptHidden } = setup({ stdinIsTTY: true, prompt: SECRET });
    await run("set", "TOKEN");
    expect(promptHidden).toHaveBeenCalledWith("Value for TOKEN: ");
    expect(store.get("TOKEN")).toBe(SECRET);
  });

  it("asks Render to generate a value with --generate", async () => {
    const { run, setCalls } = setup();
    await run("set", "SESSION_SECRET", "--generate");
    expect(setCalls).toEqual([{ key: "SESSION_SECRET", input: { generateValue: true } }]);
  });

  it("rejects a value together with --generate", async () => {
    const { run, setCalls } = setup();
    await expect(run("set", "A", "1", "--generate")).rejects.toThrow(/not both/);
    expect(setCalls).toEqual([]);
  });

  it("triggers a deploy with --deploy", async () => {
    const { run, client, out } = setup();
    await run("set", "A", "1", "--deploy");
    expect(client.triggerDeploy).toHaveBeenCalledWith("srv-abc");
    expect(out).toContain("Deploy triggered: dep-123");
  });
});

describe("unset", () => {
  it("deletes existing keys and reports missing ones", async () => {
    const { run, store, out, err, client } = setup({ envVars: { A: "1" } });
    await run("unset", "A", "B", "--deploy");
    expect(store.has("A")).toBe(false);
    expect(out).toContain("Deleted A from srv-abc");
    expect(err).toEqual(["B is not set on srv-abc"]);
    expect(client.triggerDeploy).toHaveBeenCalledOnce();
  });

  it("does not deploy when nothing was deleted", async () => {
    const { run, client } = setup();
    await run("unset", "B", "--deploy");
    expect(client.triggerDeploy).not.toHaveBeenCalled();
  });
});

describe("import", () => {
  const files = { ".env": `KEEP=same\nCHANGE=${SECRET}\nNEW=fresh\n` };
  const envVars = { KEEP: "same", CHANGE: "old", EXTRA: "x" };

  it("shows the diff by key only and writes nothing on --dry-run", async () => {
    const { run, out, output, setCalls } = setup({ files, envVars });
    await run("import", ".env", "--dry-run");
    expect(out).toEqual([
      "+ NEW",
      "~ CHANGE",
      "1 to add, 1 to change, 0 to delete, 1 unchanged",
      "1 on Render but not in the file (kept; --prune deletes them)",
    ]);
    expect(output()).not.toContain(SECRET);
    expect(setCalls).toEqual([]);
  });

  it("refuses to apply without --yes when there is no terminal", async () => {
    const { run, setCalls } = setup({ files, envVars });
    await expect(run("import", ".env")).rejects.toThrow(/pass --yes/);
    expect(setCalls).toEqual([]);
  });

  it("asks for confirmation on a terminal and stops on no", async () => {
    const { run, confirm, setCalls } = setup({ files, envVars, stdinIsTTY: true, confirm: false });
    await run("import", ".env");
    expect(confirm).toHaveBeenCalledOnce();
    expect(setCalls).toEqual([]);
  });

  it("applies changes with --yes and keeps remote-only keys", async () => {
    const { run, store } = setup({ files, envVars });
    await run("import", ".env", "--yes");
    expect(Object.fromEntries(store)).toEqual({
      KEEP: "same",
      CHANGE: SECRET,
      NEW: "fresh",
      EXTRA: "x",
    });
  });

  it("deletes remote-only keys with --prune", async () => {
    const { run, store, out } = setup({ files, envVars });
    await run("import", ".env", "--yes", "--prune");
    expect(store.has("EXTRA")).toBe(false);
    expect(out).toContain("- EXTRA");
  });

  it("does nothing when already in sync", async () => {
    const { run, setCalls, client } = setup({ files: { ".env": "A=1\n" }, envVars: { A: "1" } });
    await run("import", ".env", "--yes", "--deploy");
    expect(setCalls).toEqual([]);
    expect(client.triggerDeploy).not.toHaveBeenCalled();
  });

  it("reads the file from stdin with -", async () => {
    const { run, store } = setup({ stdin: "FROM_STDIN=1\n" });
    await run("import", "-", "--yes");
    expect(store.get("FROM_STDIN")).toBe("1");
  });
});
