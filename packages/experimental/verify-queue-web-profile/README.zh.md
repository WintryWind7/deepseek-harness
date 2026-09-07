---
description: "把实验性验收队列 Host 服务和右缘抽屉加到源码 checkout 的 Web profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-verify-queue-web-profile

[English](README.md) | 中文

## 概述

`dsh-experimental-verify-queue-web-profile` 是项目验收队列的私有 Web 层。在 `@deepseek-ai/dsh-web-app` 之后加入，以便 Host 服务与右缘抽屉一起挂载。正式发布不含本包。

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

从本仓库 checkout，把该层加到已初始化的 `web` profile：

```sh
pnpm dsh plugin --profile web add ./packages/experimental/verify-queue-web-profile
```

在 worktree-dev 预设上挂载 `@deepseek-ai/dsh-experimental-verify-queue/tool`，该 agent 才能记入条目。用 `dsh plugin --profile web remove @deepseek-ai/dsh-experimental-verify-queue-web-profile` 移除即从 profile 的有序列表中去掉该 bundle。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

运行时内容是 [`cordis.patch.yml`](cordis.patch.yml)。它插入 Host `verify-queue` 服务和 `ui-verify-queue` Client 行。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [验收队列服务](../verify-queue/README.zh.md)
- [Web 抽屉](../client-ui-verify-queue/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 worktree-dev 预设的 `./tool` 行。本 bundle 自身不添加模型请求内容。

#### KV Cache 影响

本 Web bundle 不添加提示词内容。

## 已知限制与延期工作

- **工具不在本层。** Host 服务是进程全局的；`verify_queue_record` 仍须组合进 worktree-dev。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
