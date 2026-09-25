# 个人设置 · 模型

注册进 [dsh-personal-settings](../dsh-personal-settings/README.md) 的模型配置页，id `models`。

和官方模型页读写同一份设置文档：

- `agent-default-model` 命名空间里的 `provider` / `model` / `reasoningEffort` — 默认模型
- provider 命名空间（loader 条目 id，例如 `llm-pi-ai`）里的 `providers/<id>/models` — 模型字段

每次只写 `models` 一个数组，不重建 provider 的其它字段，所以官方页在管的密钥、`baseURL`、`api` 都不受影响。写失败时 `settings/conflict` 提示返回再进入。

可改的模型字段：`name`、`contextWindow`、`maxTokens`、`reasoningEfforts`。档位按钮按 pi-ai 的集合（off、minimal、low、medium、high、xhigh、max）切换；新勾选的档位用档位名本身作为 wire 值，已声明的档位保留原值。全部取消勾选会删掉这个模型的 `reasoningEfforts`，让它回到内置目录的能力。

只列出已经声明 `models` 的 provider。列表来自 `remote.llm.listConfigurableProviders`，不带新增 provider、模型发现、凭据或删除——这些归官方页，或者归 profile 的 `cordis.patch.yml`。base 层（patch）声明的 provider 无法从设置里删除，只能改它的模型字段。
