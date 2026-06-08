# ReTale Knowledge Graph Design

本文档记录 ReTale 当前知识图谱系统的设计、技术栈、边界和实现约束。文档以当前仓库已经落地的 HanLP bootstrap、SQLite 权威知识库、LanceDB retrieval index、Graph-aware RAG、Next.js API 和 Workspace UX 为准。

## 0. 设计目标

ReTale 的知识图谱不是一个独立数据库产品，而是小说改写工作流里的本地上下文系统。它要解决三件事：

1. 离线把百万字小说变成可查询的结构化世界状态。
2. 在线根据当前章节和选中文本快速组装不剧透的写作上下文。
3. 让用户能看到、理解、校正本次生成用到的图谱知识和证据。

核心体验原则：

- 离线构建可以慢，在线生成必须快。
- SQLite 是 source of truth，LanceDB 是可重建索引。
- 图谱上下文必须按章节过滤，扩写第 N 章时只能使用 `chapter_no <= N` 的知识。
- 本地知识库构建禁止依赖 API 批量建库；API 模型只用于最终文本生成和当前实现中明确配置的抽取/摘要路径。
- 用户确认、拒绝、编辑、缓存删除、任务状态都以 SQLite 持久状态为准。
- Graph-aware RAG 由项目内 TypeScript/SQLite 检索层实现，不引入 Neo4j、NebulaGraph、Microsoft GraphRAG 或完整 LlamaIndex GraphRAG pipeline。

## 1. 技术栈定稿

### 1.1 使用

```text
主结构化知识库：SQLite
语义 / 全文 / Hybrid 检索库：LanceDB
图谱检索：自研 SQLite Graph-aware Retriever
中文 NLP Bootstrap：本地 Python + HanLP
服务端编排：Next.js Route Handlers + TypeScript server modules
后台调度：detached `scripts/knowledge-worker.mjs` + persisted KnowledgeJob
前端状态：Zustand
动态图谱 / 可视化依赖：@xyflow/react
UI：React + Tailwind CSS
测试：Vitest API/unit + Playwright UI smoke
```

### 1.2 不使用

MVP 阶段明确不引入：

```text
sqlite-vec
Neo4j
NebulaGraph
Microsoft GraphRAG
完整 LlamaIndex GraphRAG pipeline
浏览器端 HanLP
API 批量构建知识库
长时间阻塞 HTTP 请求的同步 rebuild
```

### 1.3 系统分工

| 层 | 职责 | 是否权威 |
| --- | --- | --- |
| SQLite | 小说、章节、实体、别名、关系、状态、候选人物、HanLP cache、任务状态 | 是 |
| LanceDB | 原文片段、人物卡、事件、设定、关系描述等可重建检索文档 | 否 |
| Graph-aware Retriever | 从 SQLite 查询局部图谱、按章节有效期过滤、格式化事实约束 | 否，读 SQLite |
| HanLP Bootstrap | 本地中文分词/NER/出现频次/章节覆盖率/初始候选信号 | 否，结果缓存入 SQLite |
| LLM Extraction | 章节知识抽取、已知人物增量、未知人物观察、极简别名发现 | 否，落库前需 deterministic sync |
| Workspace UI | 展示分类、缓存状态、进度、关系和可操作按钮 | 否 |

## 2. 目标体验

导入小说后，用户期望的完整流程如下：

```text
1. 系统将章节写入 SQLite。
2. 用户触发知识图谱重建。
3. API 立即返回 queued/running 状态，不阻塞整个网站。
4. 后台 worker 按章节运行 HanLP bootstrap，并记录 cache hit/miss、ETA、阶段耗时。
5. 系统用 HanLP 聚合信号初始化正式人物层级和候选上下文。
6. 系统按抽取并发配置形成章节 batch，先抽取当前 batch，再同步和写入当前 batch，然后才进入下一个 batch。
7. 每章执行一次知识抽取，输出已知人物更新、未知人物观察、别名发现、关系、事件、设定和伏笔；命中候选缓存时不重复调用 LLM。
8. 当前批次结果先统一做 alias-first deterministic sync，再按章节顺序写候选池、promotion 和正式图谱。
9. 系统重建 SQLite projection 和 LanceDB retrieval index。
10. 用户在知识面板看到人物分类、别名、HanLP cache 状态、重建进度和缓存删除控制。
11. 用户选中第 N 章文字触发扩写时，Context Builder 合并图谱上下文、LanceDB 证据和当前章节上下文。
12. 生成路径调用 API 模型流式生成最终正文。
```

