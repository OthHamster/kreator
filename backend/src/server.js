const express = require("express");
const cors = require("cors");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const {
  initDb: initLibraryDb,
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
} = require("../../Library/db");

const app = express();
const PORT = process.env.PORT || 4000;
const DATA_FILE = path.join(__dirname, "..", "data", "music.json");
const INTEGRATION_MAP_FILE = path.join(
  __dirname,
  "..",
  "data",
  "integration-map.json",
);
const LIBRARY_API_PREFIX_DEFAULT = "/library-api";
const LIBRARY_DATA_DIR = path.join(__dirname, "..", "..", "Library", "data");
const LIBRARY_REFINED_JSON_PATH = path.join(LIBRARY_DATA_DIR, "refined.json");
const LIBRARY_TYPES_JSON_PATH = path.join(LIBRARY_DATA_DIR, "types.json");

const LEVEL_ORDER = ["album", "single", "segment", "phrase", "timbre"];
const LEVELS = new Set(["album", "single", "segment", "phrase", "timbre"]);
const CATEGORY = new Set(["form", "material"]);

app.use(cors());
app.use(express.json());

function toSafeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toSafeLower(value) {
  return toSafeString(value).toLowerCase();
}

function normalizeLevel(value) {
  const level = toSafeLower(value);
  return LEVELS.has(level) ? level : "";
}

function normalizeCategory(value) {
  const category = toSafeLower(value);
  return CATEGORY.has(category) ? category : "";
}

function normalizeNumericId(value) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  const text = toSafeString(value);
  if (/^\d+$/.test(text)) {
    return Number(text);
  }

  return null;
}

function nextId(items) {
  if (!items.length) {
    return 0;
  }
  return Math.max(...items.map((item) => item.id)) + 1;
}

function parseParamId(value) {
  const parsed = normalizeNumericId(value);
  return parsed === null ? null : parsed;
}

function normalizeNode(input) {
  const content = toSafeString(input?.content);
  const level = normalizeLevel(input?.level);
  const category = normalizeCategory(input?.category);
  return { content, level, category };
}

function nodeMatchesFilters(node, { level, keyword }) {
  const matchesLevel = level ? node.level === level : true;
  const matchesCategory = true;

  const haystack = `${node.content}`.toLowerCase();
  const matchesKeyword = keyword ? haystack.includes(keyword) : true;
  return matchesLevel && matchesCategory && matchesKeyword;
}

function normalizeKnowledgePoints(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeNumericId(item))
    .filter((item) => item !== null);
}

function areValidKnowledgeIds(ids, nodes) {
  const idSet = new Set(nodes.map((node) => node.id));
  return ids.every((id) => idSet.has(id));
}

function getUsableLevelsForNode(node) {
  const levelIndex = LEVEL_ORDER.indexOf(node.level);
  if (levelIndex === -1) {
    return [];
  }

  const usableLevels = new Set([node.level]);
  if (node.category === "material") {
    const lowerLevel = LEVEL_ORDER[levelIndex + 1];
    if (lowerLevel) {
      usableLevels.add(lowerLevel);
    }
  }
  if (node.category === "form") {
    const higherLevel = LEVEL_ORDER[levelIndex - 1];
    if (higherLevel) {
      usableLevels.add(higherLevel);
    }
  }

  return [...usableLevels];
}

function findUnavailableKnowledgeIds(ids, nodes, recipeLevel) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return ids.filter((id) => {
    const node = nodeMap.get(id);
    if (!node) {
      return false;
    }
    const usableLevels = getUsableLevelsForNode(node);
    return !usableLevels.includes(recipeLevel);
  });
}

function getRelativeCategory(node, targetLevel) {
  if (targetLevel === node.level) {
    return node.category;
  }

  const levelIndex = LEVEL_ORDER.indexOf(node.level);
  if (levelIndex === -1) {
    return "";
  }

  if (node.category === "material") {
    const lowerLevel = LEVEL_ORDER[levelIndex + 1];
    return targetLevel === lowerLevel ? "form" : "";
  }

  if (node.category === "form") {
    const higherLevel = LEVEL_ORDER[levelIndex - 1];
    return targetLevel === higherLevel ? "material" : "";
  }

  return "";
}

