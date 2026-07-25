/**
 * Lightweight shell parsing helpers for exec display summaries.
 *
 * Handles common quoting, wrapper, and preamble shapes for UI labels without validating shell syntax.
 */
import { normalizeLowercaseStringOrEmpty } from "@openclaw/normalization-core/string-coerce";

type PreambleResult = {
  command: string;
  chdirPath?: string;
};

/** Removes matching outer single or double quotes from a display token. */
export function stripOuterQuotes(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** Splits a command string into shell-ish words while respecting simple quotes and escapes. */
export function splitShellWords(input: string | undefined, maxWords = 48): string[] {
  if (!input) {
    return [];
  }

  const words: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (!current) {
        continue;
      }
      words.push(current);
      if (words.length >= maxWords) {
        return words;
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current) {
    words.push(current);
  }
  return words;
}

/** Returns a normalized basename for a command token. */
export function binaryName(token: string | undefined): string | undefined {
  if (!token) {
    return undefined;
  }
  const cleaned = stripOuterQuotes(token) ?? token;
  const segment = cleaned.split(/[/]/).at(-1) ?? cleaned;
  return normalizeLowercaseStringOrEmpty(segment);
}

/** Reads the value for any matching short or long option name. */
export function optionValue(words: string[], names: string[]): string | undefined {
  const lookup = new Set(names);

  for (let i = 0; i < words.length; i += 1) {
    const token = words[i];
    if (!token) {
      continue;
    }

    if (lookup.has(token)) {
      const value = words[i + 1];
      if (value && !value.startsWith("-")) {
        return value;
      }
      continue;
    }

    for (const name of names) {
      if (name.startsWith("--") && token.startsWith(`${name}=`)) {
        return token.slice(name.length + 1);
      }
    }
  }

  return undefined;
}

/** Returns positional args after skipping options and configured option values. */
export function positionalArgs(
  words: string[],
  from = 1,
  optionsWithValue: string[] = [],
): string[] {
  const args: string[] = [];
  const takesValue = new Set(optionsWithValue);

  for (let i = from; i < words.length; i += 1) {
    const token = words[i];
    if (!token) {
      continue;
    }

    if (token === "--") {
      for (let j = i + 1; j < words.length; j += 1) {
        const candidate = words[j];
        if (candidate) {
          args.push(candidate);
        }
      }
      break;
    }

    if (token.startsWith("--")) {
      if (token.includes("=")) {
        continue;
      }
      if (takesValue.has(token)) {
        i += 1;
      }
      continue;
    }

    if (token.startsWith("-")) {
      if (takesValue.has(token)) {
        i += 1;
      }
      continue;
    }

    args.push(token);
  }

  return args;
}

/** Returns the first positional arg after skipping options and configured option values. */
export function firstPositional(
  words: string[],
  from = 1,
  optionsWithValue: string[] = [],
): string | undefined {
  return positionalArgs(words, from, optionsWithValue)[0];
}

/** Removes leading `env` wrappers and VAR=value assignments from parsed words. */
export function trimLeadingEnv(words: string[]): string[] {
  if (words.length === 0) {
    return words;
  }

  let index = 0;
  if (binaryName(words[0]) === "env") {
    index = 1;
    while (index < words.length) {
      const token = words[index];
      if (!token) {
        break;
      }
      if (token.startsWith("-")) {
        index += 1;
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        index += 1;
        continue;
      }
      break;
    }
    return words.slice(index);
  }

  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
    index += 1;
  }
  return words.slice(index);
}

/** Unwraps common `sh -c`/`bash -lc` command wrappers for display parsing. */
export function unwrapShellWrapper(command: string): string {
  const words = splitShellWords(command, 10);
  if (words.length < 3) {
    return command;
  }

  const bin = binaryName(words[0]);
  if (!(bin === "bash" || bin === "sh" || bin === "zsh" || bin === "fish")) {
    return command;
  }

  const flagIndex = words.findIndex(
    (token, index) => index > 0 && (token === "-c" || token === "-lc" || token === "-ic"),
  );
  if (flagIndex === -1) {
    return command;
  }

  const inner = words
    .slice(flagIndex + 1)
    .join(" ")
    .trim();
  return inner ? (stripOuterQuotes(inner) ?? command) : command;
}

function scanTopLevelChars(
  command: string,
  visit: (char: string, index: number) => boolean | void,
): void {
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (visit(char, i) === false) {
      return;
    }
  }
}

