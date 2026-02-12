import { useEffect, useMemo, useState } from "react";

const LEVELS = [
  { value: "album", label: "专辑" },
  { value: "single", label: "单曲" },
  { value: "segment", label: "曲段" },
  { value: "phrase", label: "曲句" },
  { value: "timbre", label: "音色" },
];

const LEVEL_ORDER = LEVELS.map((item) => item.value);

const CATEGORIES = [
  { value: "form", label: "形式" },
  { value: "material", label: "质料" },
];

const initialForm = {
  content: "",
  level: "single",
  category: "form",
};

const initialRecipeForm = {
  knowledgePointsInput: "",
  procedure: "",
  level: "single",
  description: "",
};

const initialLibraryForm = {
  title: "",
  content: "",
  source: "",
  type: "",
};

function sanitizeEntryHtml(value) {
  const doc = new DOMParser().parseFromString(String(value || ""), "text/html");
  const allowedTags = new Set([
    "b",
    "strong",
    "i",
    "em",
    "u",
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "a",
  ]);
  const allowedAttrs = {
    a: ["href", "title", "target", "rel"],
  };

  const sanitizeNode = (node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = node.tagName.toLowerCase();
      if (!allowedTags.has(tag)) {
        const text = doc.createTextNode(node.textContent || "");
        node.replaceWith(text);
        return;
      }

      const allowed = allowedAttrs[tag] || [];
      [...node.attributes].forEach((attr) => {
        if (!allowed.includes(attr.name)) {
          node.removeAttribute(attr.name);
        }
      });

      if (tag === "a") {
        const href = node.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) {
          node.removeAttribute("href");
        }
        node.setAttribute("rel", "noopener noreferrer");
        node.setAttribute("target", "_blank");
      }

      [...node.childNodes].forEach(sanitizeNode);
      return;
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
    }
  };

  [...doc.body.childNodes].forEach(sanitizeNode);
  return doc.body.innerHTML.trim();
}

function CollapsibleCard({ title, subtitle, children }) {
  return (
    <section className="card">
      <details className="collapse">
        <summary>
          <span className="collapse-title">{title}</span>
          {subtitle ? (
            <span className="collapse-subtitle">{subtitle}</span>
          ) : null}
        </summary>
        <div className="collapse-content">{children}</div>
      </details>
    </section>
  );
}

