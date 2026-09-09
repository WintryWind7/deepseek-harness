# Agent Note: Persist worktree-bind session bindings as project marker files

Status: implemented

[English](2026-09-09-worktree-bind-marker-persistence.md) | 中文

## Problem

`@deepseek-ai/dsh-experimental-worktree-bind` 此前把所有会话绑定放在一个按会话 id 键控的进程内 `Map` 里。重启 `dsh web` 会丢掉这个 Map，而会话和磁盘上的 worktree 都还在，于是 `{{worktree}}` 静默渲染为空、模型退回在会话 cwd 里改文件——在预设、芯片、提示词每一层都无法与「从未绑定」区分。模型应在绑定的 worktree 里工作这条约定本来就是提示词软约束，所以这类失败在任何环节都没有信号。

## Decision

绑定持久化为 `{cwd}/.dsh/worktree-bind/<sessionId>.json` marker 文件，内容是一条 `WorktreeBindSelection`（[src/markers.ts](../../../../packages/experimental/worktree-bind/src/markers.ts)）。变更在各自的落实点写 marker：`handleSelect`/`handleCreate` 只在 marker 写成功后才登记 store，写失败则整个变更失败，芯片永远不会报告一个重启后会丢的绑定。`handleClear` 删除 marker。`turn/start` 监听器在 `materializeBinding` 解析出真实路径后重写 marker；这次更新失败会留下旧的 `pending` marker，它只会在下次运行时无害地重新触发幂等的 materialize。

恢复是惰性的，因为 `systemPrompt.variable` 的 provider 是同步签名：会话在内存中没有条目时，第一次渲染提示词或 GET /state 会做一次带缓存的同步 marker 读取（[restoreBinding](../../../../packages/experimental/worktree-bind/src/routes.ts)）。合法 marker 回填 store；带未履行 `pending` 的 selection 跳过存在性检查，因为它的 worktree 此时本来就还不存在，下一轮 `turn/start` 会建树。恢复出的已落地绑定会做异步分支漂移复检，且只在明确不匹配（`currentBranch` 成功读出与记录不一致）时才降级，worktree 读不出时从不降级。

拒绝是响亮的而不是变空：绑定失效时 `{{worktree}}` 渲染一条中文警告，写明原因并告诉模型在用户重新绑定前不要在会话 cwd 里修改项目文件；GET /state 把同一原因放进 `error`，芯片面板本就会渲染它。「未绑定」和「绑定丢失」在两个界面上都是不同的状态。

## Alternatives considered

**把绑定记为 session 事件、从 JSONL 日志重建。** 实验阶段拒绝：`SessionEventMap` 条目会进入已发布会话格式契约及相邻迁移义务，而包形态仍可能变化，不成比例。marker 文件以项目局部作用域承载同样的事实。若本包转正出 `experimental/`，session 事件方案仍是正确的升级，同时还能补上 model-visible-⟺-logged 缺口（今天注入的路径无法从会话日志重建）。

**插件启动时扫描全部会话做异步恢复。** 拒绝：variable provider 无法 await；枚举会耦合 sessions 服务内部；而且绑定只在自己会话渲染或轮询时才重要——按会话惰性恢复恰好覆盖这些时刻，每次只是一次小文件读。

**不做持久化、只做丢失检测（绑定过的会话没有绑定时警告）。** 拒绝：重启后不存在任何「绑定过」的记录；没有持久化的检测与现状无法区分。

## Consequences

`dsh web` 重启不再丢选择：芯片下次轮询即显示恢复的绑定，模型下次请求即收到 worktree 路径。仍然发生的绑定丢失（worktree 被删、分支漂移、marker 损坏）会产生明确的模型可见警告和芯片错误，而不是静默退回 cwd。代价：assemble 路径上每个会话每进程一次同步小文件读；已删除会话的陈旧 marker 留在 `.dsh/worktree-bind/` 下需手动清理；内存 store 与 marker 文件靠构造一致（单一写入方、落实点写入）而非独立校验，因此本包仍不配 invariant companion。

## Testing

`tests/routes.spec.ts` 覆盖 marker 写入/恢复/清除、worktree 尚不存在时的 pending 恢复、路径缺失判失效并经 GET /state 露出原因、异步分支漂移降级、损坏 marker 处理。`tests/plugin.spec.ts` 用全新 Cordis context 模拟 Host 重启，断言恢复出的提示词文本与失效警告。
