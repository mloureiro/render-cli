import type { ClientOptions, RenderClient } from "./client.js";
import type { Io } from "./io.js";

export interface Files {
  read(path: string): Promise<string | undefined>;
  write(path: string, contents: string, mode: number): Promise<void>;
}

export interface System {
  homeDir: string;
  now(): number;
  openUrl(url: string): Promise<boolean>;
  isGitIgnored(path: string): Promise<boolean | undefined>;
}

export interface ProgramDeps {
  io: Io;
  env: Record<string, string | undefined>;
  files: Files;
  system: System;
  createClient(options: ClientOptions): RenderClient;
}

export class UsageError extends Error {}
