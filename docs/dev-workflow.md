# AI Box · 研发工作流产品设计 v3

> 状态：设计定稿候选（**未改业务代码**）  
> 相对 v2：合并审核结论（§17）——状态机合法性、变更控制、工作区锁、测试门禁、Harness 桌面协作、M1.5  
> 一句话：**人确认需求文档 → AI 在门禁下自研/协作 → 阶段×功能模块可追溯 → 直到验收**

---

## 0. 目标

1. 人只做：**定需求、定验收、关键门禁、纠偏**  
2. AI 做：**发现缺口、开发、自测、回帖、待验收**  
3. 默认 **步步人审**；开关可 **AI 自审开发/测试**（G1/G5 仍人）  
4. 上下文不散：**阶段（Phase）× 功能模块（Module）** 双维度看板  
5. 与 **DeepSeek Harness 桌面端协作**（功能全的干活台），盒子负责看板/门禁/调度  

---

## 1. 角色

| 角色 | 职责 |
|------|------|
| PM（人） | 文档基线、门禁、accept/reject、变更确认 |
| AI 需求助理 | 草案、补验收、找缺口（suggestion） |
| AI 开发 | 实现、自测、回帖 |
| AI 测试 | 用例、冒烟、报 bug |
| AI 巡检 | 定时摘要、排队、催门禁 |
| Harness 桌面（外） | 复杂/插件向开发（semi 协作） |

---

## 2. 对象模型

```text
Project
  repoPath / harnessWorkspace / version
  modules[] / settings / automation
RequirementDoc
  versions[] + baseline（确认后冻结 hash）
WorkItem
  type, phase, module, status, assignee, priority, risk
  acceptance[], dodChecked[], dependsOn[], storyPoints, budgetMinutes
  comments[], gates[], artifacts[], releaseNote
```

### 2.1 type

`feature` | `task` | `test` | `bug` | `suggestion` | `change`（需求变更）

### 2.2 phase × status（合法组合，防双轨错乱）

| phase | 允许 status |
|-------|-------------|
| discovery | draft / open / cancelled |
| design | open / doing / review |
| dev | open / doing / review / reopened |
| verify | open / doing / review |
| release | open / doing / done |
| done | done / closed |

- `reopened` → 默认回 `dev`，写审计  
- 非法组合写入时拒绝或自动纠偏 + 日志  

### 2.3 module（Epic）

每条 WorkItem **必填** `module`（如 `inventory` 背包、`leaderboard` 排行榜）。  
同模块默认 **串行**；跨模块且路径不交可并行（受工作区锁约束）。

---

## 3. 需求文档与变更

1. 人写/与 AI 共创 PRD → 版本 v1, v2…  
2. **确认** → `baseline`（hash+时间）  
3. **范围级**修改走 `type=change`：过审后出新基线 vN  
4. 评论只做微调与验收意见，**不得静默改范围**（L2）  

### DoR（可开工）

- 有验收清单  
- 有 module、优先级  
- 无未解析的 dependsOn  
- 人已确认（或 suggestion 已采纳）  

### DoD（可关闭）

- acceptance 全勾（证据：测试/截图/命令）  
- T1+T2 测试绿；关联 T3 冒烟通过  
- 无 P0 缺陷；无「阻塞级 FIXME」  
- 有 releaseNote 片段  

---

## 4. 门禁与自动化

| Gate | 内容 | 默认 | 自动档 |
|------|------|------|--------|
| **G1** | 需求文档确认 | **人** | **仍是人** |
| G2 | 技术方案（可选） | 人 | AI |
| G3 | 代码实现 | 人 | AI（须证据） |
| G4 | 测试结果 | 人 | AI（须跑测） |
| **G5** | 整单完成 | **人** | 仅当显式 `autoFinalAccept` |

开关：`acceptDev` / `acceptTest`；`maxAutoIterations`（默认 8）；预算 `budgetMinutes`。  
**强制人审**：diff>阈值、敏感路径、P0、无自动化测试的主观项（L5）。

---

## 5. 看板信息架构

- **列 = status**：待办 / 进行中 / 验收 / 完成  
- **默认泳道 = module**：背包 | 排行榜 | 战斗…  
- **顶栏 = phase 筛选**：需求 / 设计 / 开发 / 测试 / 发版  
- 详情：面包屑 `模块 > WF-id` + 同模块相关项  

```text
        | 待办 | 进行中 | 验收 | 完成 |
背包    |      |        |      |      |
排行榜  |      |        |      |      |
```

---

## 6. AI 自研环（CLI 主路径）

```text
领任务（DoR + 依赖满足 + 有锁）
  → 开工回帖（复述理解）
  → 实现 / 自测
  → 交付回帖（改动、验证、未做、风险）
  → G3/G4
  → accept → 下一任务 | reject → reopened（读评论再改）
```

- 执行器：**项目绑定 CLI**（Codex / Claude Code / …）  
- **工作区锁**：项目互斥；同 module 串行（L4）  
- 测试失败 → 阻塞同模块验收 / 自动建 bug（L7）  

---

## 7. DeepSeek Harness 桌面协作（semi）

桌面端功能通常强于 CLI/Web，**不嵌入盒子窗口**（无法稳定嵌套原生/Electron 应用）。

