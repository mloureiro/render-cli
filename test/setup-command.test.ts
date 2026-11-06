import { describe, expect, it } from "vitest";
import { RenderApiError } from "../src/client.js";
import { API_KEY_URL } from "../src/credentials.js";
import { HOME, harness } from "./harness.js";

const CONFIG = `${HOME}/.config/render-cli/credentials.json`;
const KEY = "rnd_new_key";
const noEnvKey = { RENDER_API_KEY: undefined };

describe("setup", () => {
  it("opens the API key page, verifies the key and saves it owner-only", async () => {
    const { run, system, clientOptions, files, modes, out, io } = harness({
      env: noEnvKey,
      stdinIsTTY: true,
      prompt: KEY,
      confirm: true,
    });

    await run("setup");

    expect(system.openUrl).toHaveBeenCalledWith(API_KEY_URL);
    expect(io.promptHidden).toHaveBeenCalledWith("Paste the API key: ");
    expect(clientOptions[0]?.apiKey).toBe(KEY);
    expect(out).toContain("Key accepted; workspaces: My Workspace");
    expect(JSON.parse(files.get(CONFIG) ?? "")).toEqual({ apiKey: KEY });
    expect(modes.get(CONFIG)).toBe(0o600);
  });

  it("never prints the key", async () => {
    const { run, output } = harness({
      env: noEnvKey,
      stdinIsTTY: true,
      prompt: KEY,
      confirm: true,
      answer: ".env",
    });
    await run("setup");
    expect(output()).not.toContain(KEY);
  });

  it("writes the key to the .env file chosen at the prompt", async () => {
    const { run, files, err } = harness({
      env: noEnvKey,
      stdinIsTTY: true,
      prompt: KEY,
      confirm: false,
      answer: " .env ",
      files: { ".env": "PORT=3000\n" },
      gitIgnored: true,
    });

    await run("setup");

    expect(files.get(".env")).toBe(`PORT=3000\nRENDER_API_KEY=${KEY}\n`);
    expect(files.has(CONFIG)).toBe(false);
    expect(err).toEqual([]);
  });

  it("warns when the .env file is not ignored by git", async () => {
    const { run, err } = harness({ env: noEnvKey, stdin: KEY, gitIgnored: false });
    await run("setup", "--env-file", ".env");
    expect(err).toEqual([
      "Warning: .env is not ignored by git; add it to .gitignore so the key is never committed",
    ]);
  });

  it("reads the key from stdin without prompting or opening a browser", async () => {
    const { run, system, io, files } = harness({ env: noEnvKey, stdin: `${KEY}\n` });

    await run("setup");

    expect(system.openUrl).not.toHaveBeenCalled();
    expect(io.confirm).not.toHaveBeenCalled();
    expect(JSON.parse(files.get(CONFIG) ?? "")).toEqual({ apiKey: KEY });
  });

  it("skips the questions when storage flags are given", async () => {
    const { run, io, files, out } = harness({
      env: noEnvKey,
      stdinIsTTY: true,
      prompt: KEY,
    });

    await run("setup", "--no-browser", "--no-config");

    expect(io.confirm).not.toHaveBeenCalled();
    expect(files.has(CONFIG)).toBe(false);
    expect(out).toContain("Not saved. Export RENDER_API_KEY in your shell to use it.");
  });

  it("rejects a key Render refuses and saves nothing", async () => {
    const { run, files } = harness({
      env: noEnvKey,
      stdin: "rnd_bad",
      listWorkspaces: async () => {
        throw new RenderApiError(401, "unauthorized");
      },
    });

    await expect(run("setup")).rejects.toThrow("Render rejected this API key");
    expect(files.size).toBe(0);
  });

  it("notes that a different RENDER_API_KEY in the shell takes precedence", async () => {
    const { run, err } = harness({ env: { RENDER_API_KEY: "rnd_other" }, stdin: KEY });
    await run("setup");
    expect(err).toEqual([
      "Note: RENDER_API_KEY is set in this shell and takes precedence over the saved key",
    ]);
  });
});
