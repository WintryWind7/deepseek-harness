# @wintry/llm-continue

模型一轮只输出推理过程、没有给出最终答复时,代用户注入一条继续指令,让这一轮继续跑下去。按模型统计注入次数与恢复情况。

Host 半监听 `agent/turn-stopping`,Web 半在作曲栏统计行后加一个图标,打开后显示按模型的统计。

## 解决什么问题

某些模型(以及把模型包装成 Anthropic 协议的网关)会在推理之后直接结束这一轮:流里只有一个 `thinking` 块,没有 `text` 块,也没有 `tool_use` 块。DSH 的循环把"没有 tool-call"判为 turn 完成,于是这一轮就此收尾,用户看不到任何答复。

`llm-pi-ai` 的空回复防线只覆盖"一个内容块都没有":只要 `thinking` 块存在,`finish` 就是 `stop`,不会报 `EMPTY_RESPONSE`,也不会触发重试。这个插件补上这一段。

## 行为

监听 `agent/turn-stopping`——循环在该轮即将关闭时派发它。插件读本 turn 最后一条 `assistant/message`:

| 本 turn 最后一条 assistant 消息 | 动作 |
|---|---|
| `content` 只有 `reasoning` 块 | **注入一条继续指令** |
| `content` 为空 | 注入(双保险) |
| 含 `text` 块 | 跳过 |
| 含 `tool-call` 块 | 跳过 |
| `interrupted: true` | 跳过 |
| 本 turn 已注入达到上限 | 跳过 |

注入调用 `agent.steer()`,即往 next-step inbox 写一条 user 消息。循环随后重新读 inbox,发现有待处理的输入,于是再跑一步而不是关闭 turn。模型收到完整历史加这条引导语,由它自己补出正文。

引导语按次数递进:

- 第 1 次:`上一轮只输出了推理过程，没有给出最终答复。请直接给出结论；如需更多信息，请调用工具获取。`
- 第 2 次起:`你又一次只输出了推理过程而没有给出答复。请立即输出最终答复，不要继续推理。`

达到上限后第 6 次直接跳过,turn 正常关闭,该轮计为「未恢复」。

## 取消是安全的

用户点停止时不会自动重跑,这是由数据保证的,不依赖时序:

1. **取消路径到不了这个事件。** `agent-loop` 的 `agent.ts` 在 `:366` 的 catch 接住中止异常后直接 `throw`,跳过 `:359-363` 的 `turn-stopping` 派发;`:358` 和 `:361` 各有一次 `signal.throwIfAborted()` 作为闸门。
2. **取消过的轮次自带痕迹。** 中止时记录的 `assistant/message` 带 `interrupted: true`,插件不接管这种消息。
3. **回调入口再查一次 signal。** 已 abort 的 turn 直接返回。
4. **`cancel()` 默认清空 inbox。** 即使注入成功也会被丢弃。

## 恢复怎么算

一个 turn 注入多次、最终拿到正文,记**一个**恢复轮,不是多次。三次注入一次成功记 100%,不是 300%。

判定方式:注入后监听 `session/event`,同一 session 同一 turn 出现含非空 `text` 块的 `assistant/message` 时,把该 turn 的记录回填为 `recovered: true`。turn 关闭时仍未恢复的保持 `false`。

## 记录

每次注入一条 JSON,落在 `<dsh-home>/personal/llm-continue/continues/<sessionId>/<seq>.json`:

```jsonc
{
  "time": 1790000000000,          // 事件时间,时间窗口据此筛选
  "processStartedAt": 1790000000000,
  "sessionId": "session-...",
  "seq": 866,                      // 被判定那一步的 seq,同时是记录键
  "turn": 15,
  "step": 0,
  "attempt": 1,                    // 本 turn 内第几次注入,1..5
  "provider": "chattt",
  "model": "step-5-preview",
  "reasoningChars": 2140,          // 那条消息 reasoning 的总长度
  "recovered": false               // 回填
}
```

记录只写自己的目录,不写会话日志,不写 harness `storages`。

## 面板

挂在 `conversation.composer.dock`,和用量图标并排。四个时间窗口:本次启动、24 小时、7 天、累计。选中窗口后:

- **摘要行**:注入次数、涉及轮次、恢复轮次
- **按模型**:`provider / model` 一行,含注入次数、轮次、恢复、未恢复、恢复率、单轮最多注入次数。按注入次数降序,附恢复/未恢复占比条
- **最近记录**:时间、模型、第几次注入、第几轮、恢复与否

读一个鉴权 GET 路由 `/api/llm.continue`,每 2 秒拉一次。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖:

```yaml
- id: llm-continue
  config:
    enabled: true
    maxAttempts: 5
    prompt: '上一轮只输出了推理过程，没有给出最终答复。请直接给出结论；如需更多信息，请调用工具获取。'
    promptFirm: '你又一次只输出了推理过程而没有给出答复。请立即输出最终答复，不要继续推理。'
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 关掉后整个插件不接管任何轮次 |
| `maxAttempts` | `5` | 单个 turn 最多注入几次 |
| `prompt` | 见上 | 第 1 次注入的文案 |
| `promptFirm` | 见上 | 第 2 次起的文案 |

## 生命周期

`ctx.effect()` 注册:建目录、写 `process.json`、加载已有记录、注册 `agent/turn-stopping` 与 `session/event` 监听、注册读路由。插件卸载时全部反注册,内存中的 turn 计数清空。HMR 重载不会丢记录——它们在磁盘上。

## 模型可见影响

注入的那条消息是普通 user 消息,会进入历史并进入模型请求。模型会看到自己上一轮只输出了推理,以及一条要求给出答复的指令。除此之外不改变任何请求内容。

## 限制

- **治标不治本。** 如果模型连续 5 次都只输出推理,这一轮最终仍然没有答复。此时应关闭该模型的思考(例如把它的 `reasoningEfforts` 设为 `false`),而不是继续加注入次数。面板的「未恢复」列就是用来识别这种情况的。
- **上一轮的推理留在历史里。** 这是让模型"接着想"的必要代价,它占用 context 直到压缩。
- **只对 pi-ai 路线有效。** 判定读的是 `assistant/message` 的内容块,与 provider 无关;但注入依赖 `agent.steer()`,只有走 agent-loop 的会话才生效。
- **不判断答复质量。** 模型给了一句很短的正文也算恢复。
- **不记 token 消耗。** 用量由用量插件按 `assistant/message` 记录,这里不重复造口径。

## 已知上游缺口

`llm-pi-ai` 的 `mapStopReason` 用 `message.content.length === 0` 判定空回复,把"只有 reasoning"当成成功完成。更准确的判据是"没有用户可见内容"。上游修好之后,这个插件的注入会被官方重试覆盖,届时可以禁用。
