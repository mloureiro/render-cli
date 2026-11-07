import { describe, expect, it } from "vitest";
import type { Service } from "../src/client.js";
import { harness } from "./harness.js";

const cms: Service = {
  id: "srv-cms",
  name: "tunadao-cms",
  type: "web_service",
  suspended: "not_suspended",
  repo: "https://github.com/me/site",
  branch: "main",
  rootDir: "cms",
  autoDeploy: "yes",
  serviceDetails: {
    runtime: "node",
    url: "https://tunadao-cms.onrender.com",
    envSpecificDetails: { buildCommand: "npm ci && npm run build", startCommand: "npm start" },
  },
};
const site: Service = {
  id: "srv-site",
  name: "a-site",
  type: "static_site",
  suspended: "suspended",
};

describe("services list", () => {
  it("lists services by name", async () => {
    const { run, out } = harness({ services: [cms, site] });

    await run("services", "list");

    expect(out).toEqual([
      "NAME         ID        TYPE         SUSPENDED      URL",
      "a-site       srv-site  static_site  suspended",
      "tunadao-cms  srv-cms   web_service  not_suspended  https://tunadao-cms.onrender.com",
    ]);
  });
});

describe("services get", () => {
  it("shows the settings that drive a build, by name", async () => {
    const { run, out } = harness({ services: [cms] });

    await run("services", "get", "tunadao-cms");

    expect(out).toEqual([
      "name:           tunadao-cms",
      "id:             srv-cms",
      "type:           web_service",
      "runtime:        node",
      "suspended:      not_suspended",
      "repo:           https://github.com/me/site",
      "branch:         main",
      "root dir:       cms",
      "auto-deploy:    yes",
      "build command:  npm ci && npm run build",
      "start command:  npm start",
      "url:            https://tunadao-cms.onrender.com",
    ]);
  });

  it("looks a service up by ID", async () => {
    const { run, client } = harness({ services: [cms] });
    await run("services", "get", "srv-cms", "--json");
    expect(client.getService).toHaveBeenCalledWith("srv-cms");
  });

  it("fails for an unknown ID", async () => {
    const { run } = harness();
    await expect(run("services", "get", "srv-nope")).rejects.toThrow("No service with ID srv-nope");
  });
});