核心 UX 约束：

- 点击“重建知识视图”不能冻结站点。
- `/library`、workspace 等其他页面在 HanLP 子进程运行时仍应响应。
- 用户必须能看到 HanLP bootstrap 是否正在排队、运行、暂停、ready 或 empty。
- 删除 HanLP cache 必须在 active rebuild 时被阻止，并返回明确 action error。
- Candidate 不进入正式人物列表；只有 promotion 后才进入正式图谱。

## 3. SQLite 权威数据模型

当前知识图谱使用直接 SQL server modules 管理 schema 和 boot migration。主要表和含义如下。

### 3.1 小说和章节基础

- `NovelRecord`: 小说元数据。
- `StoryBranch`: 分支，主分支使用 `getMainBranchId(novelId)`。
- `KnowledgeChapter`: 权威章节文本、章节号、dirty 状态、source hash。
- `ChapterLine`: 章节行号和字符 offset。
- `TextSpan`: 段落/片段级证据范围，是 retrieval 和 evidence 的基础。

### 3.2 权威图谱实体

- `KnowledgeEntity`: 人物、地点、组织、设定等 canonical entity。
- `KnowledgeFact`: 人物卡、状态、事实、设定等结构化知识。
- `EntityState`: 人物状态的章节有效期视图。
- `EntityMention`: 原文中实体提及及解析结果。
- `EntityAppearance`: 与人物外观相关的证据跨度。
- `EntityLink`: 关系边，带有效章节区间。

`KnowledgeEntity.importanceTier` 只允许 character 使用，允许值：

```text
protagonist -> Tier 0 主角
important   -> Tier 1 重要配角
arc         -> Tier 2 篇章配角
candidate   -> Candidate
ignored     -> Ignored
```

非 character 实体不得写入 character tier。SQLite boot migration 通过 trigger/索引维护旧库兼容。

### 3.3 别名和冲突

别名有两层：

- `EntityAlias`: 旧有兼容表，按 entity 存储 alias。
- `EntityAliasMapping`: 新增 branch-scoped 全局别名归属表，`UNIQUE(branchId, alias)`，保证同一分支中一个 alias 只有一个 canonical owner。

冲突记录在 `EntityAliasConflictLog`。规则是 first deterministic mapping wins：

```text
同一 alias 第一次稳定映射到 A -> A 持有
后续同一 alias 尝试映射到 B -> 不覆盖 A，写 conflict log
```

这个设计避免了并行章节抽取顺序导致的非确定性别名漂移。

### 3.4 HanLP cache 和 bootstrap 结果

HanLP 结果写入：

- `hanlp_bootstrap_cache`: 每章可复用的原始/标准化 bootstrap cache。
- `hanlp_bootstrap_results`: 与 `KnowledgeJob` 关联的本次 bootstrap 结果。
- `hanlp_bootstrap_entities`: 可查询的人名、地点、组织、设定 terms。

Cache key 由以下字段共同决定：

```text
novel_id
branch_id
chapter_id
chapter_text_hash
hanlp_script_version_hash
hanlp_model_or_config_hash
output_schema_version
pipeline_version
```

只要任一字段变化，就不能复用旧 cache。这样可以避免脚本升级、模型配置变化或章节文本变化导致的 stale NLP 信号。

### 3.5 LLM extraction 和 batch processing cache

LLM 章节抽取结果写入 `chapter_extraction_candidates`。这是抽取缓存和后续 batch 处理缓存的唯一权威位置。

