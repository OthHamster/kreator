# 音乐知识库（前后端）

这是一个最小可运行的音乐知识库网站应用：

- 前端：React + Vite
- 后端：Express
- 数据存储：本地 JSON 文件（`backend/data/music.json`）

## 数据结构

系统维护“知识节点（node）”，每条记录包含：

- `id`：编号（从 `0` 开始的数字）
- `content`：内容
- `level`：层次（`album`/`single`/`segment`/`phrase`/`timbre`）
- `category`：类别（`form`=形式 或 `material`=质料）

系统同时支持“配方（recipe）”条目，每条记录包含：

- `id`：编号（从 `0` 开始的数字）
- `knowledgePoints`：知识点列表（存储知识 `id` 的数组）
- `procedure`：实施过程
- `level`：层次（同上）
- `description`：描述

数据文件：`backend/data/music.json`（实际存储为 `nodes` 与 `recipes` 两个数组）。

## 功能

- 查看节点列表
- 关键词搜索（内容）
- 层次筛选（专辑/单曲/曲段/曲句/音色）
- 新增节点
- 删除节点
- 新增配方（知识点列表、实施过程、层次、描述）
- 查看/搜索/删除配方

## 启动方式

### 一键启动（推荐）

在根目录执行：

```bash
npm install
npm run dev
```

会同时启动：

- 后端：`http://localhost:4000`
- 前端：`http://localhost:5173`

> 已配置固定端口，并会在启动前自动停止占用端口的旧进程。
>
> 说明：后端已整合 Library API，文档录入与知识库共用同一个后端端口（`4000`）。
>
> 若部署环境缺少 `Library/db.js`（或历史 `Kreator/db.js`），后端会自动切换到 `backend/data/library-fallback` 本地存储模式，确保服务可启动。

### 1) 启动后端（端口 4000）

```bash
cd backend
npm install
npm run dev
```

### 2) 启动前端（端口 5173）

```bash
cd frontend
npm install
npm run dev
```

访问：`http://localhost:5173`

> 前端已配置代理：
>
> - `/api` -> `http://localhost:4000`
> - `/library-api` -> `http://localhost:4000/library-api`

## API 参数与返回

基础地址：`http://localhost:4000`

### 1) 健康检查

#### `GET /api/health`

- 请求参数：无
- 成功返回：`200`

```json
{
  "ok": true,
  "message": "Music KB API is running"
}
```

### 2) 知识节点（nodes）

#### `GET /api/nodes`

- Query 参数（可选）
  - `level`: `album | single | segment | phrase | timbre`
  - `q`: 关键词（按 `content` 模糊匹配）
- 成功返回：`200`，数组

```json
[
  {
    "id": 2,
    "content": "专辑：Kind of Blue",
    "level": "album",
    "category": "form"
  }
]
```

#### `GET /api/nodes/:id`

- Path 参数
  - `id`: 非负整数
- 成功返回：`200`

```json
{
  "id": 2,
  "content": "专辑：Kind of Blue",
  "level": "album",
  "category": "form"
}
```

- 常见错误
  - `400`: `{ "message": "id must be a non-negative integer" }`
  - `404`: `{ "message": "Record not found" }`

#### `GET /api/nodes/:id/relative?level=<targetLevel>`

- 用途：获取某个知识在“目标层级”下的可用类型（`form` 或 `material`）
- Path 参数
  - `id`: 非负整数
- Query 参数（必填）
  - `level`: `album | single | segment | phrase | timbre`
- 成功返回：`200`

```json
{
  "id": 2,
  "content": "专辑：Kind of Blue",
  "sourceLevel": "album",
  "sourceCategory": "form",
  "targetLevel": "album",
  "relativeCategory": "form"
}
```

- 常见错误
  - `400`: `{ "message": "id must be a non-negative integer" }`
  - `400`: `{ "message": "query level is required and must be one of album/single/segment/phrase/timbre" }`
  - `400`: `{ "message": "node <id> is not usable in level <level>" }`
  - `404`: `{ "message": "Record not found" }`

#### `POST /api/nodes`

- Body 参数（必填）
  - `content: string`
  - `level: album | single | segment | phrase | timbre`
  - `category: form | material`
- 成功返回：`201`（返回创建后的对象）

