import { describe, expect, it } from "vitest";
import type { Service } from "../src/client.js";
import { harness } from "./harness.js";

const cms: Service = {
  id: "srv-cms",
  name: "tunadao-cms",
  type: "web_service",
  rootDir: "cms",
  autoDeploy: "yes",
  serviceDetails: {
    runtime: "node",
    envSpecificDetails: { buildCommand: "npm run build", startCommand: "npm start" },
  },
};

describe("services update", () => {
  it("prints the diff and sends nothing on --dry-run", async () => {
    const { run, out, client } = harness({ services: [cms] });

    await run(
      "services",
      "update",
      "tunadao-cms",
      "--root-dir",
      "",
      "--build-command",
      "npm ci && npm run build -w cms",
      "--start-command",
      "npm start",
      "--dry-run",
    );

    expect(out).toEqual([
      "Changes to tunadao-cms (srv-cms):",
      '  root dir: "cms" -> ""',
      '  build command: "npm run build" -> "npm ci && npm run build -w cms"',
    ]);
    expect(client.updateService).not.toHaveBeenCalled();
  });

  it("PATCHes only the changed fields, with commands under envSpecificDetails", async () => {
    const { run, client, out } = harness({ services: [cms] });

    await run(
      "services",
      "update",
      "srv-cms",
      "--root-dir",
      "",
      "--build-command",
      "npm run build:cms",
      "--start-command",
      "npm run serve",
      "--auto-deploy",
      "no",
      "--yes",
    );

    expect(client.updateService).toHaveBeenCalledWith("srv-cms", {
      rootDir: "",
      autoDeployTrigger: "off",
      serviceDetails: {
        envSpecificDetails: { buildCommand: "npm run build:cms", startCommand: "npm run serve" },
      },
    });
    expect(out.at(-1)).toBe("Updated tunadao-cms (srv-cms)");
  });

  it("refuses when no setting flag is given", async () => {
    const { run, client } = harness({ services: [cms] });
    await expect(run("services", "update", "srv-cms", "--dry-run")).rejects.toThrow(
      /Nothing to update: pass --root-dir, --build-command, --start-command or --auto-deploy/,
    );
    expect(client.updateService).not.toHaveBeenCalled();
  });

  it("does nothing when the values already match", async () => {
    const { run, client, out } = harness({ services: [cms] });
    await run(
      "services",
      "update",
      "srv-cms",
      "--root-dir",
      "cms",
      "--auto-deploy",
      "yes",
      "--yes",
    );
    expect(out).toEqual(["tunadao-cms (srv-cms) already has these settings"]);
    expect(client.updateService).not.toHaveBeenCalled();
  });

  it("refuses to apply without --yes when there is no terminal", async () => {
    const { run, client } = harness({ services: [cms] });
    await expect(run("services", "update", "srv-cms", "--root-dir", "")).rejects.toThrow(
      /pass --yes/,
    );
    expect(client.updateService).not.toHaveBeenCalled();
  });

  it("asks on a terminal and stops on no", async () => {
    const { run, client, io } = harness({ services: [cms], stdinIsTTY: true, confirm: false });
    await run("services", "update", "srv-cms", "--root-dir", "");
    expect(io.confirm).toHaveBeenCalledOnce();
    expect(client.updateService).not.toHaveBeenCalled();
  });

  it("puts a static site's build command directly under serviceDetails", async () => {
    const site: Service = {
      id: "srv-site",
      name: "site",
      type: "static_site",
      serviceDetails: { buildCommand: "npm run build" },
    };
    const { run, client } = harness({ services: [site] });

    await run("services", "update", "srv-site", "--build-command", "npm run build:site", "--yes");

    expect(client.updateService).toHaveBeenCalledWith("srv-site", {
      serviceDetails: { buildCommand: "npm run build:site" },
    });
  });

  it("rejects build commands for a Docker service", async () => {
    const docker: Service = {
      id: "srv-docker",
      name: "api",
      type: "web_service",
      serviceDetails: { runtime: "docker" },
    };
    const { run } = harness({ services: [docker] });
    await expect(
      run("services", "update", "srv-docker", "--build-command", "make", "--dry-run"),
    ).rejects.toThrow("api runs a docker image; build and start commands do not apply");
  });

  it("rejects an auto-deploy value other than yes or no", async () => {
    const { run } = harness({ services: [cms] });
    await expect(
      run("services", "update", "srv-cms", "--auto-deploy", "maybe", "--dry-run"),
    ).rejects.toThrow("--auto-deploy must be yes or no");
  });
});