每行 candidate 的核心字段：

- `chapter_source_hash`: 由章节 source hash、抽取 provider/model/settings 和 candidate schema version 共同决定。
- `extraction_json`: 单章 LLM 输出的原始结构化结果。
- `processing_result_json`: 当前 batch 处理后的 resolved 结果缓存。
- `status`: `extracting`、`extracted`、`resolving`、`persisted`、`failed` 或 `stale`。
- `provider` / `model` / `error_message`: 抽取来源和失败信息。

`extraction_json` cache 命中条件：同一 `branch_id`、`chapter_id`、`chapter_source_hash`，且状态是 `extracted` 或 `persisted`。命中时不再调用 LLM。重新抽取章节时必须把 `processing_result_json` 写成 `NULL`，避免旧 batch 处理结果覆盖新抽取。

`processing_result_json` 的 schema version 是 `knowledge-extraction-processing:v1`，结构包括：

```text
schemaVersion
batch.chapterIds
batch.chapterNos
batch.aliasDiscoveries
resolved
```

读取 processing cache 时必须同时匹配 schema version、当前 batch 的章节 ID 顺序、章节号顺序，以及已应用的 batch alias discoveries。任一字段不同都不能复用。这样可以保证同一章节在不同 batch 划分、不同 alias 同步结果或不同处理 schema 下不会拿到 stale resolved payload。

### 3.6 候选人物池

未知人物不直接进入正式图谱。它们先进入：

- `character_candidates`: surface text、normalized name、first/last seen chapter、chapter_count、mention_count、promotion state。
- `character_candidate_chapters`: distinct chapter 计数，每个 candidate/chapter 只有一行。

Promotion 规则：

```text
chapter_count < 10       -> 继续保持 candidate
chapter_count >= 10      -> 晋升为正式 character
promotion_summary_status -> 保证晋升摘要只生成一次
```

`chapter_count` 统计 distinct chapters，不统计 mention 次数。同章出现 20 次仍然只算 1 章。

## 4. Rebuild Pipeline

知识图谱重建由 `KnowledgeJob` 驱动。当前主要阶段顺序：

```text
hanlp-bootstrap
extract current batch
batch-sync
write current batch
repeat extract/batch-sync/write until no pending chapters
index
```

历史上暴露过的 `cleanup` step 仍可作为进度/兼容状态存在；当前实现会在第一次抽取前完成范围内旧派生知识清理，然后进入 batch-by-batch 循环。

### 4.1 API start 和 detached background worker

`POST /api/knowledge-view` 的 rebuild action 不等待完整 rebuild：

```text
POST /api/knowledge-view?action=rebuild
  -> startKnowledgeRebuildForNovel()
  -> return projection with jobOutcome queued/running
  -> scheduleKnowledgeWorkerProcess(...)
  -> detached scripts/knowledge-worker.mjs runs targeted worker entrypoints
```

这样 HTTP response 可以快速返回。Route 只负责持久化 `KnowledgeJob` 并调度 detached worker 进程；后台 worker 继续运行，并通过 `KnowledgeJob.payloadJson` 更新 progress、steps、ETA、HanLP telemetry 和 stage timings。知识视图的 GET/status 读取在发现 watchdog 已把 stale job 重新标记为 `queued` 时，也会再次触发调度，避免用户必须手动再点一次 rebuild。

`activeKnowledgeRebuildRuns` / `activeKnowledgeRetrievalRuns` 只是进程内优化，用于减少同一进程里的重复启动。真正的 lifecycle 和跨进程 claim 仍以 SQLite `KnowledgeJob.status` 的条件更新为准。

### 4.1.1 Generic no-progress watchdog

`KnowledgeJob` 上的后台任务会运行一个通用的 no-progress watchdog：

