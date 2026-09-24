# 个人预设

三个预设以官方 `standard` 的插件清单为底稿，这里只保存差异。`adapter.mjs` 每次注册时重新读取 `@deepseek-ai/dsh-web-app` 里的 `presets/standard.patch.yml`，套上差异后再注册。官方新加的工具会自动出现，除非写进 `omit`。

| 文件 | 预设 |
|---|---|
| `presets/main-dev.yml` | 开发助手 |
| `presets/project-planner.yml` | 项目规划助手 |
| `presets/screenshot-document.yml` | 真实网页文档助手 |
| `shared.yml` | 拼进每个个人预设的公共行配置，目前是压缩阈值 |

改这些 yml 后，Host 的 HMR 会重新注册。已经打开的会话仍用旧的一代，新会话用新内容。第一次换上这个中转要重启 Host。官方底稿变了也要重启后才会进来。新增加的 yml 文件要重启一次才会被监视。

`persona` 整段替换官方人设，不保留官方的 `suffix`。`omit` 按插件行 id 删掉一行，id 在底稿里不存在就启动失败。`rows.<id>.config` 浅合并，只钉住写出来的字段；`rows.<id>.disabled` 覆盖是否启用。`insert` 在某个官方行的 `before` 或 `after` 插入额外插件。写错键、找不到行、底稿读不到，都会报错。热重载失败时保留上一份成功的注册。

Web 里「查看配置」看到的是套用之后的完整清单，不是这些差异文件。
