import { describe, expect, it } from "vitest";
import type { LogEntry, Service } from "../src/client.js";
import { harness } from "./harness.js";

const service: Service = { id: "srv-abc", name: "cms", type: "web_service", ownerId: "tea-1" };

const entry = (timestamp: string, message: string, type?: string): LogEntry => ({
  id: timestamp,
  timestamp,
  message,
  labels: type ? [{ name: "type", value: type }] : [],
});

describe("logs", () => {
  it("prints the most recent lines oldest first when no window is given", async () => {
    const { run, out, client } = harness({
      services: [service],
      logPages: [
        {
          logs: [
            entry("2026-11-07T10:00:02Z", "second\n", "app"),
            entry("2026-11-07T10:00:01Z", "first", "app"),
          ],
          hasMore: false,
        },
      ],
    });

    await run("logs", "--type", "app", "--limit", "2");

    expect(client.listLogs).toHaveBeenCalledWith({
      ownerId: "tea-1",
      resource: "srv-abc",
      type: "app",
      startTime: undefined,
      endTime: undefined,
      direction: "backward",
      limit: 2,
    });
    expect(out).toEqual(["2026-11-07T10:00:01Z [app] first", "2026-11-07T10:00:02Z [app] second"]);
  });

  it("reads forward through the deploy's window, following the page cursors", async () => {
    const { run, out, client } = harness({
      services: [service],
      deploys: [
        {
          id: "dep-1",
          status: "build_failed",
          startedAt: "2026-11-07T09:00:00Z",
          finishedAt: "2026-11-07T09:05:00Z",
        },
      ],
      logPages: [
        {
          logs: [entry("2026-11-07T09:00:01Z", "npm ci", "build")],
          hasMore: true,
          nextStartTime: "2026-11-07T09:00:02Z",
          nextEndTime: "2026-11-07T09:06:00Z",
        },
        { logs: [entry("2026-11-07T09:04:59Z", "Build failed", "build")], hasMore: false },
      ],
    });

    await run("logs", "--deploy", "dep-1");

    expect(client.listLogs.mock.calls.map(([query]) => [query.startTime, query.endTime])).toEqual([
      ["2026-11-07T09:00:00Z", "2026-11-07T09:06:00.000Z"],
      ["2026-11-07T09:00:02Z", "2026-11-07T09:06:00Z"],
    ]);
    expect(client.listLogs.mock.calls[0]?.[0].direction).toBe("forward");
    expect(out).toEqual([
      "2026-11-07T09:00:01Z [build] npm ci",
      "2026-11-07T09:04:59Z [build] Build failed",
    ]);
  });

  it("stops paging once the limit is reached", async () => {
    const page = {
      logs: [entry("2026-11-07T09:00:01Z", "a"), entry("2026-11-07T09:00:02Z", "b")],
      hasMore: true,
      nextStartTime: "x",
      nextEndTime: "y",
    };
    const { run, client, out } = harness({ services: [service], logPages: [page, page] });

    await run("logs", "--since", "2026-11-07T09:00:00Z", "--limit", "2");

    expect(client.listLogs).toHaveBeenCalledOnce();
    expect(out).toHaveLength(2);
  });

  it("rejects an unparseable --since", async () => {
    const { run } = harness({ services: [service] });
    await expect(run("logs", "--since", "yesterday-ish")).rejects.toThrow(/--since must be a date/);
  });
});
