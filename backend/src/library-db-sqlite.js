const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();

const DATA_DIR = path.join(__dirname, "..", "data", "library");
const dbPath = path.join(DATA_DIR, "kb.sqlite");
let db;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

async function initDb() {
  ensureDataDir();
  db = new sqlite3.Database(dbPath);

  await run("PRAGMA foreign_keys = ON");

  await run(
    "CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, content TEXT, source TEXT, type TEXT DEFAULT 'note', hash TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)",
  );

  await ensureColumn("entries", "type", "TEXT DEFAULT 'note'");
  await ensureColumn("entries", "hash", "TEXT");

  await run(
    "CREATE TABLE IF NOT EXISTS cleaned_entries (entry_id INTEGER PRIMARY KEY, content TEXT, hash TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE)",
  );

  await run(
    "CREATE TABLE IF NOT EXISTS refined_entries (entry_id INTEGER PRIMARY KEY, type TEXT, title TEXT, hash TEXT, data_json TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE)",
  );

  await run(
    "CREATE TABLE IF NOT EXISTS annotations (entry_id INTEGER PRIMARY KEY, summary TEXT, tags TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(entry_id) REFERENCES entries(id) ON DELETE CASCADE)",
  );

  await backfillEntryHashes();
}

function computeHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function cleanContent(value) {
  const normalized = String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\r\n/g, "\n");
  return normalized.replace(/\n{3,}/g, "\n\n").trim();
}

async function ensureColumn(tableName, columnName, columnType) {
  const info = await all(`PRAGMA table_info(${tableName})`);
  const exists = info.some((col) => col.name === columnName);
  if (!exists) {
    await run(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`,
    );
  }
}

async function backfillEntryHashes() {
  const rows = await all("SELECT id, title, content, type, hash FROM entries");

  for (const row of rows) {
    const type = row.type || "note";
    const sourceHash =
      row.hash ||
      computeHash(`${type}|${row.title || ""}|${row.content || ""}`);
    if (!row.hash) {
      await run("UPDATE entries SET type = ?, hash = ? WHERE id = ?", [
        type,
        sourceHash,
        row.id,
      ]);
    }
  }
}

async function insertEntry({ title, content, source, type }) {
  const safeType = type || "note";
  const sourceHash = computeHash(`${safeType}|${title || ""}|${content || ""}`);
  const result = await run(
    "INSERT INTO entries (title, content, source, type, hash) VALUES (?, ?, ?, ?, ?)",
    [title, content, source, safeType, sourceHash],
  );

  return result.lastID;
}

async function updateEntryById(id, { title, content, source, type }) {
  const entry = await get(
    "SELECT id, title, content, source, type FROM entries WHERE id = ?",
    [id],
  );
  if (!entry) {
    return null;
  }

  const nextTitle = title !== undefined ? title : entry.title;
  const nextContent = content !== undefined ? content : entry.content;
  const nextSource = source !== undefined ? source : entry.source;
  const nextType = type !== undefined ? type : entry.type || "note";
  const nextHash = computeHash(
    `${nextType}|${nextTitle || ""}|${nextContent || ""}`,
  );

  await run(
    "UPDATE entries SET title = ?, content = ?, source = ?, type = ?, hash = ? WHERE id = ?",
    [nextTitle, nextContent, nextSource, nextType, nextHash, id],
  );

  return getEntryById(id);
}

async function getEntryById(id) {
  const entry = await get(
    "SELECT id, title, content, source, type, hash, created_at FROM entries WHERE id = ?",
    [id],
  );
  if (!entry) {
    return null;
  }

  const annotation = await get(
    "SELECT summary, tags FROM annotations WHERE entry_id = ?",
    [id],
  );

  return {
    ...entry,
    summary: annotation ? annotation.summary : null,
    tags: annotation ? JSON.parse(annotation.tags || "[]") : [],
  };
}

async function listEntries(filters = {}) {
  const clauses = [];
  const params = [];

  if (filters.type) {
    clauses.push("e.type = ?");
    params.push(filters.type);
  }

  if (filters.q) {
    clauses.push("(e.title LIKE ? OR e.content LIKE ?)");
    params.push(`%${filters.q}%`, `%${filters.q}%`);
  }

  if (filters.tag) {
    clauses.push("a.tags LIKE ?");
    params.push(`%\"${filters.tag}\"%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Number.isFinite(filters.limit) ? filters.limit : 50;
  const offset = Number.isFinite(filters.offset) ? filters.offset : 0;

  const rows = await all(
    `SELECT e.id, e.title, e.content, e.source, e.type, e.hash, e.created_at, a.summary, a.tags FROM entries e LEFT JOIN annotations a ON e.id = a.entry_id ${where} ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    type: row.type,
    hash: row.hash,
    created_at: row.created_at,
    summary: row.summary || null,
    tags: row.tags ? JSON.parse(row.tags) : [],
  }));
}

async function getCleanedEntryById(id) {
  const entry = await get(
    "SELECT id, content, created_at FROM entries WHERE id = ?",
    [id],
  );
  if (!entry) {
    return null;
  }

  const cleaned = cleanContent(entry.content || "");
  const cleanedHash = computeHash(cleaned);

  return {
    entry_id: entry.id,
    content: cleaned,
    hash: cleanedHash,
    updated_at: entry.created_at,
  };
}

async function upsertRefinedEntry({ entryId, type, title, dataJson, hash }) {
  await run(
    "INSERT INTO refined_entries (entry_id, type, title, hash, data_json) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO UPDATE SET type = excluded.type, title = excluded.title, hash = excluded.hash, data_json = excluded.data_json, updated_at = CURRENT_TIMESTAMP",
    [entryId, type || "note", title || "", hash || "", dataJson || "{}"],
  );
}

async function listRefinedEntries() {
  const rows = await all(
    "SELECT entry_id, type, title, data_json FROM refined_entries ORDER BY entry_id DESC",
  );
  return rows.map((row) => ({
    entry_id: row.entry_id,
    type: row.type,
    title: row.title,
    data: row.data_json ? JSON.parse(row.data_json) : {},
  }));
}

async function getRefinedEntryById(id) {
  const row = await get(
    "SELECT entry_id, type, title, data_json FROM refined_entries WHERE entry_id = ?",
    [id],
  );
  if (!row) {
    return null;
  }

  return {
    entry_id: row.entry_id,
    type: row.type,
    title: row.title,
    data: row.data_json ? JSON.parse(row.data_json) : {},
  };
}

async function listModifiedEntries() {
  return all(
    "SELECT e.id, e.type FROM entries e JOIN refined_entries r ON e.id = r.entry_id WHERE e.hash IS NOT NULL AND r.hash IS NOT NULL AND e.hash != r.hash ORDER BY e.id DESC",
  );
}

async function listNewEntries() {
  return all(
    "SELECT e.id, e.type FROM entries e LEFT JOIN refined_entries r ON e.id = r.entry_id WHERE r.entry_id IS NULL ORDER BY e.id DESC",
  );
}

async function deleteRefinedEntryById(id) {
  await run("DELETE FROM refined_entries WHERE entry_id = ?", [id]);
}

async function deleteEntryById(id) {
  await run("DELETE FROM entries WHERE id = ?", [id]);
}

module.exports = {
  DATA_DIR,
  initDb,
  insertEntry,
  updateEntryById,
  getEntryById,
  listEntries,
  getCleanedEntryById,
  upsertRefinedEntry,
  getRefinedEntryById,
  listRefinedEntries,
  listModifiedEntries,
  listNewEntries,
  deleteRefinedEntryById,
  deleteEntryById,
};