function normalizeRecipe(input) {
  const knowledgePoints = normalizeKnowledgePoints(input?.knowledgePoints);
  const procedure = toSafeString(input?.procedure);
  const level = normalizeLevel(input?.level);
  const description = toSafeString(input?.description);
  return { knowledgePoints, procedure, level, description };
}

function recipeMatchesFilters(recipe, { level, keyword }) {
  const matchesLevel = level ? recipe.level === level : true;
  const haystack =
    `${recipe.description} ${recipe.procedure} ${recipe.knowledgePoints.join(" ")}`.toLowerCase();
  const matchesKeyword = keyword ? haystack.includes(keyword) : true;
  return matchesLevel && matchesKeyword;
}

async function readStore() {
  try {
    const data = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(data);

    const rawNodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const preparedNodes = rawNodes
      .map((node) => {
        const normalized = normalizeNode(node);
        const fallbackCategory = normalizeCategory(node?.category) || "form";
        if (!normalized.content || !normalized.level) {
          return null;
        }
        return {
          oldIdKey: String(node?.id ?? ""),
          existingNumericId: normalizeNumericId(node?.id),
          content: normalized.content,
          level: normalized.level,
          category: normalized.category || fallbackCategory,
        };
      })
      .filter(Boolean);

    const usedNodeIds = new Set();
    const nodeIdMap = new Map();
    const nodes = [];

    for (const node of preparedNodes) {
      let id = node.existingNumericId;
      if (id === null || usedNodeIds.has(id)) {
        id = 0;
        while (usedNodeIds.has(id)) {
          id += 1;
        }
      }
      usedNodeIds.add(id);
      nodeIdMap.set(node.oldIdKey, id);
      nodes.push({
        id,
        content: node.content,
        level: node.level,
        category: node.category,
      });
    }

    const rawRecipes = Array.isArray(parsed.recipes) ? parsed.recipes : [];
    const preparedRecipes = rawRecipes
      .map((recipe) => {
        const normalized = normalizeRecipe(recipe);

        const convertedKnowledgePoints = Array.isArray(recipe?.knowledgePoints)
          ? recipe.knowledgePoints
              .map((value) => {
                const numeric = normalizeNumericId(value);
                if (numeric !== null) {
                  return numeric;
                }
                const mapped = nodeIdMap.get(String(value ?? ""));
                return mapped ?? null;
              })
              .filter((id) => id !== null)
          : [];

        if (
          !normalized.level ||
          !normalized.description ||
          !normalized.procedure ||
          !convertedKnowledgePoints.length
        ) {
          return null;
        }

        if (!areValidKnowledgeIds(convertedKnowledgePoints, nodes)) {
          return null;
        }

        return {
          existingNumericId: normalizeNumericId(recipe?.id),
          knowledgePoints: convertedKnowledgePoints,
          procedure: normalized.procedure,
          level: normalized.level,
          description: normalized.description,
        };
      })
      .filter(Boolean);

    const usedRecipeIds = new Set();
    const recipes = [];
    for (const recipe of preparedRecipes) {
      let id = recipe.existingNumericId;
      if (id === null || usedRecipeIds.has(id)) {
        id = 0;
        while (usedRecipeIds.has(id)) {
          id += 1;
        }
      }
      usedRecipeIds.add(id);
      recipes.push({
        id,
        knowledgePoints: recipe.knowledgePoints,
        procedure: recipe.procedure,
        level: recipe.level,
        description: recipe.description,
      });
    }

    // Legacy migration from old music list
    if (!nodes.length && Array.isArray(parsed.music)) {
      const migratedNodes = parsed.music.map((item, index) => ({
        id: index,
        content: toSafeString(item.description),
        level: "single",
        category: "form",
      }));
      return { nodes: migratedNodes, recipes };
    }

    return { nodes, recipes };
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeStore({ nodes: [], recipes: [] });
      return { nodes: [], recipes: [] };
    }
    throw error;
  }
}

async function writeStore(store) {
  const dir = path.dirname(DATA_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    DATA_FILE,
    JSON.stringify(
      { nodes: store.nodes || [], recipes: store.recipes || [] },
      null,
      2,
    ),
    "utf8",
  );
}

async function readNodeList() {
  const store = await readStore();
  return store.nodes;
}

