---
description: "Bind a Web session to a Git worktree under .dsh/worktrees and inject that path into the system prompt, without changing session cwd or registering a workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-worktree-bind

English | [中文](README.zh.md)

## Summary

`dsh-experimental-worktree-bind` keeps the session cwd on the project's main checkout and, when the composer chip selects a branch, creates or reuses a linked worktree at `{cwd}/.dsh/worktrees/<name>`. It registers the prompt variable `{{worktree}}` with that absolute path (empty when unbound). A preset that does not mention the variable is unchanged. It does not `git switch` the main checkout and does not register a DSH workspace. Official releases exclude it.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Install through [`@deepseek-ai/dsh-experimental-worktree-bind-web-profile`](../worktree-bind-web-profile/README.md). The Host half serves `/plugin/worktree-bind/*` and registers `{{worktree}}`. Put that reference in a persona or section to receive the bound path. Bindings are per session id and persist as `{cwd}/.dsh/worktree-bind/<sessionId>.json` markers: after a `dsh web` restart, the session's next prompt render or chip poll restores the marker. A restored binding whose worktree path vanished or whose branch drifted is rejected loudly — `{{worktree}}` renders a warning and GET /state reports the reason — instead of silently falling back to the session cwd.

The composer chip only records the chosen name and a predicted path. `git worktree add` (or `add -b` for a new name) runs when the session's first turn starts, in parallel with that prompt. A branch already checked out in the opened project directory binds that path and skips git.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `{{worktree}}` variable and HTTP routes |
| [`src/routes.ts`](src/routes.ts) | Bind, create, list, clear, and restore handlers |
| [`src/markers.ts`](src/markers.ts) | Per-session marker files under `.dsh/worktree-bind/` |
| [`src/git.ts`](src/git.ts) | `worktree add` / list / branch names |
| [`src/prompt.ts`](src/prompt.ts) | Texts substituted for `{{worktree}}` |
| [`src/wire.ts`](src/wire.ts) | Route paths and JSON bodies |

No invariant companion: the in-memory store is written only through this module's own persist/restore path, so no independent observation can diverge from the marker files.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Composer chip](../client-ui-worktree-bind/README.md) — branch picker on the input row.
- [Web profile layer](../worktree-bind-web-profile/README.md) — source-checkout install.

-----

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The `{{worktree}}` substitution in any section that names it, while the calling session has a binding. Unbound or unused, the value is empty. When a persisted binding is rejected after a restart, the value is a loud warning telling the model not to edit in the session cwd:

```markdown
警告：本会话此前绑定的 Git Worktree 已失效（<reason>）。
当前会话没有绑定的 Worktree；在用户通过输入框芯片重新选择分支之前，不要在会话 cwd 里修改项目文件。
```

##### Verbatim text for this field, when needed

```markdown
当前会话的实际工作区是下面的 Git Worktree，不是会话 cwd（打开项目时的那份目录）。
Worktree 路径：<absolute-path>
分支：<branch>
会话 cwd 仍是打开项目时的目录，不会随 Shell 的 cd 改变。
项目内 read、write、edit、glob、grep、read_image 以及 pwsh/bash 默认使用上述 Worktree 的绝对路径，或把 workdir 设为该路径。
不要在会话 cwd 里改项目文件，除非用户明确要求就在打开项目的那份目录里改。项目外路径仍可用绝对路径读取。
```

#### Token effect

Conditional: empty when the session is unbound; absent from presets that omit `{{worktree}}`.

#### KV Cache effect

Binding or changing the worktree rewrites every section that interpolates `{{worktree}}` and can miss a cached prefix that included the previous path.

## Known Limitations and Deferred Work

- **No tool guard.** Relative paths still resolve against session cwd (the main checkout).
- **Lazy restore.** The marker is read back on the session's first prompt render or chip poll after a restart; the branch-drift recheck is asynchronous and downgrades only on a definitive mismatch.
- **Stale markers.** Markers of deleted sessions stay under `.dsh/worktree-bind/` until removed by hand.
- **Subagents do not inherit the binding.** A child session id has no store entry.
- **One checkout per branch.** The branch already on main cannot get a second worktree.
- **Locked after the first turn.** Select, create, and unbind fail once `turn/start` is on the session log.
- **First-turn race.** The first model request interpolates the predicted path while git may still be creating the tree.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
