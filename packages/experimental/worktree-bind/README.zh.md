---
description: "把 Web 会话绑定到 .dsh/worktrees 下的 Git worktree，并把该路径注入系统提示词；不改变会话 cwd，也不登记工作区。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree-bind

[English](README.md) | 中文

## 摘要

`dsh-experimental-worktree-bind` 让会话 cwd 留在项目的 main 检出上；当输入框芯片选中一个分支时，在 `{cwd}/.dsh/worktrees/<name>` 创建或复用一棵链接 worktree，并把该绝对路径注册为提示词变量 `{{worktree}}`（未绑定时为空）。预设里不写这个变量就不会被改到。它不会对 main 检出执行 `git switch`，也不会登记 DSH 工作区。正式发布不含本包。

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

通过 [`@deepseek-ai/dsh-experimental-worktree-bind-web-profile`](../worktree-bind-web-profile/README.zh.md) 安装。Host 半边提供 `/plugin/worktree-bind/*`，并注册 `{{worktree}}`。把该引用写进 persona 或 section 才会收到绑定路径。绑定按会话 id 存放，并持久化为 `{cwd}/.dsh/worktree-bind/<sessionId>.json` marker：`dsh web` 重启后，该会话下一次渲染提示词或芯片轮询会恢复 marker。恢复出的绑定若 worktree 路径已消失或分支已漂移，会被响亮地拒绝——`{{worktree}}` 渲染警告、GET /state 给出原因——而不是静默退回会话 cwd。

输入框芯片只记下所选名字和预估路径。真正的 `git worktree add`（新建则为 `add -b`）在会话第一轮 `turn/start` 时与该次提示词并行执行。若该分支已在打开项目的那份目录检出，则绑定该路径并跳过 git。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `{{worktree}}` 变量与 HTTP 路由 |
| [`src/routes.ts`](src/routes.ts) | 绑定、创建、列表、清除与恢复处理 |
| [`src/markers.ts`](src/markers.ts) | `.dsh/worktree-bind/` 下按会话的 marker 文件 |
| [`src/git.ts`](src/git.ts) | `worktree add` / 列表 / 分支名 |
| [`src/prompt.ts`](src/prompt.ts) | 替换 `{{worktree}}` 的文本 |
| [`src/wire.ts`](src/wire.ts) | 路由路径与 JSON 请求体 |

没有 invariant companion：内存 store 只经由本模块自己的 persist/restore 路径写入，不存在能与 marker 文件产生分歧的独立观察。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [输入框芯片](../client-ui-worktree-bind/README.zh.md) — 输入行上的分支选择器。
- [Web profile 层](../worktree-bind-web-profile/README.zh.md) — 源码 checkout 安装。

-----

<a id="model-experience"></a>
## 模型体验

### 请求上下文与条件

#### 模型可见内容

写了 `{{worktree}}` 的段落在调用方会话已绑定时的替换值。未绑定或未引用时为空。重启后恢复的绑定被拒绝时，替换值是一条响亮警告，告诉模型不要在会话 cwd 里修改：

```markdown
警告：本会话此前绑定的 Git Worktree 已失效（<reason>）。
当前会话没有绑定的 Worktree；在用户通过输入框芯片重新选择分支之前，不要在会话 cwd 里修改项目文件。
```

##### 本字段的逐字文本（如需要）

```markdown
当前会话的实际工作区是下面的 Git Worktree，不是会话 cwd（打开项目时的那份目录）。
Worktree 路径：<absolute-path>
分支：<branch>
会话 cwd 仍是打开项目时的目录，不会随 Shell 的 cd 改变。
项目内 read、write、edit、glob、grep、read_image 以及 pwsh/bash 默认使用上述 Worktree 的绝对路径，或把 workdir 设为该路径。
不要在会话 cwd 里改项目文件，除非用户明确要求就在打开项目的那份目录里改。项目外路径仍可用绝对路径读取。
```

#### Token 影响

有条件：会话未绑定时为空；预设未写 `{{worktree}}` 则不受影响。

#### KV Cache 影响

绑定或更换 worktree 会改写所有插值 `{{worktree}}` 的段落，可能使包含上一路径的缓存前缀失效。

## 已知限制与延后工作

- **没有工具 guard。** 相对路径仍相对会话 cwd（main 检出）解析。
- **惰性恢复。** marker 在重启后该会话第一次渲染提示词或芯片轮询时读回；分支漂移复检是异步的，只在明确不匹配时才降级。
- **陈旧 marker。** 已删除会话的 marker 留在 `.dsh/worktree-bind/` 下，需手动清理。
- **子 Agent 不继承绑定。** 子会话 id 在 store 中没有条目。
- **每个分支只能有一次检出。** 已在 main 上的分支不能再开第二棵 worktree。
- **第一轮开始后锁定。** 会话日志出现 `turn/start` 后，选择、新建和解绑都会失败。
- **第一轮竞态。** 第一次模型请求会插值预估路径，此时 git 可能仍在建树。

-----

<a id="dev-note"></a>
### 开发笔记

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
