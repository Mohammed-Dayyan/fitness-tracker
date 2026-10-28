import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PromptCancelled, readHidden } from "../scripts/prompt";

/** A fake terminal: a stream with raw-mode tracking, and captured output. */
function terminal() {
  const stdin = Object.assign(new PassThrough(), { isTTY: true, raw: false });
  (stdin as unknown as { setRawMode: (m: boolean) => void }).setRawMode = (m) => {
    stdin.raw = m;
  };
  const stdout = new PassThrough();
  let out = "";
  stdout.on("data", (c) => (out += c));
  return { stdin, stdout, output: () => out, io: { stdin: stdin as never, stdout } };
}

const released = (t: ReturnType<typeof terminal>) => {
  expect(t.stdin.raw, "raw mode restored").toBe(false);
  expect(t.stdin.isPaused(), "stdin released").toBe(true);
  expect(t.stdin.listenerCount("data"), "no data listener left").toBe(0);
  expect(t.stdin.listenerCount("end"), "no end listener left").toBe(0);
};

describe("audit #23: hidden password prompt", () => {
  it("Ctrl+C cancels, restores the terminal and releases stdin (previously left the process hanging)", async () => {
    const t = terminal();
    const p = readHidden("New password: ", t.io);
    expect(t.stdin.raw).toBe(true);
    t.stdin.write("hunter2sec");
    t.stdin.write("\u0003");
    await expect(p).rejects.toBeInstanceOf(PromptCancelled);
    released(t);
    expect(t.output()).not.toContain("hunter2");
    expect(t.output()).toBe("New password: \n");
  });

  it("Enter returns what was typed; nothing typed is ever echoed", async () => {
    const t = terminal();
    const p = readHidden("pw: ", t.io);
    t.stdin.write("abc");
    t.stdin.write("d\u007f\u007fx\r");
    expect(await p).toBe("abx"); // abcd, two backspaces, x
    released(t);
    expect(t.output()).toBe("pw: \n");
  });

  it("characters after Enter in the same chunk (a pasted newline) are ignored", async () => {
    const t = terminal();
    const p = readHidden("pw: ", t.io);
    t.stdin.write("secret\nignored");
    expect(await p).toBe("secret");
    released(t);
  });

  it("Ctrl+D cancels when nothing is typed and submits when something is", async () => {
    const empty = terminal();
    const a = readHidden("pw: ", empty.io);
    empty.stdin.write("\u0004");
    await expect(a).rejects.toBeInstanceOf(PromptCancelled);
    released(empty);

    const some = terminal();
    const b = readHidden("pw: ", some.io);
    some.stdin.write("abc\u0004");
    expect(await b).toBe("abc");
    released(some);
  });

  it("input ending (closed pipe) cancels cleanly instead of waiting forever", async () => {
    const t = terminal();
    const p = readHidden("pw: ", t.io);
    t.stdin.end();
    await expect(p).rejects.toBeInstanceOf(PromptCancelled);
    released(t);
  });

  it("arrow-key escape sequences don't become part of the password", async () => {
    const t = terminal();
    const p = readHidden("pw: ", t.io);
    t.stdin.write("ab\u001b[A\u001b[Dc\r");
    expect(await p).toBe("abc");
  });
});
