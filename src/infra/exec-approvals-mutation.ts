// Serializes internal exec-approvals mutations without expanding the public SDK surface.
import fs from "node:fs";
import path from "node:path";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./exec-approvals.js";
import { withFileLock } from "./file-lock.js";
import { assertNoSymlinkParentsSync } from "./fs-safe-advanced.js";
import { expandHomePrefix, resolveRequiredHomeDir } from "./home-dir.js";

export type ExecApprovalsMutation<T> =
  | { kind: "unchanged"; result: T }
  | { kind: "save"; file: ExecApprovalsFile; result: T }
  | { kind: "restore"; snapshot: ExecApprovalsSnapshot; result: T };

export type ExecApprovalsMutationStore = {
  resolvePath: () => string;
  readSnapshot: () => ExecApprovalsSnapshot;
  save: (file: ExecApprovalsFile) => void;
  restore: (snapshot: ExecApprovalsSnapshot) => void;
};

const EXEC_APPROVALS_LOCK_TIMEOUT_RETRIES = 100;
const EXEC_APPROVALS_LOCK_POLL_INTERVAL_MS = 50;
const EXEC_APPROVALS_LOCK_STALE_MS = 30_000;
const DEFAULT_EXEC_APPROVALS_STATE_DIR = "~/.openclaw";
const EXEC_APPROVALS_FILE = "exec-approvals.json";

export const EXEC_APPROVALS_LOCK_CONTENTION_ERROR_CODE = "exec_approvals_lock_contended";

export class ExecApprovalsLockContentionError extends Error {
  code = EXEC_APPROVALS_LOCK_CONTENTION_ERROR_CODE;

  constructor() {
    super("Exec approvals update is already in progress; retry this operation.");
    this.name = "ExecApprovalsLockContentionError";
  }
}

function hasUnmigratedLegacyExecApprovals(filePath: string): boolean {
  if (!process.env.OPENCLAW_STATE_DIR?.trim()) {
    return false;
  }
  const legacyPath = path.join(
    expandHomePrefix(DEFAULT_EXEC_APPROVALS_STATE_DIR),
    EXEC_APPROVALS_FILE,
  );
  return (
    path.resolve(legacyPath) !== path.resolve(filePath) &&
    !fs.existsSync(filePath) &&
    fs.existsSync(legacyPath)
  );
}

function assertSafeExecApprovalsLockDestination(filePath: string): void {
  const dir = path.dirname(filePath);
  assertNoSymlinkParentsSync({
    rootDir: resolveRequiredHomeDir(),
    targetPath: dir,
    allowOutsideRoot: true,
    messagePrefix: "Refusing to traverse symlink in exec approvals path",
  });
  fs.mkdirSync(dir, { recursive: true });
  const dirStat = fs.lstatSync(dir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new Error(`Refusing to use unsafe exec approvals directory: ${dir}`);
  }
  try {
    fs.chmodSync(dir, 0o700);
  } catch (err) {
    if (process.platform !== "win32") {
      throw err;
    }
  }

  const lockPath = `${filePath}.lock`;
  try {
    if (fs.lstatSync(lockPath).isSymbolicLink()) {
      throw new Error(`Refusing to write exec approvals via symlink: ${lockPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

function isFileLockContentionError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "file_lock_timeout" || code === "file_lock_stale";
}

export async function withExecApprovalsLock<T>(
  store: ExecApprovalsMutationStore,
  mutate: (
    snapshot: ExecApprovalsSnapshot,
  ) => ExecApprovalsMutation<T> | Promise<ExecApprovalsMutation<T>>,
): Promise<T> {
  const filePath = store.resolvePath();
  if (hasUnmigratedLegacyExecApprovals(filePath)) {
    throw new Error("Exec approvals migration required before mutation");
  }
  assertSafeExecApprovalsLockDestination(filePath);
  try {
    return await withFileLock(
      filePath,
      {
        allowReentrant: false,
        retries: {
          retries: EXEC_APPROVALS_LOCK_TIMEOUT_RETRIES,
          factor: 1,
          minTimeout: EXEC_APPROVALS_LOCK_POLL_INTERVAL_MS,
          maxTimeout: EXEC_APPROVALS_LOCK_POLL_INTERVAL_MS,
        },
        stale: EXEC_APPROVALS_LOCK_STALE_MS,
      },
      async () => {
        const snapshot = store.readSnapshot();
        const mutation = await mutate(snapshot);
        if (mutation.kind === "save") {
          store.save(mutation.file);
        } else if (mutation.kind === "restore") {
          store.restore(mutation.snapshot);
        }
        return mutation.result;
      },
    );
  } catch (err) {
    if (isFileLockContentionError(err)) {
      throw new ExecApprovalsLockContentionError();
    }
    throw err;
  }
}
