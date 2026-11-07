export function table(header: string[], rows: string[][]): string[] {
  const all = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(...all.map((row) => (row[column] ?? "").length)),
  );
  return all.map((row) =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column] ?? 0)))
      .join("  ")
      .trimEnd(),
  );
}

export function details(entries: Array<[string, string | undefined]>): string[] {
  const shown = entries.filter((entry): entry is [string, string] => Boolean(entry[1]));
  const width = Math.max(0, ...shown.map(([label]) => label.length));
  return shown.map(([label, value]) => `${`${label}:`.padEnd(width + 1)}  ${value}`);
}

export function time(iso: string | undefined): string {
  return iso ? iso.replace(/\.\d+(?=Z|[+-]\d\d:\d\d$)/, "") : "";
}

export function firstLine(text: string | undefined, max = 60): string {
  const line = (text ?? "").split("\n")[0]?.trim() ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function duration(fromIso: string | undefined, toIso: string | undefined): string {
  if (!fromIso || !toIso) return "";
  const seconds = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
