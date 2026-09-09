# Agent Note: Persist worktree-bind session bindings as project marker files

Status: implemented

English | [中文](2026-09-09-worktree-bind-marker-persistence.zh.md)

## Problem

`@deepseek-ai/dsh-experimental-worktree-bind` kept every session binding in one in-process `Map` keyed by session id. Restarting `dsh web` dropped the map while sessions and on-disk worktrees survived, so `{{worktree}}` silently rendered empty and the model fell back to editing the session cwd — indistinguishable from a never-bound session at every layer (preset, chip, prompt). The contract that the model work in the bound worktree is a soft prompt instruction, so the failure had no signal anywhere.

## Decision

Bindings persist as `{cwd}/.dsh/worktree-bind/<sessionId>.json` marker files holding one `WorktreeBindSelection` ([src/markers.ts](../../../../packages/experimental/worktree-bind/src/markers.ts)). Mutations write the marker at their commit point: `handleSelect`/`handleCreate` store the selection only after the marker write succeeds, and a write failure fails the mutation, so the chip never reports a binding a restart would drop. `handleClear` deletes the marker. The `turn/start` listener rewrites the marker after `materializeBinding` resolves the real path; a failed update leaves the stale `pending` marker, which harmlessly retriggers the idempotent materialize on the next run.

Restore is lazy because the `systemPrompt.variable` provider is synchronous: the first prompt render or GET /state for a session with no in-memory entry performs one cached synchronous marker read ([restoreBinding](../../../../packages/experimental/worktree-bind/src/routes.ts)). A valid marker refills the store; a selection with unfulfilled `pending` skips the existence check because its worktree legitimately does not exist yet, and the next `turn/start` materializes it. A restored materialized binding gets an asynchronous branch-drift recheck that downgrades it only on a definitive mismatch (a successful `currentBranch` disagreeing with the record), never on an unreadable worktree.

Rejection is loud instead of empty: a lost binding makes `{{worktree}}` render a Chinese warning naming the reason and telling the model not to edit project files in the session cwd until the user re-binds, and GET /state returns the same reason in `error`, which the chip panel already renders. "Unbound" and "binding lost" are distinct states at both surfaces.

## Alternatives considered

**Record the binding as a session event and rebuild from the JSONL log.** Rejected for the experimental stage: a `SessionEventMap` entry joins the released session-format contract with adjacent-migration obligations, which is disproportionate while the package may still change shape. The marker file carries the same facts with project-local scope. The session-event design remains the right upgrade if the package promotes out of `experimental/`, which would also close the model-visible-⟺-logged gap (the injected path is not reconstructable from the session log today).

**Restore asynchronously on plugin start by scanning all sessions.** Rejected because the variable provider cannot await, enumeration would couple the plugin to sessions-service internals, and a binding matters only when its own session renders or polls — lazy per-session restore covers exactly those moments with one small read each.

**Detect loss without persistence (warn when a bound-looking session has no binding).** Rejected because there is no record of "bound-looking" after a restart; detection without persistence is indistinguishable from the status quo.

## Consequences

A `dsh web` restart no longer drops selections: the chip shows the restored binding on its next poll and the model receives the worktree path in its next prompt. Binding loss that does occur (deleted worktree, drifted branch, corrupt marker) produces an explicit model-facing warning and chip error instead of silent cwd fallback. Costs: one synchronous small-file read per session per process lifetime on the assemble path; stale markers of deleted sessions accumulate under `.dsh/worktree-bind/` until removed by hand; the in-memory store and marker files stay consistent by construction (single writer, commit-point writes) rather than by an independent check, so the package keeps no invariant companion.

## Testing

`tests/routes.spec.ts` covers marker write/restore/clear, pending-before-worktree restore, lost-on-missing-path with the reason surfaced through GET /state, asynchronous branch-drift downgrade, and corrupt-marker handling. `tests/plugin.spec.ts` simulates a Host restart with a fresh Cordis context and asserts the restored prompt text and the lost warning.
