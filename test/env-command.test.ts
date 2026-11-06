import { describe, expect, it } from "vitest";
import { harness as setup } from "./harness.js";

const SECRET = "super-secret-value";

describe("service selection", () => {
  it("resolves a service by exact name", async () => {
    const { run, out } = setup({
      env: { RENDER_SERVICE: undefined },
      services: [{ id: "srv-cms1", name: "tunadao-cms", type: "web_service" }],
    });
    await run("env", "set", "--service", "tunadao-cms", "A", "1");
    expect(out).toContain("Set A on tunadao-cms (srv-cms1)");
  });

  it("rejects an ambiguous name", async () => {
    const { run } = setup({
      services: [
        { id: "srv-1", name: "api", type: "web_service" },
        { id: "srv-2", name: "api", type: "web_service" },
      ],
    });
    await expect(run("env", "-s", "api", "list")).rejects.toThrow(/srv-1, srv-2/);
  });

  it("rejects an unknown name", async () => {
    const { run } = setup();
    await expect(run("env", "-s", "nope", "list")).rejects.toThrow(/No service named "nope"/);
  });

  it("requires a service", async () => {
    const { run } = setup({ env: { RENDER_SERVICE: undefined } });
    await expect(run("env", "list")).rejects.toThrow(/Missing service/);
  });
});

describe("list", () => {
  it("masks values by default", async () => {
    const { run, out } = setup({ envVars: { TOKEN: SECRET, A: "1" } });
    await run("env", "list");
    expect(out).toEqual(["A      ********", "TOKEN  ********"]);
  });

  it("shows values with --show-values", async () => {
    const { run, out } = setup({ envVars: { TOKEN: SECRET } });
    await run("env", "list", "--show-values", "--json");
    expect(JSON.parse(out.join("\n"))).toEqual([{ key: "TOKEN", value: SECRET }]);
  });
});

describe("get", () => {
  it("prints the value", async () => {
    const { run, out } = setup({ envVars: { TOKEN: SECRET } });
    await run("env", "get", "TOKEN");
    expect(out).toEqual([SECRET]);
  });

  it("fails for a missing key", async () => {
    const { run } = setup();
    await expect(run("env", "get", "NOPE")).rejects.toThrow(/NOPE is not set on srv-abc/);
  });
});

describe("set", () => {
  it("reads the value from stdin without the trailing newline and does not echo it", async () => {
    const { run, store, output } = setup({ stdin: `${SECRET}\n` });
    await run("env", "set", "TOKEN");
    expect(store.get("TOKEN")).toBe(SECRET);
    expect(output()).not.toContain(SECRET);
  });

  it("prompts with hidden input on a terminal", async () => {
    const { run, store, io } = setup({ stdinIsTTY: true, prompt: SECRET });
    await run("env", "set", "TOKEN");
    expect(io.promptHidden).toHaveBeenCalledWith("Value for TOKEN: ");
    expect(store.get("TOKEN")).toBe(SECRET);
  });

  it("asks Render to generate a value with --generate", async () => {
    const { run, client } = setup();
    await run("env", "set", "SESSION_SECRET", "--generate");
    expect(client.setEnvVar).toHaveBeenCalledWith("srv-abc", "SESSION_SECRET", {
      generateValue: true,
    });
  });

  it("rejects a value together with --generate", async () => {
    const { run, client } = setup();
    await expect(run("env", "set", "A", "1", "--generate")).rejects.toThrow(/not both/);
    expect(client.setEnvVar).not.toHaveBeenCalled();
  });

  it("triggers a deploy with --deploy", async () => {
    const { run, client, out } = setup();
    await run("env", "set", "A", "1", "--deploy");
    expect(client.triggerDeploy).toHaveBeenCalledWith("srv-abc");
    expect(out).toContain("Deploy triggered: dep-123");
  });
});

describe("unset", () => {
  it("deletes existing keys and reports missing ones", async () => {
    const { run, store, out, err, client } = setup({ envVars: { A: "1" } });
    await run("env", "unset", "A", "B", "--deploy");
    expect(store.has("A")).toBe(false);
    expect(out).toContain("Deleted A from srv-abc");
    expect(err).toEqual(["B is not set on srv-abc"]);
    expect(client.triggerDeploy).toHaveBeenCalledOnce();
  });

  it("does not deploy when nothing was deleted", async () => {
    const { run, client } = setup();
    await run("env", "unset", "B", "--deploy");
    expect(client.triggerDeploy).not.toHaveBeenCalled();
  });
});

describe("import", () => {
  const files = { ".env": `KEEP=same\nCHANGE=${SECRET}\nNEW=fresh\n` };
  const envVars = { KEEP: "same", CHANGE: "old", EXTRA: "x" };

  it("shows the diff by key only and writes nothing on --dry-run", async () => {
    const { run, out, output, client } = setup({ files, envVars });
    await run("env", "import", ".env", "--dry-run");
    expect(out).toEqual([
      "+ NEW",
      "~ CHANGE",
      "1 to add, 1 to change, 0 to delete, 1 unchanged",
      "1 on Render but not in the file (kept; --prune deletes them)",
    ]);
    expect(output()).not.toContain(SECRET);
    expect(client.setEnvVar).not.toHaveBeenCalled();
  });

  it("refuses to apply without --yes when there is no terminal", async () => {
    const { run, client } = setup({ files, envVars });
    await expect(run("env", "import", ".env")).rejects.toThrow(/pass --yes/);
    expect(client.setEnvVar).not.toHaveBeenCalled();
  });

  it("asks for confirmation on a terminal and stops on no", async () => {
    const { run, io, client } = setup({ files, envVars, stdinIsTTY: true, confirm: false });
    await run("env", "import", ".env");
    expect(io.confirm).toHaveBeenCalledOnce();
    expect(client.setEnvVar).not.toHaveBeenCalled();
  });

  it("applies changes with --yes and keeps remote-only keys", async () => {
    const { run, store } = setup({ files, envVars });
    await run("env", "import", ".env", "--yes");
    expect(Object.fromEntries(store)).toEqual({
      KEEP: "same",
      CHANGE: SECRET,
      NEW: "fresh",
      EXTRA: "x",
    });
  });

  it("deletes remote-only keys with --prune", async () => {
    const { run, store, out } = setup({ files, envVars });
    await run("env", "import", ".env", "--yes", "--prune");
    expect(store.has("EXTRA")).toBe(false);
    expect(out).toContain("- EXTRA");
  });

  it("does nothing when already in sync", async () => {
    const { run, client } = setup({ files: { ".env": "A=1\n" }, envVars: { A: "1" } });
    await run("env", "import", ".env", "--yes", "--deploy");
    expect(client.setEnvVar).not.toHaveBeenCalled();
    expect(client.triggerDeploy).not.toHaveBeenCalled();
  });

  it("reads the file from stdin with -", async () => {
    const { run, store } = setup({ stdin: "FROM_STDIN=1\n" });
    await run("env", "import", "-", "--yes");
    expect(store.get("FROM_STDIN")).toBe("1");
  });
});
