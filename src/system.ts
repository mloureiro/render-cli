import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import type { Files, System } from "./context.js";

export const files: Files = {
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  async write(path, contents, mode) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, contents, { mode });
  },
};

function openCommand(url: string): [string, string[]] {
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", '""', url]];
  return ["xdg-open", [url]];
}

export const system: System = {
  homeDir: homedir(),
  now: () => Date.now(),
  openUrl(url) {
    const [command, args] = openCommand(url);
    return new Promise((resolve) => {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    });
  },
  isGitIgnored(path) {
    return new Promise((resolve) => {
      execFile("git", ["check-ignore", "-q", "--", path], (error) => {
        if (!error) return resolve(true);
        resolve(error.code === 1 ? false : undefined);
      });
    });
  },
};