- `RETALE_TASK_STALE_TIMEOUT_MS`：任务在 `queued` / `running` 状态下超过该时长没有 `updatedAt` 进展时，视为 stale。
- `RETALE_TASK_MAX_RETRIES`：watchdog 最多自动重试多少次；超过上限后直接标记失败。
- 每次 watchdog retry/terminal fail 都会在 `payloadJson.taskWatchdog` 写入新的 `attemptId`。
- worker / rewrite runner claim 任务时会读取并持有当前 `attemptId`；后续 progress/success/failure 写入都要求 attempt 仍匹配。
- 因此旧的超时 worker 即使还活着，也不能覆盖新的 watchdog retry、pause/abort，或最终失败状态。
- `paused` / `aborted` 任务不会被 watchdog 自动重排。

### 4.2 HanLP bootstrap phase

每章输入：

```text
novelId
branchId
chapterId
chapterNo
normalized rawText
outputSchemaVersion
```

执行逻辑：

1. 标准化章节文本，计算 chapter text hash。
2. 计算 script version hash 和 model/config identity hash。
3. 查找 matching cache。
4. Cache hit：直接使用 cache/result。
5. Cache miss：用 async `child_process.spawn` 调用 `hanlp_bootstrap.py`。
6. 校验 stdout JSON，包括 people、locations、organizations、settings、mentions、counts、coverage、score。
7. 写入 cache/result/entities。
8. 更新 `hanlpBootstrap.completedChapterCount`、cache hit/miss 和 progress。

必须使用 async spawn，不能用 `spawnSync` 或其他同步 child-process API。同步子进程会阻塞 Node event loop，导致网站整体卡住。

### 4.3 Tier initialization

HanLP 聚合实体用于初始化正式人物层级：

- 用户/系统已有强确认人物优先保留。
- 主角优先来自已确认配置；否则根据 HanLP total count、chapter count、score 决定。
- 高频、覆盖多章的人物进入 `important` 或 `arc`。
- 临时人物不进入正式 `KnowledgeEntity`。
- 非人物 terms 作为地点/组织/设定上下文，不写 character tier。

Initializer 必须幂等。重复运行不能重复创建正式人物，也不能覆盖更强的 user-confirmed 信息。

### 4.4 Extraction phase

每章只做一次抽取请求，输出固定 JSON 字段：

```text
chapter_no
summary
characters
known_character_updates
unknown_character_observations
alias_discoveries
relations
events
worldbuilding
open_threads
```

关键约束：

- `known_character_updates` 用于已知人物增量变化。
- `unknown_character_observations` 只记录可能后续反复出现的未知人物观察。
- `alias_discoveries` 只能是 `{ "alias": "B", "target": "A" }`。
- 不输出 `valid_from_chapter`、`revealed_from_chapter`、spoiler 字段或 alias type。
- 泛称如“他、她、那人、男人、女人”不得进入 alias。
- `appearance`、`body`、`clothing` 是高优先级字段；没有变化时用“没有变化”，但不能覆盖已有有效描述。

抽取阶段按 batch 工作：

1. 从 rebuild range 的 `pendingChapterIds` 中按章节号取最多 `knowledgeExtraction.parallelism` 个章节。
2. 每个章节先计算 `chapter_source_hash` 并查找 `chapter_extraction_candidates`。
3. 命中 `extracted` / `persisted` candidate 时直接复用 `extraction_json`。
4. 未命中时构造抽取上下文并调用 LLM。上下文包含 `buildKnowledgeExtractionStoryState(asOfChapter = chapterNo - 1)` 和当前章 HanLP prompt context。
5. 新抽取结果写入 `extraction_json`，并把 `processing_result_json` 清空。
6. 当前 batch 抽取完成后写入 job payload 的 `extractedChapters` 和 `currentBatchChapters`，立即进入 `batch-sync`，不继续抽取后续 batch。

这种顺序保证 batch N 写入 SQLite 后，batch N+1 的 prompt 能读到 batch N 已落库的章节摘要、人物、别名、关系、事件、设定和候选晋升结果。

### 4.5 Batch sync phase

抽取可以并行，但 batch 同步和写入必须 deterministic。当前 batch 同步顺序固定：

