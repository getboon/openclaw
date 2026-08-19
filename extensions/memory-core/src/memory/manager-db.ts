// Memory Core plugin module implements manager db behavior.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  closeMemorySqliteWalMaintenance,
  configureMemorySqliteWalMaintenance,
  ensureDir,
  loadSqliteVecExtension,
  requireNodeSqlite,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import {
  ensureOpenClawAgentDatabaseSchema,
  runSqliteImmediateTransactionSync,
} from "openclaw/plugin-sdk/sqlite-runtime";
import {
  tryAcquireMemoryReindexLock,
  type MemoryReindexLockHandle,
} from "./manager-reindex-lock.js";

const MEMORY_REINDEX_SCHEMA = "memory_reindex";
const MEMORY_INDEX_STATE_ID = 1;
const MEMORY_DATABASE_FILE_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;
const MEMORY_REINDEX_ENTRY_SUFFIXES = ["-wal", "-shm", "-journal", ""] as const;
const MEMORY_REINDEX_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Orphan age floor for cleanupAgedMemoryReindexTempFiles.
//
// This used to be 24 h, which made the GC structurally unable to break the
// failure it exists to prevent: the orphan that is actively filling the disk is,
// by definition, younger than 24 h. A host with a multi-GB agent DB strands ~10 GB
// per killed reindex, so two orphans inside one day exhaust the volume while the
// GC declines to collect either.
//
// A long floor is not what makes the GC safe -- the EXCLUSIVE reindex lock is.
// cleanupAgedMemoryReindexTempFiles only runs while holding it, and
// runInPlaceReindex holds that same lock from before the shadow is created until
// after it is removed. So with the lock held, no reindex for this database can be
// running and every shadow present is provably abandoned; age is irrelevant.
//
// The floor is therefore kept only as narrow defence-in-depth against a
// shadow-creating path that does not take the lock (there is none in-tree), and is
// short enough that the GC can actually collect the orphan that matters. Override
// with OPENCLAW_MEMORY_REINDEX_ORPHAN_MIN_AGE_MS; a malformed or negative value
// falls back to the default rather than disabling the floor.
const MEMORY_REINDEX_ORPHAN_MIN_AGE_DEFAULT_MS = 60_000;

function resolveMemoryReindexOrphanMinAgeMs(): number {
  const raw = process.env.OPENCLAW_MEMORY_REINDEX_ORPHAN_MIN_AGE_MS;
  if (raw === undefined || raw.trim() === "") {
    return MEMORY_REINDEX_ORPHAN_MIN_AGE_DEFAULT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return MEMORY_REINDEX_ORPHAN_MIN_AGE_DEFAULT_MS;
  }
  return parsed;
}

function resolveMemoryReindexBaseName(
  databaseBaseName: string,
  entryName: string,
): string | undefined {
  for (const suffix of MEMORY_REINDEX_ENTRY_SUFFIXES) {
    if (!entryName.endsWith(suffix)) {
      continue;
    }
    const baseName = entryName.slice(0, entryName.length - suffix.length);
    const prefix = `${databaseBaseName}.memory-reindex-`;
    if (
      baseName.startsWith(prefix) &&
      MEMORY_REINDEX_UUID_PATTERN.test(baseName.slice(prefix.length))
    ) {
      return baseName;
    }
  }
  return undefined;
}

function isRegularFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function tableExists(db: DatabaseSync, schema: string, tableName: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS ok FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { ok?: unknown } | undefined;
  return row?.ok === 1;
}