async function writeNodeList(nodes) {
  const store = await readStore();
  await writeStore({ ...store, nodes });
}

async function readRecipeList() {
  const store = await readStore();
  return store.recipes;
}

async function writeRecipeList(recipes) {
  const store = await readStore();
  await writeStore({ ...store, recipes });
}

async function readIntegrationMap() {
  try {
    const data = await fs.readFile(INTEGRATION_MAP_FILE, "utf8");
    const parsed = JSON.parse(data);
    const processedEntryIds = Array.isArray(parsed?.processedEntryIds)
      ? parsed.processedEntryIds
          .map((id) => normalizeNumericId(id))
          .filter((id) => id !== null)
      : [];
    const entryMappings =
      parsed?.entryMappings && typeof parsed.entryMappings === "object"
        ? parsed.entryMappings
        : {};
    return { processedEntryIds, entryMappings };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { processedEntryIds: [], entryMappings: {} };
    }
    throw error;
  }
}

async function writeIntegrationMap(map) {
  const dir = path.dirname(INTEGRATION_MAP_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    INTEGRATION_MAP_FILE,
    JSON.stringify(
      {
        processedEntryIds: map.processedEntryIds || [],
        entryMappings: map.entryMappings || {},
      },
      null,
      2,
    ),
    "utf8",
  );
}

function normalizeBaseUrl(value) {
  const text = toSafeString(value) || `http://localhost:${PORT}`;
  return text.replace(/\/+$/, "");
}

function normalizeApiPrefix(value) {
  const text = toSafeString(value) || LIBRARY_API_PREFIX_DEFAULT;
  const normalized = text.startsWith("/") ? text : `/${text}`;
  return normalized.replace(/\/+$/, "");
}

async function syncLibraryRefinedJson() {
  const rows = await listRefinedEntries();
  await fs.mkdir(LIBRARY_DATA_DIR, { recursive: true });
  await fs.writeFile(
    LIBRARY_REFINED_JSON_PATH,
    JSON.stringify(rows, null, 2),
    "utf8",
  );
}