```text
collect current batch outputs
  -> sort by chapter_no ASC
  -> alias_discoveries by output order
  -> normalize and filter invalid aliases
  -> write orderedAliasDiscoveries to KnowledgeJob payload
  -> resolve alias target against branch-global character entities
  -> claim branch-global alias mappings or write EntityAliasConflictLog
  -> enter write phase for the same batch
```

不允许用 Promise 完成顺序决定 alias owner。任何涉及 authoritative DB write 的步骤都必须按稳定章节顺序执行。

同一个 batch 内，后面章节发现的 alias 会先被同步，再按章节号写入前面的章节。因此当前 batch 中较早章节的 known update、unknown observation 和 relation 解析，也能使用同批后面章节发现的别名映射。

### 4.6 Write, cleanup, index phases

Write 阶段将当前 batch 的章节 candidate extraction 按章节号写入正式图谱表。写入每章时会构造稳定的 batch processing context：

```text
currentBatchChapters.chapterIds
currentBatchChapters.chapterNos
orderedAliasDiscoveries
```

如果 candidate 的 `processing_result_json` 与该 context 完全匹配，就直接复用 `resolved`。否则从 `extraction_json` 解析得到 resolved result，并把 `{ schemaVersion, batch, resolved }` 写回 `processing_result_json`。

每章正式写入包括：

- `KnowledgeChapter.summary`、`isDirty = 0`、`knowledgeStatus = ready`。
- `KnowledgeEntity`、`EntityAlias`、`EntityAliasMapping`、`EntityAppearance`、`EntityMention`。
- `EntityState`、`KnowledgeFact`、`KnowledgeRelation`、`EntityLink`。
- `KnowledgeEvent`、`EventParticipant`、`KnowledgeWorld`、open thread facts。
- `character_candidates`、`character_candidate_chapters` 和满足阈值后的 promotion。

当前 batch 的 write queue 清空后，如果还有 pending chapters，就清空 `currentBatchChapters`、`orderedAliasDiscoveries` 和已应用计数，回到 `extract` 处理下一个 batch。Index 阶段在所有 batch 完成后重建 retrieval index。

设计约束：

- 不在 DB transaction 内调用 LLM。
- 不开启覆盖整本小说的长事务。
- 每章 candidate 可以独立失败并记录 error，但无 cache 且 HanLP 不可用时 HanLP phase 应失败，而不是静默退回 LLM-only。
- Retrieval index 可重建；SQLite authoritative state 不可随意丢弃。

## 5. Graph-aware RAG 设计

Graph-aware RAG 负责事实约束，不负责文风召回。它用 SQLite 表回答：

```text
谁和谁是什么关系？
某个人物当前是什么状态？
某人是否受伤、死亡、失踪、背叛？
某人属于哪个组织？
某个事件导致了什么后果？
某个设定有哪些限制？
当前章节之前哪些关系有效？
```

### 5.1 在线查询路径

选中文本触发生成时，在线路径应该是：

```text
selected text + nearby text
  -> resolve seed entities from names/aliases/mentions
  -> query KnowledgeEntity / EntityAlias / EntityAliasMapping
  -> load EntityState and EntityLink with valid chapter interval
  -> score local graph nodes and edges
  -> format compact graph context text
  -> merge with LanceDB retrieval docs
  -> send final prompt to generation provider
```

在线路径不调用 HanLP，也不调用本地 LLM。它只读 SQLite 和 retrieval index。

### 5.2 章节有效期

所有图谱查询必须尊重：

```text
validFromChapter <= currentChapterNo
validUntilChapter > currentChapterNo
firstSeenChapter <= currentChapterNo
```

这保证扩写第 N 章不会使用 N 章之后才出现的关系、状态或设定。

### 5.3 Context formatting

Graph context 应包含：

- canonical name。
- character tier label。
- aliases。
- 当前状态摘要。
- 关系边。
- 证据 quote 或 span reference。
- warnings，例如实体因章节不可用被跳过。

