import { describe, expect, it } from "vitest";
import { parseRenderCliKey, upsertEnvLine } from "../src/credentials.js";
import { HOME, harness } from "./harness.js";

const CONFIG = `${HOME}/.config/render-cli/credentials.json`;
const RENDER_CLI = `${HOME}/.render/cli.yaml`;
const NOW = Date.UTC(2026, 10, 6);
const noEnvKey = { RENDER_API_KEY: undefined };

const renderCliYaml = (key: string, expiresAt?: number) =>
  `version: 1\nworkspace: tea-1\napi:\n    key: ${key}\n${
    expiresAt === undefined ? "" : `    expires_at: ${expiresAt}\n`
  }    host: https://api.render.com/v1/\n`;

describe("API key resolution", () => {
  it("prefers RENDER_API_KEY over saved keys", async () => {
    const { run, clientOptions } = harness({
      files: { [CONFIG]: JSON.stringify({ apiKey: "rnd_config" }) },
    });
    await run("env", "list");
    expect(clientOptions[0]?.apiKey).toBe("rnd_key");
  });

  it("uses the render-cli credentials file", async () => {
    const { run, clientOptions } = harness({
      env: noEnvKey,
      files: {
        [CONFIG]: JSON.stringify({ apiKey: "rnd_config" }),
        [RENDER_CLI]: renderCliYaml("rnd_official"),
      },
    });
    await run("env", "list");
    expect(clientOptions[0]?.apiKey).toBe("rnd_config");
  });

  it("honours XDG_CONFIG_HOME", async () => {
    const { run, clientOptions } = harness({
      env: { ...noEnvKey, XDG_CONFIG_HOME: "/xdg" },
      files: { "/xdg/render-cli/credentials.json": JSON.stringify({ apiKey: "rnd_xdg" }) },
    });
    await run("env", "list");
    expect(clientOptions[0]?.apiKey).toBe("rnd_xdg");
  });

  it("falls back to the key saved by `render login`", async () => {
    const { run, clientOptions } = harness({
      env: noEnvKey,
      files: { [RENDER_CLI]: renderCliYaml("rnd_official", NOW / 1000 + 3600) },
    });
    await run("env", "list");
    expect(clientOptions[0]?.apiKey).toBe("rnd_official");
  });

  it("prompts on a terminal when no key is saved", async () => {
    const { run, clientOptions, io } = harness({
      env: noEnvKey,
      stdinIsTTY: true,
      prompt: "rnd_prompted",
      files: { [RENDER_CLI]: renderCliYaml("rnd_expired", NOW / 1000 - 1) },
    });
    await run("env", "list");
    expect(io.promptHidden).toHaveBeenCalledWith("Render API key: ");
    expect(clientOptions[0]?.apiKey).toBe("rnd_prompted");
  });

  it("points to setup when there is no key and no terminal", async () => {
    const { run } = harness({ env: noEnvKey });
    await expect(run("env", "list")).rejects.toThrow(/run "render-cli setup"/);
  });
});

describe("parseRenderCliKey", () => {
  it("ignores keys outside the api block", () => {
    expect(parseRenderCliKey("other:\n    key: nope\n", NOW)).toBeUndefined();
  });

  it("drops an expired login token", () => {
    expect(parseRenderCliKey(renderCliYaml("rnd_x", NOW / 1000), NOW)).toBeUndefined();
  });
});

describe("upsertEnvLine", () => {
  it("replaces an existing assignment, including an exported one", () => {
    expect(upsertEnvLine("A=1\nexport RENDER_API_KEY=old\nB=2\n", "RENDER_API_KEY", "new")).toBe(
      "A=1\nRENDER_API_KEY=new\nB=2\n",
    );
  });

  it("appends to a file without a trailing newline", () => {
    expect(upsertEnvLine("A=1", "RENDER_API_KEY", "k")).toBe("A=1\nRENDER_API_KEY=k\n");
  });

  it("keeps a $ in the value literal", () => {
    expect(upsertEnvLine("RENDER_API_KEY=old\n", "RENDER_API_KEY", "a$&b")).toBe(
      "RENDER_API_KEY=a$&b\n",
    );
  });
});