/** Splits a command on top-level stage separators such as `;`, `&&`, and `||`. */
export function splitTopLevelStages(command: string): string[] {
  const parts: string[] = [];
  let start = 0;

  scanTopLevelChars(command, (char, index) => {
    if (char === ";") {
      parts.push(command.slice(start, index));
      start = index + 1;
      return true;
    }
    if ((char === "&" || char === "|") && command[index + 1] === char) {
      parts.push(command.slice(start, index));
      start = index + 2;
      return true;
    }
    return true;
  });

  parts.push(command.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** Splits a command on top-level single pipes without splitting `||`. */
export function splitTopLevelPipes(command: string): string[] {
  const parts: string[] = [];
  let start = 0;

  scanTopLevelChars(command, (char, index) => {
    if (char === "|" && command[index - 1] !== "|" && command[index + 1] !== "|") {
      parts.push(command.slice(start, index));
      start = index + 1;
    }
    return true;
  });

  parts.push(command.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseChdirTarget(head: string): string | undefined {
  const words = splitShellWords(head, 3);
  const bin = binaryName(words[0]);
  if (bin === "cd" || bin === "pushd") {
    return words[1] || undefined;
  }
  return undefined;
}

function isChdirCommand(head: string): boolean {
  const bin = binaryName(splitShellWords(head, 2)[0]);
  return bin === "cd" || bin === "pushd" || bin === "popd";
}

function isPopdCommand(head: string): boolean {
  return binaryName(splitShellWords(head, 2)[0]) === "popd";
}

/** Removes leading setup commands such as exports and cwd changes from display summaries. */
export function stripShellPreamble(command: string): PreambleResult {
  let rest = command.trim();
  let chdirPath: string | undefined;

  for (let i = 0; i < 4; i += 1) {
    let first: { index: number; length: number; isOr?: boolean } | undefined;
    // Only scan top-level separators so quoted strings and nested shell fragments stay intact in
    // the command fragment that display code will summarize.
    scanTopLevelChars(rest, (char, idx) => {
      if (char === "&" && rest[idx + 1] === "&") {
        first = { index: idx, length: 2 };
        return false;
      }
      if (char === "|" && rest[idx + 1] === "|") {
        first = { index: idx, length: 2, isOr: true };
        return false;
      }
      if (char === ";" || char === "\n") {
        first = { index: idx, length: 1 };
        return false;
      }
      return undefined;
    });
    const head = (first ? rest.slice(0, first.index) : rest).trim();
    const isChdir = (first ? !first.isOr : i > 0) && isChdirCommand(head);
    const isPreamble =
      head.startsWith("set ") || head.startsWith("export ") || head.startsWith("unset ") || isChdir;

    if (!isPreamble) {
      break;
    }

    if (isChdir) {
      if (isPopdCommand(head)) {
        chdirPath = undefined;
      } else {
        chdirPath = parseChdirTarget(head) ?? chdirPath;
      }
    }

    rest = first ? rest.slice(first.index + first.length).trimStart() : "";
    if (!rest) {
      break;
    }
  }

  return { command: rest.trim(), chdirPath };
}

// Display-only classification of "benign housekeeping" shell binaries: read-only
// inspection (find/ls/cat/…) plus scratch scaffolding (mkdir/touch/printf/echo).
// This is NOT a security boundary — it drives whether a step is worth surfacing
// to a user (progress bullets, recovered-error notes). A benign `find /` that
// exits non-zero on permission-denied is bookkeeping, not the task failing
// (ENG-16318). Keep this separate from `tool-mutation.ts`'s security-sensitive
// READ_ONLY_SHELL_COMMANDS, which must not include mutating scaffolding.
const BENIGN_HOUSEKEEPING_SHELL_BINARIES = new Set([
  "find",
  "ls",
  "cat",
  "head",
  "tail",
  "grep",
  "pwd",
  "stat",
  "wc",
  "mkdir",
  "printf",
  "echo",
  "touch",
]);

// `find` is only benign when it is pure traversal. These predicates run commands
// or delete files (`find . -delete`, `find . -exec rm …`), so a `find` carrying
// any of them is real work, not bookkeeping — surface it and its failure. Fail
// closed: an unrecognized side-effecting form must not be classified benign.
const FIND_SIDE_EFFECT_ACTIONS = new Set([
  "-delete",
  "-exec",
  "-execdir",
  "-ok",
  "-okdir",
  "-fprint",
  "-fprintf",
  "-fls",
]);

function isSideEffectingFind(words: string[]): boolean {
  return words.some((word) => FIND_SIDE_EFFECT_ACTIONS.has(word.toLowerCase()));
}

/** True when every pipe segment of a stage is a benign housekeeping command. */
function isBenignHousekeepingStage(stage: string): boolean {
  const segments = splitTopLevelPipes(stage);
  return segments.every((segment) => {
    const words = trimLeadingEnv(splitShellWords(segment));
    const bin = binaryName(words[0]);
    if (bin === undefined || !BENIGN_HOUSEKEEPING_SHELL_BINARIES.has(bin)) {
      return false;
    }
    // Guard the one benign binary with destructive forms (ENG-16318 cubic P1).
    if (bin === "find" && isSideEffectingFind(words)) {
      return false;
    }
    return true;
  });
}

/**
 * True when EVERY top-level stage of a shell command is benign housekeeping.
 *
 * Two consumers key off this (ENG-16318):
 *  - dropping scratch-setup + inspection chains (e.g.
 *    `mkdir … && ls … && find / -name "<uuid>*"`) from user-facing progress cards;
 *  - suppressing the recovered-error note when such a chain exits non-zero on a
 *    turn that still produced a real answer (a benign `find /` hitting
 *    permission-denied is bookkeeping, not the task failing).
 *
 * Deliberately "every stage", not "the failing stage": the exec result carries a
 * single exit code, not per-stage info, so which stage failed cannot be known.
 * If ALL stages are benign then whichever one failed was benign, with no
 * guessing — and a chain that also runs real work (e.g. `python foo.py`) still
 * surfaces its failure. Display heuristic only, not a security boundary.
 */
export function isBenignHousekeepingShellCommand(command: string | undefined): boolean {
  if (!command) {
    return false;
  }
  const inner = unwrapShellWrapper(command.trim());
  const { command: cleaned } = stripShellPreamble(inner);
  const stages = splitTopLevelStages(cleaned || inner);
  if (stages.length === 0) {
    return false;
  }
  return stages.every((stage) => isBenignHousekeepingStage(stage));
}
