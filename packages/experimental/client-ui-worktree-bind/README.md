---
description: "Composer branch chip that binds a Web session to a .dsh/worktrees checkout without changing session cwd."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-worktree-bind

English | [中文](README.zh.md)

## Summary

This package puts a branch picker on the composer tool row. Picking or creating a branch asks the Host half to bind that session to a worktree under `.dsh/worktrees`. It does not switch the main checkout and does not add a sidebar workspace. Official releases exclude it.

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

Install through [`@deepseek-ai/dsh-experimental-worktree-bind-web-profile`](../worktree-bind-web-profile/README.md). The chip sits left of the composer, lists local branches, and has a name field for creating a new worktree branch.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Client export registers locale dictionaries and occupies `conversation.input.left` with id `worktree-bind`. It calls `/plugin/worktree-bind/*` on the same origin.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Locale and slot registration |
| [`src/client/Chip.tsx`](src/client/Chip.tsx) | Picker panel |
| [`src/client/api.ts`](src/client/api.ts) | Fetch helpers |
| [`src/index.ts`](src/index.ts) | Inert Host entry |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host routes and prompt](../worktree-bind/README.md)
- [Web profile layer](../worktree-bind-web-profile/README.md)

-----

<a id="model-experience"></a>
## Model Experience

None, as this chip registers no model-facing input. The Host package exposes `{{worktree}}` for presets that name it.

#### KV Cache effect

No direct effect.

## Known Limitations and Deferred Work

- **Same-origin fetch.** The chip talks to Host HTTP routes, not Typert Remote.
- **No live git subscription.** The list refreshes when the panel opens and after each mutation.
- **Locked after the first turn.** The overlay stays readable; select, create, and unbind are hidden.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
