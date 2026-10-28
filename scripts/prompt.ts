/** Hidden-input prompt for secrets typed in a terminal. */

export class PromptCancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "PromptCancelled";
  }
}

export type PromptIO = {
  stdin: NodeJS.ReadableStream & { setRawMode?: (mode: boolean) => unknown };
  stdout: NodeJS.WritableStream;
};

/**
 * Reads one line without echoing it. Resolves on Enter; rejects with
 * PromptCancelled on Ctrl+C, on Ctrl+D with nothing typed, or if input ends.
 * Every exit path puts the terminal back in normal mode and releases stdin
 * (listeners removed, stream paused), so the process can exit instead of
 * hanging on an open input stream.
 */
export function readHidden(prompt: string, io: PromptIO = { stdin: process.stdin, stdout: process.stdout }): Promise<string> {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = io;
    let value = "";

    const finish = (settle: () => void) => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.setRawMode?.(false);
      stdin.pause();
      stdout.write("\n");
      settle();
    };
    const onEnd = () => finish(() => reject(new PromptCancelled()));
    const onData = (chunk: string | Buffer) => {
      // Drop terminal escape sequences (arrow keys etc.) so they don't end up in the password.
      const text = String(chunk).replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
      for (const ch of text) {
        if (ch === "\r" || ch === "\n") return finish(() => resolve(value));
        if (ch === "\u0003") return finish(() => reject(new PromptCancelled())); // Ctrl+C
        if (ch === "\u0004") return finish(() => (value ? resolve(value) : reject(new PromptCancelled()))); // Ctrl+D
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };

    stdout.write(prompt);
    stdin.setRawMode?.(true);
    stdin.resume();
    (stdin as NodeJS.ReadStream).setEncoding?.("utf8");
    stdin.on("data", onData);
    stdin.on("end", onEnd);
  });
}
