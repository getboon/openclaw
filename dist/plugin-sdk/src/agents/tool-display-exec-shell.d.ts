type PreambleResult = {
    command: string;
    chdirPath?: string;
};
/** Removes matching outer single or double quotes from a display token. */
export declare function stripOuterQuotes(value: string | undefined): string | undefined;
/** Splits a command string into shell-ish words while respecting simple quotes and escapes. */
export declare function splitShellWords(input: string | undefined, maxWords?: number): string[];
/** Returns a normalized basename for a command token. */
export declare function binaryName(token: string | undefined): string | undefined;
/** Reads the value for any matching short or long option name. */
export declare function optionValue(words: string[], names: string[]): string | undefined;
/** Returns positional args after skipping options and configured option values. */
export declare function positionalArgs(words: string[], from?: number, optionsWithValue?: string[]): string[];
/** Returns the first positional arg after skipping options and configured option values. */
export declare function firstPositional(words: string[], from?: number, optionsWithValue?: string[]): string | undefined;
/** Removes leading `env` wrappers and VAR=value assignments from parsed words. */
export declare function trimLeadingEnv(words: string[]): string[];
/** Unwraps common `sh -c`/`bash -lc` command wrappers for display parsing. */
export declare function unwrapShellWrapper(command: string): string;
/** Splits a command on top-level stage separators such as `;`, `&&`, and `||`. */
export declare function splitTopLevelStages(command: string): string[];
/** Splits a command on top-level single pipes without splitting `||`. */
export declare function splitTopLevelPipes(command: string): string[];
/** Removes leading setup commands such as exports and cwd changes from display summaries. */
export declare function stripShellPreamble(command: string): PreambleResult;
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
export declare function isBenignHousekeepingShellCommand(command: string | undefined): boolean;
export {};
