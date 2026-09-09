---
description: "Add the experimental worktree-bind Host routes and composer chip to a source-checkout Web profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-worktree-bind-web-profile

English | [中文](README.zh.md)

## Summary

`dsh-experimental-worktree-bind-web-profile` is the private Web layer for session worktree binding. Add it after `@deepseek-ai/dsh-web-app` so the Host routes and composer chip mount together. Official releases exclude this package.

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

From this repository checkout, add the layer to an initialized `web` profile:

```sh
pnpm dsh plugin --profile web add ./packages/experimental/worktree-bind-web-profile
```

Removing the package with `dsh plugin --profile web remove @deepseek-ai/dsh-experimental-worktree-bind-web-profile` drops the bundle from the profile's ordered list.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The runtime content is [`cordis.patch.yml`](cordis.patch.yml). It inserts the Host `worktree-bind` row and the `ui-worktree-bind` Client row.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Host routes and prompt](../worktree-bind/README.md)
- [Composer chip](../client-ui-worktree-bind/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Host package's runtime context. This bundle adds no prompt text of its own.

#### KV Cache effect

This Web bundle adds no prompt content by itself.

## Known Limitations and Deferred Work

- **Does not uninstall third-party git-worktree plugins.** Remove `@laoyuehanni/dsh-git-worktree` separately if both chips would share the composer row.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
