import { parseEnv } from "node:util";
import type { EnvVar } from "./client.js";

export interface EnvDiff {
  added: string[];
  changed: string[];
  unchanged: string[];
  removed: string[];
}

export function parseEnvFile(contents: string): Record<string, string> {
  return { ...parseEnv(contents) } as Record<string, string>;
}

export function diffEnv(remote: EnvVar[], local: Record<string, string>): EnvDiff {
  const remoteValues = new Map(remote.map((envVar) => [envVar.key, envVar.value]));
  const diff: EnvDiff = { added: [], changed: [], unchanged: [], removed: [] };

  for (const [key, value] of Object.entries(local)) {
    if (!remoteValues.has(key)) diff.added.push(key);
    else if (remoteValues.get(key) === value) diff.unchanged.push(key);
    else diff.changed.push(key);
  }
  for (const key of remoteValues.keys()) {
    if (!(key in local)) diff.removed.push(key);
  }

  for (const list of Object.values(diff)) list.sort();
  return diff;
}
