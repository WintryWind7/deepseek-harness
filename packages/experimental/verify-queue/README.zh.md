---
description: "项目验收队列：worktree-dev 把已提交的修复记入 .dsh/verify-queue/，读取方检查这些提交是否已经在 main 上。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-verify-queue

[English](README.md) | 中文

## 概述

`dsh-experimental-verify-queue` 在项目树里保存 worktree-dev 修复清单，便于稍后确认其提交已在 `main` 上，并在正在运行的应用上勾掉。worktree-dev 在提交后调用 `verify_queue_record` 自行决定记什么。本服务从不合并。将 Host 插件挂到 Web profile、将 `./tool` 挂到 worktree-dev 预设，并挂上同组 Web 抽屉即可看到列表。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 worktree-dev 会话应在项目树留下可持久核对清单时选择本实验包。若每次修复都在同一会话里合并并验收，则不必使用。

记录位于 `{workspace}/.dsh/verify-queue/`。每条含标题、记录会话 id，以及一个或多个提交 SHA。状态在读取时推导：所有 SHA 成为 `refs/heads/main`（或 `master`）的祖先之前为 `recorded`，之后为 `on-main`，人工勾选后为 `verified`。

面向模型的工具是 `@deepseek-ai/dsh-experimental-verify-queue/tool`。只把该行加到 worktree-dev 预设。省略 `commits` 则记录该会话 worktree 的 HEAD（目录 `.dsh/worktrees/<sessionId>` 存在时）。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

`VerifyQueue` 是 `TypertRemoteService`（`ctx.verifyQueue`，命名空间 `verifyQueue`）。Remote 方法为 `view`、`setVerified`、`removeItem` 和 `setUi`。`record` 仅供进程内工具调用。Git 检查使用 `git merge-base --is-ancestor`。线上名是 `removeItem`，因为 Client Remote 方法不能叫 `remove`——该名属于 Cordis Service 原型。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 服务与 Remote 方法 |
| [`src/tool.ts`](src/tool.ts) | `verify_queue_record` |
| [`src/store.ts`](src/store.ts) | `items.json` 与 `ui.json` |
| [`src/git.ts`](src/git.ts) | HEAD 与祖先检查 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 抽屉](../client-ui-verify-queue/README.zh.md) — 右缘 overlay。
- [Web profile 层](../verify-queue-web-profile/README.zh.md) — 安装进源码 checkout 的 Web profile。

-----

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型看见什么

当 worktree-dev 预设挂载 `./tool` 时的 `verify_queue_record` 工具。

##### 需要时，本字段的原文

```markdown
Record one committed worktree fix on the project verify queue so it can later be checked against main and accepted on the running app. Call this only after the fix is committed on this session's worktree branch. title is a short reminder of what to look at (the bug or UI change). Omit commits to record this worktree HEAD. Do not record planning work, uncommitted edits, or screenshot-only sessions.
```

#### Token 影响

有条件：仅当 worktree-dev 预设挂载 `./tool` 时工具 schema 才出现。

#### KV Cache 影响

与 Host 队列读取无关。把该工具加进预设会改变该预设的工具目录前缀。

## 已知限制与延期工作

- **不合入。** 服务只读取已记录提交是否已经在 main 上。
- **只认 main 或 master。** 其他默认分支名会让祖先检查失败。
- **必须由 worktree-dev 调用该工具。** 不会从第一条用户消息自动入账。
- **Remote 方法名。** `remove` 不能作为 Client Remote 方法；抽屉调用 `removeItem`。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
