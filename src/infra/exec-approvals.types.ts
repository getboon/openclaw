// Serialized allowlist entries stored with enough command context to explain
// why an approval can be reused later.
export type ExecSecurity = "deny" | "allowlist" | "full";
export type ExecAsk = "off" | "on-miss" | "always";

export type ExecAllowlistEntry = {
  id?: string;
  pattern: string;
  source?: "allow-always";
  commandText?: string;
  argPattern?: string;
  lastUsedAt?: number;
  lastUsedCommand?: string;
  lastResolvedPath?: string;
};

export type ExecApprovalsDefaults = {
  security?: ExecSecurity;
  ask?: ExecAsk;
  askFallback?: ExecSecurity;
  autoAllowSkills?: boolean;
};

export type ExecApprovalsAgent = ExecApprovalsDefaults & {
  allowlist?: ExecAllowlistEntry[];
};

export type ExecApprovalsFile = {
  version: 1;
  socket?: {
    path?: string;
    token?: string;
  };
  defaults?: ExecApprovalsDefaults;
  agents?: Record<string, ExecApprovalsAgent>;
};

export type ExecApprovalsSnapshot = {
  path: string;
  exists: boolean;
  raw: string | null;
  file: ExecApprovalsFile;
  hash: string;
};
