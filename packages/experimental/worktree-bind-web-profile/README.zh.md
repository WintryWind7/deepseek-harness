---
description: "把实验性的 worktree-bind Host 路由和输入框芯片加到源码 checkout 的 Web profile。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-worktree-bind-web-profile

[English](README.md) | 中文

## 摘要

`dsh-experimental-worktree-bind-web-profile` 是会话 worktree 绑定的私有 Web 层。加在 `@deepseek-ai/dsh-web-app` 之后，以便 Host 路由和输入框芯片一起挂载。正式发布不含本包。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发笔记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在本仓库 checkout 中，把该层加到已初始化的 `web` profile：

```sh
pnpm dsh plugin --profile web add ./packages/experimental/worktree-bind-web-profile
```

用 `dsh plugin --profile web remove @deepseek-ai/dsh-experimental-worktree-bind-web-profile` 移除即从 profile 的有序列表中去掉该 bundle。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

运行时内容是 [`cordis.patch.yml`](cordis.patch.yml)。它插入 Host 的 `worktree-bind` 行和 Client 的 `ui-worktree-bind` 行。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Host 路由与提示词](../worktree-bind/README.zh.md)
- [输入框芯片](../client-ui-worktree-bind/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 Host 包的运行时上下文。本 bundle 自身不添加提示词文本。

#### KV Cache 影响

本 Web bundle 自身不添加提示词内容。

## 已知限制与延后工作

- **不会卸载第三方 git-worktree 插件。** 若两个芯片会共用输入行，请另行移除 `@laoyuehanni/dsh-git-worktree`。

-----

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
