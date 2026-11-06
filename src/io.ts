import { createInterface } from "node:readline";

export interface Io {
  out(line: string): void;
  err(line: string): void;
  stdinIsTTY: boolean;
  readStdin(): Promise<string>;
  promptHidden(question: string): Promise<string>;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  ask(question: string): Promise<string>;
}

export async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function promptHidden(question: string): Promise<string> {
  const { stdin, stderr } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = (error?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stderr.write("\n");
      if (error) reject(error);
      else resolve(value);
    };

    const onData = (input: string) => {
      for (const char of input) {
        if (char === "\r" || char === "\n" || char === "\u0004") return finish();
        if (char === "\u0003") return finish(new Error("Aborted"));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}

export function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const answer = (await ask(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim();
  return answer === "" ? defaultYes : /^y(es)?$/i.test(answer);
}