Context 要短、事实密度高、便于模型使用，不输出 UI-only 元数据。

## 6. LanceDB Retrieval Index 设计

LanceDB 是可重建检索库。它保存知识派生文档和原文片段，用于语义召回、全文召回、Hybrid Search、类似场景和文风参考。

当前可进入 retrieval docs 的内容包括：

```text
text_spans
chapter_summaries
entity_profiles
event_summaries
worldbuilding_entries
relationship_descriptions
open_threads
```

人物 profile doc 应包含：

- canonical name。
- aliases from `EntityAlias` and `EntityAliasMapping`。
- classification/tier label and key。
- compact role-card profile。
- description delta。
- chapter validity metadata。

LanceDB 不保存用户确认状态的最终真相，也不作为关系图谱主库。任何 index 损坏都可以从 SQLite 重建。

## 7. Workspace UI 设计

Workspace knowledge panel 展示当前 projection：

- formal characters。
- aliases。
- classification badge：Tier 0 / Tier 1 / Tier 2 / Candidate / Ignored。
- HanLP bootstrap progress card。
- HanLP cache card。
- raw-text embedding progress。
- rebuild pause / abort / resume actions。
- delete knowledge graph。
- delete HanLP cache。

### 7.1 HanLP progress card

展示字段：

```text
status: queued/running/paused/ready/empty
completedChapterCount / totalChapterCount
chapter progress percent
cache hit rate
current phase detail
ETA
stage timing
script/config/schema/pipeline snapshot
```

### 7.2 Cache deletion UX

删除 HanLP cache 的规则：

- active rebuild queued/running/paused 时 disabled。
- API 返回 `jobOutcome: blocked` 和 `actionError`。
- 只删除当前 novel main branch 的 HanLP cache/result/entity rows。
- 不删除正文、workspace state 或 raw text embedding cache。

## 8. Runtime Configuration

HanLP 只在 server 端运行。配置项：

```bash
HANLP_PYTHON_BIN="/absolute/path/to/python"
HANLP_BOOTSTRAP_SCRIPT_PATH="/optional/absolute/path/to/hanlp_bootstrap.py"
HANLP_BOOTSTRAP_BATCH_SIZE="256"
HANLP_BOOTSTRAP_TIMEOUT_MS="600000"
```

建议：

- Python virtualenv 放在仓库外，避免 Next/Turbopack trace virtualenv symlink。
- `HANLP_PYTHON_BIN` 指向能 import HanLP 的 Python。
- `HANLP_BOOTSTRAP_SCRIPT_PATH` 为空时使用项目根目录 `hanlp_bootstrap.py`。
- `HANLP_BOOTSTRAP_BATCH_SIZE` 控制每次传给 HanLP 的句子/行片段数量，默认 `256`。
- `HANLP_BOOTSTRAP_TIMEOUT_MS` 是每章 subprocess timeout，不是整本书 timeout。

## 9. Failure Semantics

### 9.1 HanLP unavailable

如果没有 valid cache 且 HanLP 脚本缺失、Python 不可用、timeout、非 0 退出或 JSON malformed：

```text
fail HanLP phase
mark job failed / expose actionable error
do not silently fall back to LLM-only rebuild
```

### 9.2 Background worker failure

调度层只负责 detached spawn 和同 attempt 去重；它不会通过 stdio 捕获子进程错误输出。可见状态仍以 worker 自己写回的 `KnowledgeJob` payload/status 为准，后续 UI 可以继续轮询 projection。

### 9.3 Active rebuild duplicate start

如果已有 queued/running/paused job：

- paused -> 重新置为 queued，等待继续。
- running -> 返回 `jobOutcome: running`。
- queued -> 返回 `jobOutcome: queued`。

不创建并行重建任务。

## 10. Determinism and Safety Invariants

必须长期保持的不变量：

