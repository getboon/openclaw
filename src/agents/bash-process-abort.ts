import { killProcessTree } from "../process/kill-tree.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import {
  listAllRunningSessions,
  markExited,
  type ProcessSession,
} from "./bash-process-registry.js";

function cancelExecSession(session: ProcessSession): boolean {
  const supervisor = getProcessSupervisor();
  const record = supervisor.getRecord(session.id);
  if (record && record.state !== "exited") {
    supervisor.cancel(session.id, "manual-cancel");
    return true;
  }
  const pid = session.pid ?? session.child?.pid;
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }
  killProcessTree(pid);
  markExited(session, null, "SIGKILL", "killed");
  return true;
}

/** Cancels every running exec process owned by the given sessions without waking them. */
export function killExecProcessesForSessions(sessionKeys: readonly string[]): number {
  const keys = new Set(sessionKeys);
  if (keys.size === 0) {
    return 0;
  }
  let killed = 0;
  for (const session of listAllRunningSessions()) {
    const owned =
      (session.scopeKey !== undefined && keys.has(session.scopeKey)) ||
      (session.sessionKey !== undefined && keys.has(session.sessionKey));
    if (!owned) {
      continue;
    }
    // A stopped session must not get an exit system event or heartbeat wake for its own kill.
    session.exitNotified = true;
    if (cancelExecSession(session)) {
      killed += 1;
    }
  }
  return killed;
}