```json
{
  "id": 7,
  "content": "新的知识点",
  "level": "single",
  "category": "material"
}
```

- 常见错误
  - `400`: `{ "message": "content, level, category are required; category must be form or material" }`

#### `PATCH /api/nodes/:id`

- Path 参数
  - `id`: 非负整数
- Body 参数（可选，至少提供一个）
  - `content?: string`
  - `level?: album | single | segment | phrase | timbre`
  - `category?: form | material`
- 成功返回：`200`（返回更新后的对象）

```json
{
  "id": 7,
  "content": "更新后的知识点",
  "level": "segment",
  "category": "form"
}
```

- 常见错误
  - `400`: `{ "message": "id must be a non-negative integer" }`
  - `400`: `{ "message": "content, level, category are required; category must be form or material" }`
  - `404`: `{ "message": "Record not found" }`

#### `DELETE /api/nodes/:id`

- Path 参数
  - `id`: 非负整数
- 成功返回：`204`（无 body）
- 常见错误
  - `400`: `{ "message": "id must be a non-negative integer" }`
  - `404`: `{ "message": "Record not found" }`

### 3) 配方（recipes）

#### `GET /api/recipes`

- Query 参数（可选）
  - `level`: `album | single | segment | phrase | timbre`
  - `q`: 关键词（按 `description/procedure/knowledgePoints` 模糊匹配）
- 成功返回：`200`，数组

```json
[
  {
    "id": 0,
    "knowledgePoints": [2, 3, 4],
    "procedure": "先确定调式与速度...",
    "level": "single",
    "description": "用于生成一段具有爵士感的单曲编配流程。"
  }
]
```

#### `GET /api/recipes/:id`

- Path 参数
  - `id`: 非负整数
- 成功返回：`200`

```json
{
  "id": 0,
  "knowledgePoints": [2, 3, 4],
  "procedure": "先确定调式与速度...",
  "level": "single",
  "description": "用于生成一段具有爵士感的单曲编配流程。"
}
```

- 常见错误
  - `400`: `{ "message": "id must be a non-negative integer" }`
  - `404`: `{ "message": "Record not found" }`

#### `POST /api/recipes`

- Body 参数（必填）
  - `knowledgePoints: number[]`（知识节点 ID 数组）
  - `procedure: string`
  - `level: album | single | segment | phrase | timbre`
  - `description: string`
- 成功返回：`201`（返回创建后的对象）

```json
{
  "id": 1,
  "knowledgePoints": [2, 3],
  "procedure": "按步骤执行...",
  "level": "single",
  "description": "示例配方"
}
```

- 常见错误
  - `400`: `{ "message": "knowledgePoints[], procedure, level, description are required" }`
  - `400`: `{ "message": "knowledgePoints must be existing node ids" }`
  - `400`: `{ "message": "knowledgePoints not usable in level <level>: <ids>" }`

#### `PATCH /api/recipes/:id`

- Path 参数
  - `id`: 非负整数
- Body 参数（可选，未传字段沿用旧值）
  - `knowledgePoints?: number[]`
  - `procedure?: string`
  - `level?: album | single | segment | phrase | timbre`
  - `description?: string`
- 成功返回：`200`（返回更新后的对象）

```json
{
  "id": 1,
  "knowledgePoints": [2, 4],
  "procedure": "更新后的步骤...",
  "level": "segment",
  "description": "更新后的配方"
}
```

- 常见错误
  - `400`: `{ "message": "id must be a non-negative integer" }`
  - `400`: `{ "message": "knowledgePoints[], procedure, level, description are required" }`
  - `400`: `{ "message": "knowledgePoints must be existing node ids" }`
  - `400`: `{ "message": "knowledgePoints not usable in level <level>: <ids>" }`
  - `404`: `{ "message": "Record not found" }`

#### `DELETE /api/recipes/:id`

- Path 参数
  - `id`: 非负整数
- 成功返回：`204`（无 body）
- 常见错误
  - `400`: `{ "message": "id must be a non-negative integer" }`
  - `404`: `{ "message": "Record not found" }`

## 目录结构

```text
music/
  backend/
    src/server.js
    data/music.json
  frontend/
    src/App.jsx
    src/index.css
```
