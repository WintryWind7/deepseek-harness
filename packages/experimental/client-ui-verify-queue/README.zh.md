---
description: "项目验收队列的 Web 右缘抽屉：打开、钉住，并在 worktree-dev 记下的修复进入 main 后勾选。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-verify-queue

[English](README.md) | 中文

## 概述

本包为 Web GUI 增加项目验收队列的右缘 overlay。它挂载生成的 `ctx.remote.verifyQueue`，展示 worktree-dev 记下的修复、刷新其提交是否已在 main 上，并允许钉住抽屉、勾选已验收项或移除它们。它不合并 git 分支。正式发布不含本包。

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

通过 [`@deepseek-ai/dsh-experimental-verify-queue-web-profile`](../verify-queue-web-profile/README.zh.md) 安装。收起时右缘有一条手柄；打开后显示当前会话 cwd 的列表。钉住会经 `{workspace}/.dsh/verify-queue/ui.json` 在刷新后保持打开。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

Client 导出 `$mount` 生成的 Remote，注册文案，并以 id `verify-queue` 占用 `shell.overlay`。overlay 层默认可点击穿透，本条目除外。

| 文件 | 职责 |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Remote、文案与 overlay 注册 |
| [`src/client/Drawer.tsx`](src/client/Drawer.tsx) | 手柄与面板 |
| [`src/index.ts`](src/index.ts) | 空 Host 入口 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [验收队列服务](../verify-queue/README.zh.md) — 存储、git 祖先检查与模型工具。
- [Web profile 层](../verify-queue-web-profile/README.zh.md) — 源码 checkout 安装。
- [实验包](../README.zh.md) — 孵化状态。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本 overlay 不注册任何面向模型的输入。

#### KV Cache 影响

无直接效果。

## 已知限制与延期工作

- **不在 localhost:8100 上。** 抽屉在 DSH 窗口里；核对界面修复仍需把正在运行的应用和本列表并排看。
- **没有实时 git 订阅。** 合入状态在打开、钉住、显式刷新和变更时更新。
- **不打开记录该条的会话。** 列表是核对清单，不是会话切换器。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
