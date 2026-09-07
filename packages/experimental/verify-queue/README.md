---
description: "Project verify queue: worktree-dev records committed fixes under .dsh/verify-queue/, and readers check whether those commits are already on main."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-verify-queue

English | [中文](README.zh.md)

## Summary

`dsh-experimental-verify-queue` stores a per-project list of worktree-dev fixes so you can later check that their commits are on `main` and tick them off on the running app. Worktree-dev chooses what to record by calling `verify_queue_record` after a commit. The service never merges. Mount the Host plugin on the Web profile, the `./tool` entry on the worktree-dev preset, and the sibling Web drawer to see the list.

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

Choose this experimental package when worktree-dev sessions should leave a durable checklist in the project tree. Skip it when every fix is merged and verified in the same session that made it.

Records live at `{workspace}/.dsh/verify-queue/`. Each item has a title, the recording session id, and one or more commit SHAs. Status is derived on read: `recorded` until every SHA is an ancestor of `refs/heads/main` (or `master`), `on-main` after that, `verified` after a human ticks it.

The model-facing tool is `@deepseek-ai/dsh-experimental-verify-queue/tool`. Add that row only to the worktree-dev preset. Omit `commits` to record the session worktree HEAD (`.dsh/worktrees/<sessionId>` when it exists).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`VerifyQueue` is a `TypertRemoteService` (`ctx.verifyQueue`, namespace `verifyQueue`). Remote methods are `view`, `setVerified`, `removeItem`, and `setUi`. `record` is in-process only, used by the tool. Git checks use `git merge-base --is-ancestor`. The wire name is `removeItem` because Client Remote methods cannot be called `remove` — that name belongs to the Cordis Service prototype.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Service and Remote methods |
| [`src/tool.ts`](src/tool.ts) | `verify_queue_record` |
| [`src/store.ts`](src/store.ts) | `items.json` and `ui.json` |
| [`src/git.ts`](src/git.ts) | HEAD and ancestor checks |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web drawer](../client-ui-verify-queue/README.md) — right-edge overlay.
- [Web profile layer](../verify-queue-web-profile/README.md) — install into a source-checkout Web profile.

-----

<a id="model-experience"></a>
## Model Experience

### Request context and condition

#### What the model sees

The `verify_queue_record` tool, when the worktree-dev preset mounts `./tool`.

##### Verbatim text for this field, when needed

```markdown
Record one committed worktree fix on the project verify queue so it can later be checked against main and accepted on the running app. Call this only after the fix is committed on this session's worktree branch. title is a short reminder of what to look at (the bug or UI change). Omit commits to record this worktree HEAD. Do not record planning work, uncommitted edits, or screenshot-only sessions.
```

#### Token effect

Conditional: the tool schema is present only while the worktree-dev preset mounts `./tool`.

#### KV Cache effect

Independent of Host queue reads. Adding the tool to a preset changes that preset's tool catalog prefix.

## Known Limitations and Deferred Work

- **No merge.** The service only reads whether recorded commits are already on main.
- **main or master only.** Other default-branch names fail the ancestor check.
- **Worktree-dev must call the tool.** Nothing is recorded from the first user message alone.
- **Remote method names.** `remove` cannot be a Client Remote method; the drawer calls `removeItem`.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