function App() {
  const [items, setItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submittingRecipe, setSubmittingRecipe] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [recipeForm, setRecipeForm] = useState(initialRecipeForm);
  const [error, setError] = useState("");
  const [recipeError, setRecipeError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [recipeKeyword, setRecipeKeyword] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [recipeLevelFilter, setRecipeLevelFilter] = useState("all");
  const [libraryTypes, setLibraryTypes] = useState([]);
  const [libraryEntries, setLibraryEntries] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [librarySubmitting, setLibrarySubmitting] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [libraryKeyword, setLibraryKeyword] = useState("");
  const [libraryForm, setLibraryForm] = useState(initialLibraryForm);

  const knowledgeValidation = useMemo(() => {
    const raw = recipeForm.knowledgePointsInput || "";
    const tokens = raw
      .split(/[\s,，、]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    const parsed = [];
    const invalidTokens = [];

    for (const token of tokens) {
      if (!/^\d+$/.test(token)) {
        invalidTokens.push(token);
        continue;
      }
      parsed.push(Number(token));
    }

    const uniqueIds = [...new Set(parsed)];
    const knownIds = new Set(items.map((item) => item.id));
    const nodeById = new Map(items.map((item) => [item.id, item]));
    const missingIds = uniqueIds.filter((id) => !knownIds.has(id));

    const unavailableIds = uniqueIds.filter((id) => {
      const node = nodeById.get(id);
      if (!node) {
        return false;
      }

      const levelIndex = LEVEL_ORDER.indexOf(node.level);
      if (levelIndex === -1) {
        return true;
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

      return !usableLevels.has(recipeForm.level);
    });

    return {
      ids: uniqueIds,
      invalidTokens,
      missingIds,
      unavailableIds,
      hasInput: raw.trim().length > 0,
    };
  }, [items, recipeForm.knowledgePointsInput, recipeForm.level]);

  async function fetchNodes() {
    setError("");
    try {
      const response = await fetch("/api/nodes");
      if (!response.ok) {
        throw new Error("加载失败");
      }
      const data = await response.json();
      setItems(data);
    } catch (fetchError) {
      setError(fetchError.message || "网络错误");
    }
  }

  async function fetchRecipes() {
    setRecipeError("");
    try {
      const response = await fetch("/api/recipes");
      if (!response.ok) {
        throw new Error("加载配方失败");
      }
      const data = await response.json();
      setRecipes(data);
    } catch (fetchError) {
      setRecipeError(fetchError.message || "网络错误");
    }
  }

  async function fetchLibraryTypes() {
    try {
      const response = await fetch("/library-api/types");
      if (!response.ok) {
        throw new Error("加载类型失败");
      }
      const data = await response.json();
      const list = Array.isArray(data)
        ? data.filter((item) => item?.value)
        : [];
      setLibraryTypes(list);
      if (list.length > 0) {
        setLibraryForm((current) => ({
          ...current,
          type: current.type || list[0].value,
        }));
      }
    } catch (fetchError) {
      setLibraryError(fetchError.message || "网络错误");
    }
  }

  async function fetchLibraryEntries() {
    try {
      const response = await fetch("/library-api/entries");
      if (!response.ok) {
        throw new Error("加载文档失败");
      }
      const data = await response.json();
      setLibraryEntries(Array.isArray(data) ? data : []);
    } catch (fetchError) {
      setLibraryError(fetchError.message || "网络错误");
    }
  }

  useEffect(() => {
    async function bootstrap() {
      setLoading(true);
      await Promise.all([fetchNodes(), fetchRecipes()]);
      setLoading(false);
    }
    bootstrap();
  }, []);

  useEffect(() => {
    async function bootstrapLibrary() {
      setLibraryLoading(true);
      setLibraryError("");
      await Promise.all([fetchLibraryTypes(), fetchLibraryEntries()]);
      setLibraryLoading(false);
    }
    bootstrapLibrary();
  }, []);

  const visibleItems = useMemo(() => {
    return items.filter((item) => {
      const matchLevel =
        levelFilter === "all" ? true : item.level === levelFilter;

      const text = `${item.content}`.toLowerCase();
      const matchKeyword = keyword.trim()
        ? text.includes(keyword.trim().toLowerCase())
        : true;
      return matchLevel && matchKeyword;
    });
  }, [items, keyword, levelFilter]);

  const visibleRecipes = useMemo(() => {
    return recipes.filter((recipe) => {
      const matchLevel =
        recipeLevelFilter === "all" ? true : recipe.level === recipeLevelFilter;
      const text =
        `${recipe.description} ${recipe.procedure} ${(recipe.knowledgePoints || []).join(" ")}`.toLowerCase();
      const matchKeyword = recipeKeyword.trim()
        ? text.includes(recipeKeyword.trim().toLowerCase())
        : true;
      return matchLevel && matchKeyword;
    });
  }, [recipeKeyword, recipeLevelFilter, recipes]);

  const visibleLibraryEntries = useMemo(() => {
    const q = libraryKeyword.trim().toLowerCase();
    return libraryEntries.filter((entry) => {
      if (!q) {
        return true;
      }
      const text =
        `${entry.title || ""} ${entry.content || ""} ${entry.type || ""}`.toLowerCase();
      return text.includes(q);
    });
  }, [libraryEntries, libraryKeyword]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function updateRecipeField(event) {
    const { name, value } = event.target;
    setRecipeForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  function updateLibraryField(event) {
    const { name, value } = event.target;
    setLibraryForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function submitForm(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/nodes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: form.content,
          level: form.level,
          category: form.category,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "提交失败");
      }

      const created = await response.json();
      setItems((current) => [created, ...current]);
      setForm(initialForm);
    } catch (submitError) {
      setError(submitError.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteItem(id) {
    setError("");
    try {
      const response = await fetch(`/api/nodes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "删除失败");
      }
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (deleteError) {
      setError(deleteError.message || "删除失败");
    }
  }

  async function submitRecipeForm(event) {
    event.preventDefault();
    if (!knowledgeValidation.hasInput || knowledgeValidation.ids.length === 0) {
      setRecipeError("请至少填写一个知识点ID");
      return;
    }
    if (knowledgeValidation.invalidTokens.length > 0) {
      setRecipeError(
        `包含非法ID（仅支持非负整数）：${knowledgeValidation.invalidTokens.join("、")}`,
      );
      return;
    }
    if (knowledgeValidation.missingIds.length > 0) {
      setRecipeError(
        `以下ID不存在：${knowledgeValidation.missingIds.join("、")}`,
      );
      return;
    }
    if (knowledgeValidation.unavailableIds.length > 0) {
      setRecipeError(
        `以下ID在当前层级不可用：${knowledgeValidation.unavailableIds.join("、")}`,
      );
      return;
    }

    setSubmittingRecipe(true);
    setRecipeError("");

    try {
      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          knowledgePoints: knowledgeValidation.ids,
          procedure: recipeForm.procedure,
          level: recipeForm.level,
          description: recipeForm.description,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || "提交配方失败");
      }

      const created = await response.json();
      setRecipes((current) => [created, ...current]);
      setRecipeForm(initialRecipeForm);
    } catch (submitError) {
      setRecipeError(submitError.message || "提交配方失败");
    } finally {
      setSubmittingRecipe(false);
    }
  }

  async function deleteRecipe(id) {
    setRecipeError("");
    try {
      const response = await fetch(`/api/recipes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.message || "删除配方失败");
      }
      setRecipes((current) => current.filter((recipe) => recipe.id !== id));
    } catch (deleteError) {
      setRecipeError(deleteError.message || "删除配方失败");
    }
  }

  async function submitLibraryForm(event) {
    event.preventDefault();
    setLibrarySubmitting(true);
    setLibraryError("");

    try {
      const response = await fetch("/library-api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: libraryForm.title,
          content: libraryForm.content,
          source: libraryForm.source,
          type: libraryForm.type || libraryTypes[0]?.value || "note",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "提交文档失败");
      }

      setLibraryForm((current) => ({
        ...initialLibraryForm,
        type: current.type || libraryTypes[0]?.value || "",
      }));
      await fetchLibraryEntries();
    } catch (submitError) {
      setLibraryError(submitError.message || "提交文档失败");
    } finally {
      setLibrarySubmitting(false);
    }
  }

  async function deleteLibraryEntry(id) {
    setLibraryError("");
    try {
      const response = await fetch(`/library-api/entries/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "删除文档失败");
      }
      setLibraryEntries((current) =>
        current.filter((entry) => entry.id !== id),
      );
    } catch (deleteError) {
      setLibraryError(deleteError.message || "删除文档失败");
    }
  }

  return (
    <main className="container">
      <CollapsibleCard
        title="知识节点录入"
        subtitle="内容、层次、类别（形式/质料）"
      >
        <form className="form-grid" onSubmit={submitForm}>
          <select name="level" value={form.level} onChange={updateField}>
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>

          <select name="category" value={form.category} onChange={updateField}>
            {CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </select>

          <textarea
            name="content"
            value={form.content}
            onChange={updateField}
            placeholder="内容"
            rows={3}
            required
          />
          <button type="submit" disabled={submitting}>
            {submitting ? "提交中..." : "新增条目"}
          </button>
        </form>
      </CollapsibleCard>

      <CollapsibleCard
        title="文档录入（Library）"
        subtitle="同端口访问，代理调用 Library API"
      >
        <form className="form-grid" onSubmit={submitLibraryForm}>
          <input
            name="title"
            value={libraryForm.title}
            onChange={updateLibraryField}
            placeholder="标题（可选）"
          />

          <select
            name="type"
            value={libraryForm.type}
            onChange={updateLibraryField}
          >
            {libraryTypes.length === 0 ? (
              <option value="">暂无类型</option>
            ) : (
              libraryTypes.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label || type.value}
                </option>
              ))
            )}
          </select>

          <input
            name="source"
            value={libraryForm.source}
            onChange={updateLibraryField}
            placeholder="来源（可选）"
          />

          <textarea
            name="content"
            value={libraryForm.content}
            onChange={updateLibraryField}
            placeholder="输入文档原文"
            rows={5}
            required
          />

          <button
            type="submit"
            disabled={librarySubmitting || libraryTypes.length === 0}
          >
            {librarySubmitting ? "提交中..." : "新增文档"}
          </button>
        </form>
      </CollapsibleCard>

      <CollapsibleCard
        title="文档列表（Library）"
        subtitle={`共 ${visibleLibraryEntries.length} 条`}
      >
        <div className="toolbar">
          <input
            placeholder="搜索文档（标题/内容/类型）"
            value={libraryKeyword}
            onChange={(event) => setLibraryKeyword(event.target.value)}
          />
          <button type="button" onClick={fetchLibraryEntries}>
            刷新文档
          </button>
        </div>

        {libraryError ? <p className="error">{libraryError}</p> : null}
        {libraryLoading ? <p>加载中...</p> : null}
        {!libraryLoading && visibleLibraryEntries.length === 0 ? (
          <p>暂无文档</p>
        ) : null}

        <ul className="list">
          {visibleLibraryEntries.map((entry) => (
            <li key={entry.id} className="list-item">
              <div>
                <h3>{entry.id}</h3>
                <p>类型：{entry.type || "未分类"}</p>
                <p className="muted">标题：{entry.title || "未命名"}</p>
                <details className="entry-preview">
                  <summary className="muted">查看条目预览</summary>
                  <div
                    className="html-preview"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeEntryHtml(entry.content || ""),
                    }}
                  />
                </details>
              </div>
              <button
                type="button"
                className="danger"
                onClick={() => deleteLibraryEntry(entry.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleCard>

      <CollapsibleCard
        title="配方录入"
        subtitle="知识点列表、实施过程、层次、描述"
      >
        <form className="form-grid" onSubmit={submitRecipeForm}>
          <div>
            <p className="muted">知识点ID（手动填写，空格/逗号分隔）</p>
            <input
              name="knowledgePointsInput"
              value={recipeForm.knowledgePointsInput}
              onChange={updateRecipeField}
              placeholder="例如：2, 3 4"
              required
            />
            {knowledgeValidation.hasInput &&
            knowledgeValidation.invalidTokens.length === 0 &&
            knowledgeValidation.missingIds.length === 0 ? (
              <p className="muted">
                已识别有效ID：{knowledgeValidation.ids.join("、")}
              </p>
            ) : null}
            {knowledgeValidation.invalidTokens.length > 0 ? (
              <p className="error">
                非法ID：{knowledgeValidation.invalidTokens.join("、")}
                （仅支持非负整数）
              </p>
            ) : null}
            {knowledgeValidation.missingIds.length > 0 ? (
              <p className="error">
                不存在的ID：{knowledgeValidation.missingIds.join("、")}
              </p>
            ) : null}
            {knowledgeValidation.unavailableIds.length > 0 ? (
              <p className="error">
                当前层级不可用ID：
                {knowledgeValidation.unavailableIds.join("、")}
              </p>
            ) : null}
          </div>

          <textarea
            name="procedure"
            value={recipeForm.procedure}
            onChange={updateRecipeField}
            placeholder="实施过程"
            rows={4}
            required
          />

          <select
            name="level"
            value={recipeForm.level}
            onChange={updateRecipeField}
          >
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>

          <textarea
            name="description"
            value={recipeForm.description}
            onChange={updateRecipeField}
            placeholder="描述"
            rows={3}
            required
          />

          <button type="submit" disabled={submittingRecipe}>
            {submittingRecipe ? "提交中..." : "新增配方"}
          </button>
        </form>
      </CollapsibleCard>

      <CollapsibleCard
        title="知识节点列表"
        subtitle={`共 ${visibleItems.length} 条`}
      >
        <div className="toolbar">
          <input
            placeholder="搜索内容"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <select
            value={levelFilter}
            onChange={(event) => setLevelFilter(event.target.value)}
          >
            <option value="all">全部层次</option>
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {loading ? <p>加载中...</p> : null}

        {!loading && visibleItems.length === 0 ? <p>暂无匹配内容</p> : null}

        <ul className="list">
          {visibleItems.map((item) => (
            <li key={item.id} className="list-item">
              <div>
                <h3>{item.id}</h3>
                <p>层次：{item.level}</p>
                <p>类别：{item.category === "material" ? "质料" : "形式"}</p>
                <p className="muted">{item.content}</p>
              </div>
              <button
                type="button"
                className="danger"
                onClick={() => deleteItem(item.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleCard>

      <CollapsibleCard
        title="配方列表"
        subtitle={`共 ${visibleRecipes.length} 条`}
      >
        <div className="toolbar">
          <input
            placeholder="搜索配方（描述/过程/知识点）"
            value={recipeKeyword}
            onChange={(event) => setRecipeKeyword(event.target.value)}
          />
          <select
            value={recipeLevelFilter}
            onChange={(event) => setRecipeLevelFilter(event.target.value)}
          >
            <option value="all">全部层次</option>
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>

        {recipeError ? <p className="error">{recipeError}</p> : null}
        {loading ? <p>加载中...</p> : null}
        {!loading && visibleRecipes.length === 0 ? <p>暂无配方内容</p> : null}

        <ul className="list">
          {visibleRecipes.map((recipe) => (
            <li key={recipe.id} className="list-item">
              <div>
                <h3>{recipe.id}</h3>
                <p>层次：{recipe.level}</p>
                <p className="muted">描述：{recipe.description}</p>
                <p className="muted">
                  知识点ID：{(recipe.knowledgePoints || []).join("、")}
                </p>
                <p className="muted">实施过程：{recipe.procedure}</p>
              </div>
              <button
                type="button"
                className="danger"
                onClick={() => deleteRecipe(recipe.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </CollapsibleCard>
    </main>
  );
}

export default App;
