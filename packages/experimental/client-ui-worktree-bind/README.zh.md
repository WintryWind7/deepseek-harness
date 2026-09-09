---
description: "输入框分支芯片：把 Web 会话绑定到 .dsh/worktrees 下的检出，不改变会话 cwd。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-worktree-bind

[English](README.md) | 中文

## 摘要

本包在输入框工具行放一个分支选择器。选择或新建分支会让 Host 半边把该会话绑定到 `.dsh/worktrees` 下的 worktree。它不会切换 main 检出，也不会在侧栏增加工作区。正式发布不含本包。

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

通过 [`@deepseek-ai/dsh-experimental-worktree-bind-web-profile`](../worktree-bind-web-profile/README.zh.md) 安装。芯片在输入框左侧，列出本地分支，并带有用于新建 worktree 分支的名称栏。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

Client 入口注册文案词典，并以 id `worktree-bind` 占用 `conversation.input.left`。它在同源上调用 `/plugin/worktree-bind/*`。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 文案与槽位注册 |
| [`src/client/Chip.tsx`](src/client/Chip.tsx) | 选择面板 |
| [`src/client/api.ts`](src/client/api.ts) | Fetch 辅助 |
| [`src/index.ts`](src/index.ts) | 空的 Host 入口 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Host 路由与提示词](../worktree-bind/README.zh.md)
- [Web profile 层](../worktree-bind-web-profile/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无，因为本芯片不注册面向模型的输入。Host 包提供 `{{worktree}}`，由写了该变量的预设使用。

#### KV Cache 影响

无直接影响。

## 已知限制与延后工作

- **同源 fetch。** 芯片走 Host HTTP 路由，不是 Typert Remote。
- **没有实时 git 订阅。** 列表在打开面板和每次变更后刷新。
- **第一轮开始后锁定。** 面板仍可查看；选择、新建和解绑隐藏。

-----

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
