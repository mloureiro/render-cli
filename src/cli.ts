import { readFile } from "node:fs/promises";
import { CommanderError } from "commander";
import { createClient } from "./client.js";
import { confirm, promptHidden, readAll } from "./io.js";
import { buildProgram } from "./program.js";

const program = buildProgram({
  env: process.env,
  createClient,
  io: {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readStdin: () => readAll(process.stdin),
    promptHidden,
    confirm,
    readFile: (path) => readFile(path, "utf8"),
  },
});

program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
  } else {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