- SQLite 是唯一权威状态。
- LanceDB index 可以重建。
- HanLP cache 必须按完整 cache key 校验。
- Alias sync 必须先于 candidate promotion。
- Alias owner 由稳定排序决定，不由并行完成顺序决定。
- First alias mapping wins，冲突只记录不覆盖。
- Candidate promotion 阈值固定为 `chapter_count >= 10`。
- Candidate chapter count 统计 distinct chapters。
- Promotion summary 每个 newly promoted candidate 只生成一次。
- “没有变化”不能覆盖已有 appearance/body/clothing 细节。
- 不在 DB transaction 中调用 LLM。
- 不用中等/大文件做全端到端测试。
- UI rebuild action 不阻塞 HTTP response。

## 11. Verification Strategy

当前回归覆盖分为几类：

```text
Unit:
- character tier constants and labels
- HanLP cache key / timeout / validation helpers
- extraction prompt/output normalization
- alias sync pure behavior
- workspace HanLP display helpers

API:
- schema boot/migration on temp SQLite
- HanLP cache hit/miss/failure
- HanLP rebuild phase ordering and pause/abort
- alias-first deterministic sync and conflict logging
- candidate promotion threshold/idempotency
- non-blocking knowledge-view rebuild POST
- HanLP cache delete blocked during active rebuild
- retrieval index cache reuse and tier/alias docs

UI:
- knowledge workspace shows HanLP progress/cache/classification controls

Build:
- npm run build
```

Acceptance focus：

- 点击 rebuild 后 POST 快速返回 queued/running。
- HanLP 子进程运行时 `/library` 等页面仍能响应。
- `knowledgeRebuildStatus` 暴露 steps、HanLP telemetry、cache status。
- Cache 删除 active rebuild 时 blocked。
- Alias conflicts stable。
- Candidate promotion stable。
- Retrieval docs 包含 tier labels 和 aliases。

## 12. Implementation Map

主要文件：

```text
app/api/knowledge-view/route.ts
  API entry, detached worker scheduling, maxDuration, cache delete action.

lib/server/knowledge-worker-scheduler.ts
  Spawns detached `scripts/knowledge-worker.mjs` processes for targeted jobs.

scripts/knowledge-worker.mjs
  Node worker entry that runs targeted knowledge rebuild / retrieval rebuild jobs.

lib/server/knowledge-rebuild.ts
  KnowledgeJob state machine, HanLP phase, batch sync, candidate promotion, index rebuild.

lib/server/knowledge-view.ts
  Projection payload, HanLP telemetry, cache status, non-blocking rebuild facade.

lib/server/hanlp-bootstrap.ts
  Async Python subprocess runner, output validation, cache key, persisted cache/results/entities.

lib/server/hanlp-bootstrap-initializer.ts
  HanLP aggregate -> initial character tier/entity preparation.

lib/server/hanlp-contracts.ts
  Tier metadata and HanLP-facing contracts.

lib/server/knowledge-extraction.ts
  Extraction prompt/schema normalization for known updates, unknown observations, aliases.

lib/server/retrieval-index.ts
  Knowledge-derived retrieval docs, tier/alias text, cache reuse.

lib/server/graph-context.ts
  SQLite Graph-aware retrieval and context formatting.

components/workspace/selection-novel-studio.tsx
  Workspace status cards, tier badges, cache controls.

store/novel-store.ts
  Client action outcomes and knowledge projection state.

hanlp_bootstrap.py
  Local Python HanLP bootstrap script.
```

## 13. Open Boundaries

当前设计保留但不在本次范围内解决：

- 多用户认证、云同步、协作编辑。
- 独立图数据库迁移。
- 完整 GraphRAG 框架接入。
- 对所有历史 job failure 的 UI 复盘页面。
- 对所有实体类型的手工审核工作流。
- API-free 的全本 LLM extraction 强制模式；当前系统支持本地/配置化 provider，但最终是否完全本地取决于运行配置。

这些边界不能通过在 rebuild path 中添加临时 fallback 或隐藏兼容分支来绕过。如果需要扩展，应先更新设计文档和测试验收标准。