async function loadLibraryTypes() {
  await fs.mkdir(LIBRARY_DATA_DIR, { recursive: true });

  if (!fsSync.existsSync(LIBRARY_TYPES_JSON_PATH)) {
    const defaults = [
      { value: "music_theory", label: "音乐理论" },
      { value: "song_analysis", label: "歌曲分析" },
    ];
    await fs.writeFile(
      LIBRARY_TYPES_JSON_PATH,
      JSON.stringify(defaults, null, 2),
      "utf8",
    );
    return defaults;
  }

  try {
    const raw = await fs.readFile(LIBRARY_TYPES_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function splitContentUnits(content) {
  const text = toSafeString(content).replace(/\r\n/g, "\n").replace(/\t/g, " ");

  return text
    .split(/\n+|[。！？!?；;]+/)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length >= 6);
}

function inferLevel(text) {
  const source = toSafeLower(text);
  if (/(专辑|album|曲目编排|跨曲目)/.test(source)) {
    return "album";
  }
  if (/(单曲|single|整首|全曲)/.test(source)) {
    return "single";
  }
  if (/(段落|副歌|主歌|bridge|verse|chorus|segment)/.test(source)) {
    return "segment";
  }
  if (/(乐句|动机|riff|pattern|phrase)/.test(source)) {
    return "phrase";
  }
  if (/(音色|timbre|失真|混响|滤波|包络|音源|效果器)/.test(source)) {
    return "timbre";
  }
  return "single";
}

function inferCategory(text) {
  const source = toSafeLower(text);
  if (
    /(必须|应该|建议|规则|原则|策略|方法|禁止|technique|rule|principle|strategy)/.test(
      source,
    )
  ) {
    return "form";
  }
  return "material";
}

function toGist(text, maxLength = 20) {
  const normalized = toSafeString(text).replace(/\s+/g, "");
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? normalized.slice(0, maxLength)
    : normalized;
}

function analyzeEntry(entry) {
  const content = toSafeString(entry?.content);
  const title = toSafeString(entry?.title);
  const units = splitContentUnits(content);
  const uniqueSignatures = new Set();

  const nodeDrafts = [];
  for (const unit of units) {
    const draft = {
      content: unit,
      level: inferLevel(unit),
      category: inferCategory(unit),
    };
    const signature = `${draft.content}|${draft.level}|${draft.category}`;
    if (uniqueSignatures.has(signature)) {
      continue;
    }
    uniqueSignatures.add(signature);
    nodeDrafts.push(draft);
    if (nodeDrafts.length >= 8) {
      break;
    }
  }

  const recipeLevel = nodeDrafts[0]?.level || "single";
  const procedure = [
    "1. 阅读条目原文并识别核心知识点。",
    "2. 按层级与类别将知识点组合为可执行方案。",
    "3. 根据目标听感调整并复核可用性。",
  ].join("\n");

  const description = title
    ? `由条目《${title}》自动生成的知识配方。`
    : "由新增条目自动生成的知识配方。";

  const gists = nodeDrafts.slice(0, 3).map((draft) => toGist(draft.content));

  return {
    nodeDrafts,
    recipeDraft: {
      level: recipeLevel,
      procedure,
      description,
    },
    gists: gists.filter(Boolean),
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Request failed: ${response.status}`);
  }
  return response.json();
}

function buildNodeSignature(node) {
  return `${node.content}|${node.level}|${node.category}`;
}

app.get("/library-api/types", async (req, res) => {
  try {
    const types = await loadLibraryTypes();
    res.json(types);
  } catch (error) {
    res.status(500).json({ error: "Failed to load types." });
  }
});

app.get("/library-api/entries", async (req, res) => {
  try {
    const { q, tag, type, limit, offset } = req.query || {};
    const rows = await listEntries({
      q: q ? String(q) : "",
      tag: tag ? String(tag) : "",
      type: type ? String(type) : "",
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to list entries." });
  }
});

app.post("/library-api/entries", async (req, res) => {
  const { title, content, source, type } = req.body || {};
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "Content is required." });
  }

  try {
    const id = await insertEntry({
      title: title || "",
      content,
      source: source || "",
      type: type || "note",
    });
    res.status(201).json({ id });
  } catch (error) {
    res.status(500).json({ error: "Failed to create entry." });
  }
});

app.get("/library-api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }

  try {
    const entry = await getEntryById(id);
    if (!entry) {
      return res.status(404).json({ error: "Not found." });
    }

    const cleaned = await getCleanedEntryById(id);
    const payload =
      cleaned && typeof cleaned.content === "string"
        ? { ...entry, content: cleaned.content }
        : entry;

    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: "Failed to load entry." });
  }
});

app.put("/library-api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }

  const { title, content, source, type } = req.body || {};
  if (content !== undefined && typeof content !== "string") {
    return res.status(400).json({ error: "Content must be a string." });
  }

  try {
    const updated = await updateEntryById(id, { title, content, source, type });
    if (!updated) {
      return res.status(404).json({ error: "Not found." });
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: "Failed to update entry." });
  }
});

app.delete("/library-api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }

  try {
    await deleteEntryById(id);
    await syncLibraryRefinedJson();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete entry." });
  }
});

app.delete("/library-api/agent/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }

  try {
    await deleteEntryById(id);
    await syncLibraryRefinedJson();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete entry." });
  }
});

app.get("/library-api/agent/entries/:id/clean", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }

  try {
    const cleaned = await getCleanedEntryById(id);
    if (!cleaned) {
      return res.status(404).json({ error: "Not found." });
    }
    res.json(cleaned);
  } catch (error) {
    res.status(500).json({ error: "Failed to load cleaned entry." });
  }
});

app.get("/library-api/agent/entries/modified", async (req, res) => {
  try {
    const rows = await listModifiedEntries();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to list modified entries." });
  }
});

app.get("/library-api/agent/entries/new", async (req, res) => {
  try {
    const rows = await listNewEntries();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to list new entries." });
  }
});

app.post("/library-api/agent/refined", async (req, res) => {
  const { entryId, type, title, data } = req.body || {};
  const id = Number(entryId);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid entryId." });
  }

  try {
    const entry = await getEntryById(id);
    if (!entry) {
      return res.status(404).json({ error: "Not found." });
    }

    let parsedData = data;
    if (typeof data === "string") {
      try {
        parsedData = JSON.parse(data);
      } catch (error) {
        return res.status(400).json({ error: "Invalid data JSON." });
      }
    }

    const dataJson = JSON.stringify(parsedData || {});
    await upsertRefinedEntry({
      entryId: id,
      type: type || entry.type || "note",
      title: title || entry.title || "",
      hash: entry.hash || "",
      dataJson,
    });

    await syncLibraryRefinedJson();
    res.status(201).json({ entry_id: id });
  } catch (error) {
    res.status(500).json({ error: "Failed to save refined entry." });
  }
});

app.get("/library-api/agent/refined", async (req, res) => {
  try {
    const rows = await listRefinedEntries();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to list refined entries." });
  }
});

app.get("/library-api/agent/refined/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }

  try {
    const refined = await getRefinedEntryById(id);
    if (!refined) {
      return res.status(404).json({ error: "Not found." });
    }
    res.json(refined);
  } catch (error) {
    res.status(500).json({ error: "Failed to load refined entry." });
  }
});

app.delete("/library-api/agent/refined/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Invalid id." });
  }

  try {
    await deleteRefinedEntryById(id);
    await syncLibraryRefinedJson();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: "Failed to delete refined entry." });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Music KB API is running" });
});

app.get("/api/nodes", async (req, res) => {
  try {
    const level = normalizeLevel(req.query.level);
    const keyword = toSafeLower(req.query.q);

    const list = await readNodeList();
    const filtered = list.filter((node) =>
      nodeMatchesFilters(node, { level, keyword }),
    );

    res.json(filtered);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch nodes" });
  }
});

app.get("/api/nodes/:id", async (req, res) => {
  try {
    const id = parseParamId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ message: "id must be a non-negative integer" });
    }

    const list = await readNodeList();
    const item = list.find((entry) => entry.id === id);

    if (!item) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch node" });
  }
});

app.get("/api/nodes/:id/relative", async (req, res) => {
  try {
    const id = parseParamId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ message: "id must be a non-negative integer" });
    }

    const targetLevel = normalizeLevel(req.query.level);
    if (!targetLevel) {
      return res.status(400).json({
        message:
          "query level is required and must be one of album/single/segment/phrase/timbre",
      });
    }

    const list = await readNodeList();
    const item = list.find((entry) => entry.id === id);

    if (!item) {
      return res.status(404).json({ message: "Record not found" });
    }

    const relativeCategory = getRelativeCategory(item, targetLevel);
    if (!relativeCategory) {
      return res.status(400).json({
        message: `node ${id} is not usable in level ${targetLevel}`,
      });
    }

    res.json({
      id: item.id,
      content: item.content,
      sourceLevel: item.level,
      sourceCategory: item.category,
      targetLevel,
      relativeCategory,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch relative node" });
  }
});

app.post("/api/nodes", async (req, res) => {
  try {
    const normalized = normalizeNode(req.body);
    if (!normalized.content || !normalized.level || !normalized.category) {
      return res.status(400).json({
        message:
          "content, level, category are required; category must be form or material",
      });
    }

    const list = await readNodeList();

    const record = {
      id: nextId(list),
      ...normalized,
    };

    list.unshift(record);
    await writeNodeList(list);

    res.status(201).json(record);
  } catch (error) {
    res.status(500).json({ message: "Failed to create node" });
  }
});

app.patch("/api/nodes/:id", async (req, res) => {
  try {
    const id = parseParamId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ message: "id must be a non-negative integer" });
    }

    const list = await readNodeList();
    const index = list.findIndex((node) => node.id === id);
    if (index === -1) {
      return res.status(404).json({ message: "Record not found" });
    }

    const normalized = normalizeNode({
      content: req.body.content ?? list[index].content,
      level: req.body.level ?? list[index].level,
      category: req.body.category ?? list[index].category,
    });

    if (!normalized.content || !normalized.level || !normalized.category) {
      return res.status(400).json({
        message:
          "content, level, category are required; category must be form or material",
      });
    }

    const updated = {
      ...normalized,
      id: list[index].id,
    };

    list[index] = updated;
    await writeNodeList(list);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Failed to update node" });
  }
});

app.delete("/api/nodes/:id", async (req, res) => {
  try {
    const id = parseParamId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ message: "id must be a non-negative integer" });
    }

    const list = await readNodeList();
    const targetId = id;

    if (!list.some((entry) => entry.id === targetId)) {
      return res.status(404).json({ message: "Record not found" });
    }

    const next = list.filter((entry) => entry.id !== targetId);
    await writeNodeList(next);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: "Failed to delete node" });
  }
});

app.get("/api/recipes", async (req, res) => {
  try {
    const level = normalizeLevel(req.query.level);
    const keyword = toSafeLower(req.query.q);

    const list = await readRecipeList();
    const filtered = list.filter((recipe) =>
      recipeMatchesFilters(recipe, { level, keyword }),
    );
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch recipes" });
  }
});

app.get("/api/recipes/:id", async (req, res) => {
  try {
    const id = parseParamId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ message: "id must be a non-negative integer" });
    }

    const list = await readRecipeList();
    const item = list.find((entry) => entry.id === id);

    if (!item) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch recipe" });
  }
});

app.post("/api/recipes", async (req, res) => {
  try {
    const nodes = await readNodeList();
    const normalized = normalizeRecipe(req.body);
    if (
      !normalized.knowledgePoints.length ||
      !normalized.procedure ||
      !normalized.level ||
      !normalized.description
    ) {
      return res.status(400).json({
        message:
          "knowledgePoints[], procedure, level, description are required",
      });
    }

    if (!areValidKnowledgeIds(normalized.knowledgePoints, nodes)) {
      return res
        .status(400)
        .json({ message: "knowledgePoints must be existing node ids" });
    }

    const unavailableIds = findUnavailableKnowledgeIds(
      normalized.knowledgePoints,
      nodes,
      normalized.level,
    );
    if (unavailableIds.length > 0) {
      return res.status(400).json({
        message: `knowledgePoints not usable in level ${normalized.level}: ${unavailableIds.join(",")}`,
      });
    }

    const list = await readRecipeList();
    const record = {
      id: nextId(list),
      ...normalized,
    };

    list.unshift(record);
    await writeRecipeList(list);
    res.status(201).json(record);
  } catch (error) {
    res.status(500).json({ message: "Failed to create recipe" });
  }
});

app.patch("/api/recipes/:id", async (req, res) => {
  try {
    const id = parseParamId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ message: "id must be a non-negative integer" });
    }

    const nodes = await readNodeList();
    const list = await readRecipeList();
    const index = list.findIndex((recipe) => recipe.id === id);
    if (index === -1) {
      return res.status(404).json({ message: "Record not found" });
    }

    const normalized = normalizeRecipe({
      knowledgePoints: req.body.knowledgePoints ?? list[index].knowledgePoints,
      procedure: req.body.procedure ?? list[index].procedure,
      level: req.body.level ?? list[index].level,
      description: req.body.description ?? list[index].description,
    });

    if (
      !normalized.knowledgePoints.length ||
      !normalized.procedure ||
      !normalized.level ||
      !normalized.description
    ) {
      return res.status(400).json({
        message:
          "knowledgePoints[], procedure, level, description are required",
      });
    }

    if (!areValidKnowledgeIds(normalized.knowledgePoints, nodes)) {
      return res
        .status(400)
        .json({ message: "knowledgePoints must be existing node ids" });
    }

    const unavailableIds = findUnavailableKnowledgeIds(
      normalized.knowledgePoints,
      nodes,
      normalized.level,
    );
    if (unavailableIds.length > 0) {
      return res.status(400).json({
        message: `knowledgePoints not usable in level ${normalized.level}: ${unavailableIds.join(",")}`,
      });
    }

    const updated = {
      id: list[index].id,
      ...normalized,
    };

    list[index] = updated;
    await writeRecipeList(list);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Failed to update recipe" });
  }
});

app.delete("/api/recipes/:id", async (req, res) => {
  try {
    const id = parseParamId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ message: "id must be a non-negative integer" });
    }

    const list = await readRecipeList();
    const targetId = id;

    if (!list.some((entry) => entry.id === targetId)) {
      return res.status(404).json({ message: "Record not found" });
    }

    const next = list.filter((entry) => entry.id !== targetId);
    await writeRecipeList(next);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: "Failed to delete recipe" });
  }
});

initLibraryDb()
  .then(async () => {
    await syncLibraryRefinedJson();
    app.listen(PORT, () => {
      console.log(`Music knowledge API running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize unified backend", error);
    process.exit(1);
  });