function readTableSql(db: DatabaseSync, schema: string, tableName: string): string | null {
  const row = db
    .prepare(`SELECT sql FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { sql?: unknown } | undefined;
  return typeof row?.sql === "string" && row.sql.trim() ? row.sql : null;
}

function hasSqliteVecExtension(db: DatabaseSync): boolean {
  try {
    const row = db.prepare("SELECT vec_version() AS version").get() as
      | { version?: unknown }
      | undefined;
    return typeof row?.version === "string" && row.version.trim().length > 0;
  } catch {
    return false;
  }
}

export function readMemoryDatabaseRevision(db: DatabaseSync): number {
  const row = db
    .prepare("SELECT revision FROM memory_index_state WHERE id = ?")
    .get(MEMORY_INDEX_STATE_ID) as { revision?: unknown } | undefined;
  if (typeof row?.revision !== "number" || !Number.isSafeInteger(row.revision)) {
    throw new Error("Memory index revision is missing or invalid");
  }
  return row.revision;
}

function replaceVirtualTable(params: {
  db: DatabaseSync;
  tableName: "memory_index_chunks_fts" | "memory_index_chunks_vec";
  columns: string;
  ignoreDropErrorWhenSourceMissing?: boolean;
}): void {
  const { db, tableName, columns } = params;
  const createSql = readTableSql(db, MEMORY_REINDEX_SCHEMA, tableName);
  if (!createSql) {
    try {
      db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
    } catch (err) {
      if (!params.ignoreDropErrorWhenSourceMissing) {
        throw err;
      }
    }
    return;
  }
  db.exec(`DROP TABLE IF EXISTS main.${tableName}`);
  db.exec(createSql);
  db.exec(
    `INSERT INTO main.${tableName} (${columns}) ` +
      `SELECT ${columns} FROM ${MEMORY_REINDEX_SCHEMA}.${tableName}`,
  );
}

/** Publish a completed shadow memory index without replacing the shared agent database file. */
export async function publishMemoryDatabaseTables(params: {
  targetDb: DatabaseSync;
  sourcePath: string;
  metaKey: string;
  expectedRevision: number;
  vectorExtensionPath?: string;
}): Promise<void> {
  params.targetDb.prepare(`ATTACH DATABASE ? AS ${MEMORY_REINDEX_SCHEMA}`).run(params.sourcePath);
  try {
    if (
      tableExists(params.targetDb, MEMORY_REINDEX_SCHEMA, "memory_index_chunks_vec") &&
      !hasSqliteVecExtension(params.targetDb)
    ) {
      const loaded = await loadSqliteVecExtension({
        db: params.targetDb,
        extensionPath: params.vectorExtensionPath,
      });
      if (!loaded.ok) {
        throw new Error(
          `Failed to load sqlite-vec before publishing the full memory reindex: ` +
            (loaded.error ?? "unknown sqlite-vec load error"),
        );
      }
    }
    runSqliteImmediateTransactionSync(params.targetDb, () => {
      const liveRevision = readMemoryDatabaseRevision(params.targetDb);
      if (liveRevision !== params.expectedRevision) {
        throw new Error(
          `Memory index changed while full reindex was building ` +
            `(expected revision ${params.expectedRevision}, found ${liveRevision}); retry the full reindex.`,
        );
      }
      params.targetDb
        .prepare("DELETE FROM main.memory_index_meta WHERE key = ?")
        .run(params.metaKey);
      params.targetDb
        .prepare(
          `INSERT INTO main.memory_index_meta (key, value)
           SELECT key, value FROM ${MEMORY_REINDEX_SCHEMA}.memory_index_meta WHERE key = ?`,
        )
        .run(params.metaKey);

      params.targetDb.exec(`
        DELETE FROM main.memory_index_sources;
        INSERT INTO main.memory_index_sources (path, source, hash, mtime, size)
        SELECT path, source, hash, mtime, size FROM ${MEMORY_REINDEX_SCHEMA}.memory_index_sources;

        DELETE FROM main.memory_index_chunks;
        INSERT INTO main.memory_index_chunks (
          id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
        )
        SELECT
          id, path, source, start_line, end_line, hash, model, text, embedding, updated_at
        FROM ${MEMORY_REINDEX_SCHEMA}.memory_index_chunks;
      `);

      if (tableExists(params.targetDb, MEMORY_REINDEX_SCHEMA, "memory_embedding_cache")) {
        params.targetDb.exec(`
          DELETE FROM main.memory_embedding_cache;
          INSERT INTO main.memory_embedding_cache (
            provider, model, provider_key, hash, embedding, dims, updated_at
          )
          SELECT provider, model, provider_key, hash, embedding, dims, updated_at
          FROM ${MEMORY_REINDEX_SCHEMA}.memory_embedding_cache;
        `);
      }

      replaceVirtualTable({
        db: params.targetDb,
        tableName: "memory_index_chunks_fts",
        columns: "text, id, path, source, model, start_line, end_line",
      });
      replaceVirtualTable({
        db: params.targetDb,
        tableName: "memory_index_chunks_vec",
        columns: "id, embedding",
        // A vector-disabled connection may not have sqlite-vec loaded and cannot
        // drop an old virtual table. Missing vector metadata forces a strict
        // rebuild before that table can be queried again.
        ignoreDropErrorWhenSourceMissing: true,
      });
    });
  } finally {
    params.targetDb.exec(`DETACH DATABASE ${MEMORY_REINDEX_SCHEMA}`);
  }
}

/** Remove one closed shadow memory database and its journal-mode sidecars. */
export function removeMemoryDatabaseFiles(dbPath: string): void {
  for (const suffix of MEMORY_DATABASE_FILE_SUFFIXES) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

/** Remove crash-left shadow databases only when no full reindex is active. */
export function cleanupAgedMemoryReindexTempFiles(dbPath: string, nowMs = Date.now()): void {
  if (!isRegularFile(dbPath)) {
    return;
  }

  let reindexLock: MemoryReindexLockHandle | undefined;
  try {
    reindexLock = tryAcquireMemoryReindexLock(dbPath);
  } catch {
    return;
  }
  if (!reindexLock) {
    return;
  }

  try {
    const dir = path.dirname(dbPath);
    const databaseBaseName = path.basename(dbPath);
    const shadowBaseNames = new Set<string>();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const shadowBaseName = resolveMemoryReindexBaseName(databaseBaseName, entry.name);
      if (shadowBaseName) {
        shadowBaseNames.add(shadowBaseName);
      }
    }

    for (const shadowBaseName of shadowBaseNames) {
      const filePaths = MEMORY_DATABASE_FILE_SUFFIXES.map((suffix) =>
        path.join(dir, `${shadowBaseName}${suffix}`),
      );
      const stats: fs.Stats[] = [];
      let hasUnknownFileState = false;
      for (const filePath of filePaths) {
        try {
          stats.push(fs.statSync(filePath));
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            hasUnknownFileState = true;
            break;
          }
        }
      }
      if (hasUnknownFileState || stats.length === 0) {
        continue;
      }
      if (
        nowMs - Math.max(...stats.map((stat) => stat.mtimeMs)) <
        resolveMemoryReindexOrphanMinAgeMs()
      ) {
        continue;
      }
      for (const filePath of filePaths) {
        try {
          fs.rmSync(filePath, { force: true });
        } catch {}
      }
    }
  } finally {
    try {
      reindexLock.release();
    } catch {}
  }
}

/**
 * List the distinct shadow base names for `dbPath` that currently exist on disk.
 *
 * Used by the one-shadow circuit breaker in runInPlaceReindex. It deliberately
 * reads the FILESYSTEM rather than in-process state: an orphan exists precisely
 * because the process that held that state was hard-killed, so in-memory
 * bookkeeping cannot see it.
 */
export function listMemoryReindexShadowBaseNames(dbPath: string): string[] {
  const dir = path.dirname(dbPath);
  const databaseBaseName = path.basename(dbPath);
  const shadowBaseNames = new Set<string>();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const shadowBaseName = resolveMemoryReindexBaseName(databaseBaseName, entry.name);
    if (shadowBaseName) {
      shadowBaseNames.add(shadowBaseName);
    }
  }
  return [...shadowBaseNames];
}

/** Total bytes currently occupied by shadow databases for `dbPath`. */
export function measureMemoryReindexShadowBytes(dbPath: string): number {
  const dir = path.dirname(dbPath);
  let total = 0;
  for (const shadowBaseName of listMemoryReindexShadowBaseNames(dbPath)) {
    for (const suffix of MEMORY_DATABASE_FILE_SUFFIXES) {
      try {
        total += fs.statSync(path.join(dir, `${shadowBaseName}${suffix}`)).size;
      } catch {}
    }
  }
  return total;
}

export function openMemoryDatabaseAtPath(
  dbPath: string,
  allowExtension: boolean,
  agentId?: string,
): DatabaseSync {
  ensureDir(path.dirname(dbPath));
  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath, { allowExtension });
  try {
    configureMemorySqliteWalMaintenance(db, {
      busyTimeoutMs: 5000,
      databasePath: dbPath,
    });
    if (agentId) {
      ensureOpenClawAgentDatabaseSchema(db, { agentId, path: dbPath, register: true });
    }
    return db;
  } catch (err) {
    try {
      closeMemorySqliteWalMaintenance(db);
      db.close();
    } catch {}
    throw err;
  }
}

export function closeMemoryDatabase(db: DatabaseSync): void {
  closeMemorySqliteWalMaintenance(db);
  db.close();
}