| 约定 | 说明 |
|------|------|
| Inbox | `<repo>/.dsh-inbox/WF-id.md`（任务简报） |
| Outbox | `<repo>/.dsh-outbox/WF-id-report.md`（交付说明） |
| 启动 | 一键 `DeepSeek Harness.exe` + 工作区路径 |
| 同步 | 读 `~/.dsh/storages/workspace.json` / `session_projcache` 作线索 |
| 完成 | **outbox + 人点「交付」**，再进 G4（L8） |

自动化级别：`full`（仅 CLI/协议） / `semi`（桌面） / `manual`。

---

## 8. 定时巡检

默认 15m：新任务、未读评论、超时 review、测试红灯、suggestion 积压、autoReview 待推进。  
站会摘要 **按 module 分组**。P0 bug **抢占**队列（热修）。

---

## 9. 需求发现（suggestion）

来源：TODO/FIXME、失败测试、评论未闭环、design 缺口…  
→ 草案默认 **archived**，**人采纳才入库**（L11）。  
可 `@module` 归组，写清「为何提 / 建议验收 / 风险」。

---

## 10. 测试门禁

| 级 | 内容 | 何时必过 |
|----|------|----------|
| T1 | typecheck / lint | 进 review 前 |
| T2 | 单元测试 | 进 review 前 |
| T3 | UI/集成冒烟 | 关联 test 时 |
| T4 | acceptance | 验收 |
| T5 | 关键回归 | P0/核心模块 |

---

## 11. 安全与审计

- 默认禁止写 `repoPath` 外  
- 危险命令白名单或二次确认  
- 密钥不进评论/日志；用 aibox 预设/本机密钥  
- 门禁、变更、跳阶段全部 **审计**（L1/变更控制）  

---

## 12. 度量（轻量）

lead time · reject 次数 · AI 自动通过率 · 模块缺陷密度 → 用于决定能否放开自动档。

---

## 13. UI 信息架构

```text
侧栏「研发」
├─ 需求文档（预览 / 版本 / 确认 / 变更）
├─ 看板（module 泳道 × status 列 + phase 筛选）
├─ 详情（验收 / 评论 / 门禁 / 时间线 / 同模块）
├─ 测试
├─ 建议（suggestion）
└─ 设置（自动化、巡检、执行器、Harness 路径）
```

顶部：自动化模式灯、开始/暂停自研、工作区锁状态。

---

## 14. 数据字段（实现最小集）

```json
{
  "project": {
    "repoPath": "",
    "harnessWorkspace": "",
    "version": "0.1.0",
    "modules": [{ "id": "inventory", "title": "背包", "color": "#f472b6" }],
    "automation": {
      "mode": "manual",
      "acceptDev": false,
      "acceptTest": true,
      "maxAutoIterations": 8,
      "requireHumanFinalAccept": true
    }
  },
  "workItem": {
    "phase": "dev",
    "module": "inventory",
    "status": "open",
    "ready": true,
    "dependsOn": [],
    "acceptance": [],
    "dodChecked": [],
    "releaseNote": "",
    "risk": "low",
    "budgetMinutes": 60
  }
}
```

存储：`%APPDATA%/aibox/workflow/`（project / items / queue / suggestions）。

---

## 15. 里程碑（含 M1.5）

| 阶段 | 内容 |
|------|------|
| **M1** 人工闭环 | WorkItem CRUD、评论、状态机、module/phase 看板、G1 文档确认、手动「让 AI 做」 |
| **M1.5** 硬化 | 合法状态校验、DoR/DoD、工作区锁、T1/T2 阻塞、变更单 |
| **M2** 自研+门禁 | 自动拆任务、G3/G4、acceptDev/Test、熔断 |
| **M3** 发现+巡检 | suggestion、红灯 bug、站会、Harness semi 流 |
| **M4** 增强 | Git、diff 审阅、多 Agent、周报、游戏模板 |

---

## 16. 风险对照（已消化审核）

| 原风险 | 状态 |
|--------|------|
| 状态双轨乱 | 已用合法组合表 |
| 范围漂移 | 变更单+新基线 |
| 自动关单语义混 | G1/G5 人 |
| 抢工作区 | 锁+同模块串行 |
| AI 放水 | 证据式验收+强制人审 |
| 死循环 | 迭代/预算熔断 |
| 测试放羊 | 红灯阻塞 |
| 桌面假完成 | outbox+人交付 |

---

## 17. 与小游戏的关系

- module 必填（背包/排行榜…）  
- 可玩性证据进 Artifact  
- 平衡类可只交配表  
- release 记 `version+git sha`  

---

## 18. 待拍板（默认值已写入）

1. G5 永远人工？**默认是**  
2. AI 是否直接 `git commit`？**默认否，只出 diff/工作区改动，人提交**  
3. Harness 只协作不进 M2 自动？**默认是**  
4. 存储纯本地 JSON？**默认是**  

---

## 19. 变更记录

| 版本 | 说明 |
|------|------|
| v1 | 任务协作闭环 |
| v2 | 自研、门禁/自动开关、AI 发现需求 |
| **v3** | 合并审核：状态机合法性、变更控制、module/phase 看板、工作区锁、测试门禁、Harness 协作协议、M1.5、安全与度量 |
