---
description: "Right-edge Web drawer for the project verify queue: open, pin, and tick worktree-dev recorded fixes once they are on main."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-verify-queue

English | [中文](README.zh.md)

## Summary

This package adds a right-edge overlay to the Web GUI for the project verify queue. It mounts the generated `ctx.remote.verifyQueue` contribution, shows recorded worktree-dev fixes, refreshes whether their commits are on main, and lets you pin the drawer, tick accepted items, or remove them. It does not merge git branches. Official releases exclude it.

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

Install through [`@deepseek-ai/dsh-experimental-verify-queue-web-profile`](../verify-queue-web-profile/README.md). A collapsed handle sits on the right edge; opening it shows the list for the current session cwd. Pin keeps it open across reloads via `{workspace}/.dsh/verify-queue/ui.json`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export `$mount`s the generated Remote, registers locale dictionaries, and occupies `shell.overlay` with id `verify-queue`. The overlay layer is click-through except for this entry.

| File | Role |
|---|---|
| [`src/client/mount.ts`](src/client/mount.ts) | Remote, locale, and overlay registration |
| [`src/client/Drawer.tsx`](src/client/Drawer.tsx) | Handle and panel |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Verify-queue service](../verify-queue/README.md) — storage, git ancestor check, and the model tool.
- [Web profile layer](../verify-queue-web-profile/README.md) — source-checkout install.
- [Experimental packages](../README.md) — incubation status.

-----

<a id="model-experience"></a>
## Model Experience

None, as this overlay registers no model-facing input.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

- **Not on localhost:8100.** The drawer lives in the DSH window; verifying a UI fix still means looking at the running app beside this list.
- **No live git subscription.** Merge status refreshes on open, pin, explicit refresh, and mutations.
- **Does not open the recording session.** The list is a checklist, not a session switcher.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
