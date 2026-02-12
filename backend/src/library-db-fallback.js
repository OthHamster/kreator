const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data", "library-fallback");
const STORE_FILE = path.join(DATA_DIR, "store.json");

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

async function ensureStore() {
  if (!fsSync.existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }

  if (!fsSync.existsSync(STORE_FILE)) {
    await fs.writeFile(
      STORE_FILE,
      JSON.stringify({ entries: [], refinedEntries: [] }, null, 2),
      "utf8",
    );
  }
}

async function readStore() {
  await ensureStore();
  const raw = await fs.readFile(STORE_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      refinedEntries: Array.isArray(parsed.refinedEntries)
        ? parsed.refinedEntries
        : [],
    };
  } catch (error) {
    return { entries: [], refinedEntries: [] };
  }
}

async function writeStore(store) {
  await ensureStore();
  await fs.writeFile(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

async function initDb() {
  await ensureStore();
}

function nextEntryId(entries) {
  if (entries.length === 0) {
    return 1;
  }
  return Math.max(...entries.map((item) => item.id || 0)) + 1;
}

async function insertEntry({ title, content, source, type }) {
  const store = await readStore();
  const id = nextEntryId(store.entries);
  const safeType = type || "note";
  const now = new Date().toISOString();
  const record = {
    id,
    title: title || "",
    content: content || "",
    source: source || "",
    type: safeType,
    hash: computeHash(`${safeType}|${title || ""}|${content || ""}`),
    created_at: now,
    summary: null,
    tags: [],
  };
  store.entries.push(record);
  await writeStore(store);
  return id;
}

async function getEntryById(id) {
  const store = await readStore();
  const entry = store.entries.find((item) => item.id === id);
  return entry || null;
}

async function listEntries(filters = {}) {
  const store = await readStore();
  const q = String(filters.q || "")
    .trim()
    .toLowerCase();
  const tag = String(filters.tag || "")
    .trim()
    .toLowerCase();
  const type = String(filters.type || "")
    .trim()
    .toLowerCase();
  const limit = Number.isFinite(filters.limit) ? filters.limit : 50;
  const offset = Number.isFinite(filters.offset) ? filters.offset : 0;

  const filtered = store.entries.filter((entry) => {
    if (type && String(entry.type || "").toLowerCase() !== type) {
      return false;
    }

    if (q) {
      const text = `${entry.title || ""} ${entry.content || ""}`.toLowerCase();
      if (!text.includes(q)) {
        return false;
      }
    }

    if (tag) {
      const tags = Array.isArray(entry.tags) ? entry.tags : [];
      if (!tags.some((item) => String(item).toLowerCase() === tag)) {
        return false;
      }
    }

    return true;
  });

  return filtered.sort((a, b) => b.id - a.id).slice(offset, offset + limit);
}

async function updateEntryById(id, { title, content, source, type }) {
  const store = await readStore();
  const index = store.entries.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return null;
  }

  const current = store.entries[index];
  const next = {
    ...current,
    title: title !== undefined ? title : current.title,
    content: content !== undefined ? content : current.content,
    source: source !== undefined ? source : current.source,
    type: type !== undefined ? type : current.type,
  };

  next.hash = computeHash(
    `${next.type || "note"}|${next.title || ""}|${next.content || ""}`,
  );

  store.entries[index] = next;
  await writeStore(store);
  return next;
}

async function deleteEntryById(id) {
  const store = await readStore();
  store.entries = store.entries.filter((entry) => entry.id !== id);
  store.refinedEntries = store.refinedEntries.filter(
    (entry) => entry.entry_id !== id,
  );
  await writeStore(store);
}

async function getCleanedEntryById(id) {
  const entry = await getEntryById(id);
  if (!entry) {
    return null;
  }

  const cleaned = cleanContent(entry.content || "");
  return {
    entry_id: entry.id,
    content: cleaned,
    hash: computeHash(cleaned),
    updated_at: entry.created_at,
  };
}

async function upsertRefinedEntry({ entryId, type, title, hash, dataJson }) {
  const store = await readStore();
  const index = store.refinedEntries.findIndex(
    (item) => item.entry_id === entryId,
  );

  const record = {
    entry_id: entryId,
    type: type || "note",
    title: title || "",
    hash: hash || "",
    data_json: dataJson || "{}",
    updated_at: new Date().toISOString(),
  };

  if (index === -1) {
    store.refinedEntries.push(record);
  } else {
    store.refinedEntries[index] = {
      ...store.refinedEntries[index],
      ...record,
    };
  }

  await writeStore(store);
}

async function getRefinedEntryById(id) {
  const store = await readStore();
  return store.refinedEntries.find((item) => item.entry_id === id) || null;
}

async function listRefinedEntries() {
  const store = await readStore();
  return [...store.refinedEntries].sort((a, b) => b.entry_id - a.entry_id);
}

async function listModifiedEntries() {
  const store = await readStore();
  const refinedMap = new Map(
    store.refinedEntries.map((item) => [item.entry_id, item]),
  );
  return store.entries
    .filter((entry) => {
      const refined = refinedMap.get(entry.id);
      return refined && refined.hash && refined.hash !== entry.hash;
    })
    .map((entry) => ({
      id: entry.id,
      type: entry.type || "note",
      title: entry.title || "",
    }));
}

async function listNewEntries() {
  const store = await readStore();
  const refinedSet = new Set(store.refinedEntries.map((item) => item.entry_id));
  return store.entries
    .filter((entry) => !refinedSet.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      type: entry.type || "note",
      title: entry.title || "",
    }));
}

async function deleteRefinedEntryById(id) {
  const store = await readStore();
  store.refinedEntries = store.refinedEntries.filter(
    (entry) => entry.entry_id !== id,
  );
  await writeStore(store);
}

module.exports = {
  DATA_DIR,
  initDb,
  getEntryById,
  listEntries,
  insertEntry,
  updateEntryById,
  getCleanedEntryById,
  upsertRefinedEntry,
  getRefinedEntryById,
  listRefinedEntries,
  listModifiedEntries,
  listNewEntries,
  deleteRefinedEntryById,
  deleteEntryById,
};
