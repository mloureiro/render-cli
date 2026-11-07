import { describe, expect, it } from "vitest";
import type { Deploy } from "../src/client.js";
import { harness } from "./harness.js";

const failed: Deploy = {
  id: "dep-failed",
  status: "build_failed",
  trigger: "new_commit",
  commit: { id: "abcdef1234567890", message: "Add contact form\n\nLonger body" },
  createdAt: "2026-11-06T22:00:00.123456Z",
  startedAt: "2026-11-06T22:00:05Z",
  finishedAt: "2026-11-06T22:02:10Z",
};
const live: Deploy = {
  id: "dep-live",
  status: "live",
  trigger: "manual",
  commit: { id: "1111111aaaa", message: "Fix build" },
  createdAt: "2026-11-06T21:00:00Z",
  finishedAt: "2026-11-06T21:03:00Z",
};

describe("deploys list", () => {
  it("prints a table with status, trigger, times and the commit summary", async () => {
    const { run, out, client } = harness({ deploys: [failed, live] });

    await run("deploys", "list", "--limit", "5");

    expect(client.listDeploys).toHaveBeenCalledWith("srv-abc", 5);
    expect(out).toEqual([
      "ID          STATUS        TRIGGER     CREATED               FINISHED              COMMIT",
      "dep-failed  build_failed  new_commit  2026-11-06T22:00:00Z  2026-11-06T22:02:10Z  abcdef1 Add contact form",
      "dep-live    live          manual      2026-11-06T21:00:00Z  2026-11-06T21:03:00Z  1111111 Fix build",
    ]);
  });

  it("rejects a limit above what the API serves", async () => {
    const { run } = harness();
    await expect(run("deploys", "list", "--limit", "500")).rejects.toThrow(/1 to 100/);
  });
});

describe("deploys get", () => {
  it("shows the deploy with its duration", async () => {
    const { run, out } = harness({ deploys: [failed] });

    await run("deploys", "-s", "srv-abc", "get", "dep-failed");

    expect(out).toEqual([
      "id:        dep-failed",
      "status:    build_failed",
      "trigger:   new_commit",
      "commit:    abcdef1234567890",
      "message:   Add contact form",
      "created:   2026-11-06T22:00:00Z",
      "started:   2026-11-06T22:00:05Z",
      "finished:  2026-11-06T22:02:10Z",
      "duration:  2m 5s",
    ]);
  });

  it("fails for an unknown deploy", async () => {
    const { run } = harness();
    await expect(run("deploys", "get", "dep-nope")).rejects.toThrow(
      "No deploy dep-nope on srv-abc",
    );
  });
});

describe("deploys wait", () => {
  function sequence(...statuses: string[]) {
    let call = 0;
    return async (_serviceId: string, deployId: string): Promise<Deploy> => ({
      id: deployId,
      status: statuses[Math.min(call++, statuses.length - 1)],
    });
  }

  it("polls until live and prints each status change once", async () => {
    const { run, out, system } = harness({
      getDeploy: sequence("build_in_progress", "build_in_progress", "update_in_progress", "live"),
    });

    await run("deploys", "wait", "dep-1", "--interval", "2");

    expect(out.map((line) => line.split("  ")[1] ?? line)).toEqual([
      "build_in_progress",
      "update_in_progress",
      "live",
      "Deploy dep-1 is live",
    ]);
    expect(system.sleep).toHaveBeenCalledTimes(3);
    expect(system.sleep).toHaveBeenCalledWith(2000);
  });

  it("fails with a pointer to the logs when the build fails", async () => {
    const { run } = harness({ getDeploy: sequence("build_in_progress", "build_failed") });
    await expect(run("deploys", "wait", "dep-1")).rejects.toThrow(
      "Deploy dep-1 ended with status build_failed; see its logs with: render-cli logs -s srv-abc --deploy dep-1",
    );
  });

  it("gives up after the timeout", async () => {
    let now = 0;
    const { run, system } = harness({ getDeploy: sequence("queued") });
    system.now = () => now;
    system.sleep.mockImplementation(async (ms: number) => {
      now += ms;
    });

    await expect(
      run("deploys", "wait", "dep-1", "--interval", "5", "--timeout", "12"),
    ).rejects.toThrow("Gave up after 12s; deploy dep-1 is still queued");
  });
});
