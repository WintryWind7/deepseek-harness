# 个人设置 · 模型

注册进 [@wintry/settings](../settings/README.md) 的模型配置页，id `models`。

和官方模型页读写同一份设置文档，位置是 provider 命名空间（loader 条目 id，例如 `llm-pi-ai`）里的 `providers/<id>/models`。不读写 `agent-default-model`，也不写模型或提供方的默认思考档位。保存按钮在外壳面包屑那一行的最右边，一次写下所有已改的提供方的 `models` 数组；旁边用红字显示未保存的字段数。密钥、`baseURL`、`api` 都不碰。写失败时 `settings/conflict` 提示返回再进入。

可改的模型字段：`name`、`contextWindow`、`maxTokens`、`reasoningEfforts`、`input`。开放档位是两列勾选，只提供 off、low、medium、high、xhigh、max；新勾选的档位用档位名本身作为 wire 值，已声明的档位保留原值，这六个以外已经存着的档位（例如 minimal）保存时原样留下。这六个都取消、且没有其它已存档位时，删掉 `reasoningEfforts`，让模型回到内置目录的能力。输入类型同样是勾选，只有 text 和 image；都不勾选则不写 `input`，沿用目录。每条模型默认收起，展开后才显示这些字段。

只列出已经声明 `models` 的 provider。列表来自 `remote.llm.listConfigurableProviders`，不带新增 provider、模型发现、凭据或删除——这些归官方页，或者归 profile 的 `cordis.patch.yml`。base 层（patch）声明的 provider 无法从设置里删除，只能改它的模型字段。
