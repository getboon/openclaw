import { describe, expect, it } from "vitest";
import { isBenignHousekeepingShellCommand } from "./tool-display-exec-shell.js";

describe("isBenignHousekeepingShellCommand", () => {
  it("returns true when every stage is benign housekeeping", () => {
    expect(
      isBenignHousekeepingShellCommand(
        'mkdir -p ~/.openclaw/workspace/scratch && ls ~/.openclaw/ && find / -name "abc*"',
      ),
    ).toBe(true);
  });

  it("returns true for a standalone read-only find", () => {
    expect(isBenignHousekeepingShellCommand('find / -name "abc*"')).toBe(true);
  });

  it("returns true for inspection commands (cat/head/grep)", () => {
    expect(isBenignHousekeepingShellCommand("cat notes.txt")).toBe(true);
    expect(isBenignHousekeepingShellCommand("head -n 5 file.log && wc -l file.log")).toBe(true);
    expect(isBenignHousekeepingShellCommand("grep foo bar.txt")).toBe(true);
  });

  it("returns false when any stage runs real work", () => {
    expect(isBenignHousekeepingShellCommand("mkdir -p build && python build.py")).toBe(false);
    expect(isBenignHousekeepingShellCommand("ls && rm -rf dist")).toBe(false);
    expect(isBenignHousekeepingShellCommand("npm run build")).toBe(false);
  });

  it("returns false for side-effecting find forms (ENG-16318 cubic P1)", () => {
    // `find` is benign only as pure traversal; -delete/-exec/-ok run real work.
    expect(isBenignHousekeepingShellCommand("find . -delete")).toBe(false);
    expect(isBenignHousekeepingShellCommand("find . -name '*.tmp' -exec rm {} +")).toBe(false);
    expect(isBenignHousekeepingShellCommand("find . -type f -execdir chmod 600 {} ;")).toBe(false);
    expect(isBenignHousekeepingShellCommand("mkdir scratch && find . -delete")).toBe(false);
    expect(isBenignHousekeepingShellCommand("find . -ok rm {} ;")).toBe(false);
    expect(isBenignHousekeepingShellCommand("find / -fprint /tmp/out")).toBe(false);
  });

  it("returns false when real work fails and a benign command follows it (|| fallback)", () => {
    // The whole-command rule (not last-stage) is what makes this safe: a failed
    // `python` followed by a benign `find` must NOT read as benign, since the
    // real work is what failed.
    expect(isBenignHousekeepingShellCommand("python build.py || find /")).toBe(false);
  });

  it("fails closed on shell control the stage splitter cannot model (ENG-16318 gandalfboon)", () => {
    // splitTopLevelStages only breaks on ;/&&/||, and splitShellWords treats a
    // newline as whitespace — so these once collapsed to one stage whose benign
    // first word ("looked like" mkdir/ls/printf/echo) hid real work, dropping the
    // progress bullet and silencing a genuine failure. All must be non-benign.
    expect(isBenignHousekeepingShellCommand("mkdir -p build\nnpm run build")).toBe(false);
    expect(isBenignHousekeepingShellCommand("ls\nrm -rf dist")).toBe(false);
    expect(isBenignHousekeepingShellCommand("ls & rm -rf dist")).toBe(false);
    expect(isBenignHousekeepingShellCommand("printf 'x' > ~/.zshrc")).toBe(false);
    expect(isBenignHousekeepingShellCommand("cat > config.json <<'EOF'\nx\nEOF")).toBe(false);
    expect(isBenignHousekeepingShellCommand("echo $(rm -rf dist)")).toBe(false);
  });

  it("does not fail open on a find with a long predicate list ending in -delete (ENG-16318 gandalfboon)", () => {
    // splitShellWords used to cap at 48 words, so -delete past that cap was never
    // seen and the side-effect guard failed open. The predicate scan must be uncapped.
    const longPredicates = Array.from({ length: 30 }, (_, i) => `-name '*.x${i}' -o`).join(" ");
    expect(isBenignHousekeepingShellCommand(`find . ${longPredicates} -delete`)).toBe(false);
  });

  it("returns false for a piped stage that includes a non-benign command", () => {
    expect(isBenignHousekeepingShellCommand("cat urls.txt | xargs curl")).toBe(false);
  });

  it("returns true for a benign piped stage", () => {
    expect(isBenignHousekeepingShellCommand("cat file.txt | grep foo | wc -l")).toBe(true);
  });

  it("unwraps sh -c wrappers", () => {
    expect(isBenignHousekeepingShellCommand('bash -lc "mkdir tmp && ls tmp"')).toBe(true);
  });

  it("returns false for empty input", () => {
    expect(isBenignHousekeepingShellCommand(undefined)).toBe(false);
    expect(isBenignHousekeepingShellCommand("")).toBe(false);
  });
});
