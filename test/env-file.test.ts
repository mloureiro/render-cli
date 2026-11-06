import { describe, expect, it } from "vitest";
import { diffEnv, parseEnvFile } from "../src/env-file.js";

describe("diffEnv", () => {
  it("splits keys into added, changed, unchanged and removed", () => {
    const remote = [
      { key: "SAME", value: "1" },
      { key: "CHANGED", value: "old" },
      { key: "ONLY_REMOTE", value: "x" },
    ];
    const local = parseEnvFile('SAME=1\nCHANGED=new\nexport NEW="with space"\n');

    expect(diffEnv(remote, local)).toEqual({
      added: ["NEW"],
      changed: ["CHANGED"],
      unchanged: ["SAME"],
      removed: ["ONLY_REMOTE"],
    });
  });

  it("treats an empty local value as a change from a non-empty remote one", () => {
    expect(diffEnv([{ key: "A", value: "1" }], { A: "" }).changed).toEqual(["A"]);
  });
});
