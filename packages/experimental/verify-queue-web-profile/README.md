---
description: "Add the experimental verify-queue Host service and right-edge drawer to a source-checkout Web profile."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-verify-queue-web-profile

English | [中文](README.zh.md)

## Summary

`dsh-experimental-verify-queue-web-profile` is the private Web layer for the project verify queue. Add it after `@deepseek-ai/dsh-web-app` so the Host service and right-edge drawer mount together. Official releases exclude this package.

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
pnpm dsh plugin --profile web add ./packages/experimental/verify-queue-web-profile
```

Mount `@deepseek-ai/dsh-experimental-verify-queue/tool` on the worktree-dev preset so that agent can record items. Removing the package with `dsh plugin --profile web remove @deepseek-ai/dsh-experimental-verify-queue-web-profile` drops the bundle from the profile's ordered list.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The runtime content is [`cordis.patch.yml`](cordis.patch.yml). It inserts the Host `verify-queue` service and the `ui-verify-queue` Client row.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Verify-queue service](../verify-queue/README.md)
- [Web drawer](../client-ui-verify-queue/README.md)

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the worktree-dev preset's `./tool` row. This bundle adds no model request content by itself.

#### KV Cache effect

This Web bundle adds no prompt content.

## Known Limitations and Deferred Work

- **Tool is not in this layer.** The Host service is process-global; `verify_queue_record` still has to be composed on worktree-dev.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
