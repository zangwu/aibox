from pathlib import Path

p = Path(r"D:\_Lives\_Projects\aibox\docs\dev-workflow.md")
text = p.read_text(encoding="utf-8")
if "17. 设计审核" in text:
    print("exists")
    raise SystemExit

section = r"""

---

## 17. 设计审核：逻辑检查、缺口与工程流程对齐

> 审核目的：在实现前抓住矛盾点，补齐「像正规软件工程」所需的最小闭环。

### 17.1 流程对齐（对照标准研发流）

| 工程阶段 | 本设计已有 | 缺口 / 补强 |
|----------|------------|-------------|
| 立项/目标 | 需求文档目标 | 增加 **项目元信息**：仓库路径、Harness 工作区、模块清单、发布版本号 |
| 需求 | PRD 基线、suggestion | **DoR（就绪定义）**、变更控制、优先级与工作量字段 |
| 设计 | phase=design | 明确「设计任务」产物（接口/关卡表/技术笔记） |
| 开发 | 自研环、评论 | **分支/提交策略**、锁仓、灰度 vs 全量改动 |
| 测试 | test 类型、冒烟 | **测试分层**（单测/集成/UI）、回归策略、通过门禁阈值 |
| 评审 | G3/G4/G5 | **代码 Review** 与「需求验收」分离（不要混成一个 accept） |
| 发版 | phase=release | **版本清单**、changelog、可回滚点 |
| 运维/缺陷 | bug | **热修通道**、SLA（P0 立即打断自研） |
| 度量 | 无 | 轻量指标：周期时间、返工次数、自动通过率 |

结论：整体骨架（需求→开发→测试→门禁→完成）**符合**软件工程主链路，但发版、缺陷热修、度量偏薄，补最小字段即可。

### 17.2 逻辑漏洞与修法

| # | 漏洞 | 后果 | 修法 |
|---|------|------|------|
| L1 | `status` 与 `phase` 双轨可能不一致 | 看板对不上 | **phase 自动派生优先**，允许手动跳阶段但写审计；校验合法组合 |
| L2 | 需求基线确认后又靠评论改范围 | AI 目标漂移 | 评论仅微调；**范围级改动走变更单** → 新基线 vN |
| L3 | 「自动研发」与「G5 人工整单」冲突 | 以为全自动能关单 | **G1/G5 默认强制人**；自动默认只打到 G3/G4 |
| L4 | 多任务抢同一仓库 | 损坏工作区 | **项目级工作区锁** + 同 module 串行 |
| L5 | AI accept 放水 | 名过其实 | 自动验收必须有可验证证据；主观项转人审 |
| L6 | 无限迭代 | token/时间烧尽 | maxAutoIterations + 预算 + 熔断 @人 |
| L7 | 测试失败无人管 | 红灯常态 | 红灯自动建 bug / 阻塞同模块验收 |
| L8 | 桌面协作谁点完成 | 假完成 | outbox 报告 + 人点「交付」或 G4 |
| L9 | 只有优先级无依赖 | 顺序错乱 | dependsOn 未满足不得 doing |
| L10 | 评论含密钥 | 泄露 | 脱敏入库；日志不落 key |
| L11 | suggestion 噪音 | 看板淹没 | 默认归档，采纳才入列 |
| L12 | DoD 只勾 UI | 遗留债 | 模块 DoD：构建、测试、无阻塞 FIXME |
| L13 | 发版无法追溯 | 说不清改动 | done 关联 releaseNote 拼 changelog |
| L14 | 人工模式疲劳 | 门门点通过 | 批量门禁 + 低风险快车道 |

### 17.3 必补的数据字段（最小）

```json
{
  "project": {
    "repoPath": "D:/_Lives/_Projects/xxx",
    "harnessWorkspace": "D:/_Lives/_Projects/xxx",
    "version": "0.3.0",
    "modules": [{ "id": "inventory", "title": "背包", "color": "#f472b6" }]
  },
  "workItem": {
    "phase": "dev",
    "module": "inventory",
    "storyPoints": 3,
    "dependsOn": ["WF-20"],
    "ready": true,
    "dodChecked": [],
    "releaseNote": "",
    "risk": "low",
    "budgetMinutes": 60
  }
}
```

### 17.4 状态合法组合（防 L1）

| phase | 允许 status |
|-------|-------------|
| discovery | draft / open / cancelled |
| design | open / doing / review |
| dev | open / doing / review / reopened |
| verify | open / doing / review |
| release | open / doing / done |
| done | done / closed |

`reopened` 默认回 `dev`，并写审计。

### 17.5 测试门禁（补强）

- T1 静态 typecheck/lint
- T2 单元测试
- T3 UI/集成冒烟
- T4 acceptance 清单
- T5 关键回归

T1+T2 必绿才进 review；关联 T3 必跑；P0/核心模块强制 T5。

### 17.6 缺陷与热修

- P0 bug 可抢占自研队列
- hotfix 分支策略人工确认合并
- 关闭 bug 必须附验证步骤

### 17.7 度量（轻量）

| 指标 | 用途 |
|------|------|
| lead time | 交付快慢 |
| reject 次数 | 质量/理解偏差 |
| AI 自动通过率 | 能否放开自动档 |
| 模块缺陷密度 | 是否补测 |

### 17.8 安全与权限

- 默认禁止写工作区外路径
- 命令执行白名单或确认开关
- 密钥不进评论，走 aibox 本机预设/密钥存储

### 17.9 小游戏特化补丁

- 模块必填
- 可玩性证据（截图/录像 Artifact）
- 平衡类可「仅改配表」交付
- 构建号 version+git sha 挂 release

### 17.10 优先级修正（建议插入 M1.5）

自动化（M2）之前必须先有：

1. phase/module 看板
2. DoR/DoD 与合法状态机
3. 工作区锁
4. 测试失败阻塞

否则自动研发容易「跑快但跑歪」。

### 17.11 审核结论

| 项 | 结论 |
|----|------|
| 是否符合软件工程主流程 | **符合**（需求→设计→开发→测试→评审→发版） |
| 最大逻辑风险 | L1 双轨不一致、L2 范围漂移、L3 自动关单语义、L4 抢工作区 |
| 是否要推翻产品定位 | 否 |
| 能否开写代码 | **可以做 M1 人工闭环**；自动档先补 L4/L5/L6/测试门禁 |

"""

p.write_text(text.rstrip() + section, encoding="utf-8")
print("appended review")
