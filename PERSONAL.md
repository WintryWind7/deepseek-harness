# 个人 Fork 开发边界

本文适用于 `WintryWind7/deepseek-harness` 的 `personal` 分支，用于规定不对外发布、直接从当前源码仓库运行的个人插件和二开功能应放在哪里，以及 Agent 可以在什么范围内行动。本文不是自动执行清单；与个人开发有关的授权边界以本文为准。

## 用户授权

实现用户明确要求的功能时，可以在当前 `personal` 工作区修改必要的源码、测试和文档，并运行能够验证该功能的最小检查。验证通过不代表可以自动提交、推送、安装或同步。

只有用户明确要求对应操作时，才可以创建 Git commit、推送远端、创建或切换分支、安装或链接插件到 `C:\Users\Administrator\.dsh`、修改本机 profile、同步官方上游，或者删除与当前任务无关的文件。不要把“整理仓库”“完成开发”或本文中的参考命令解释为这些操作的默认授权。

## 分支

`master` 只用于同步 `upstream/master`，不放个人功能。`personal` 是个人开发和日常运行的默认分支。

所有个人插件和二开改动都直接写在 `personal` 工作区，不创建额外功能分支。只有用户明确要求提交或推送时，才把当前改动提交到 `personal` 或推送到 `origin/personal`。

## 私有插件

个人插件放在 `packages/experimental/<name>/`。每个可以独立使用的功能对应一个包；`packages/experimental/personal-web-all/` 可以统一聚合这些插件，但不承载具体业务实现。

实验包使用 `@deepseek-ai/dsh-experimental-*` 名称前缀，设置 `private: true`，不进入官方发布包。不要把个人插件加入 `packages/bundle/web-app` 或其他官方 bundle。个人聚合包和本机 profile composition 是可选的运行接入方式；只有用户明确要求安装、链接或启用插件时，才修改 `C:\Users\Administrator\.dsh`。

插件实现、测试、样式、包配置和包文档应放在对应插件目录。任务需要新增 workspace 包时，可以同时修改必要的根 TypeScript aggregate、`pnpm-lock.yaml`、`packages/experimental/README` 中英文索引及配对记录、生成的依赖文档和直接相关的测试 fixture。

不要为了实现个人功能而直接修改官方产品包。如果现有扩展点无法支持功能，先说明缺少的扩展点和需要修改的官方文件；用户接受该范围后，再实现最小且可复用的扩展点，并把个人功能保留在实验包中。

## 本机运行文件

`C:\Users\Administrator\.dsh` 保存本机 profile、已安装的第三方插件、凭据、设置、会话和运行状态。这些机器配置和运行数据不复制进本仓库，也不提交到 Git；没有用户明确要求时不修改。

`C:\Users\Administrator\.dsh\.agent-presets` 是指向 `personal/agent-presets/` 的目录 Junction。个人 preset、附带 Skill 和辅助脚本以仓库文件为准；通过全局路径创建或修改预设时，改动直接落入当前 `personal` 工作区。修改后的 composition 供后续新会话使用，已经运行的会话继续使用启动时挂载的版本。

截图、诊断脚本、日志和其他临时文件放在系统临时目录，不放进源码仓库。发现意外生成的仓库文件时先报告来源；只清理当前任务创建的临时文件或用户明确确认删除的文件，不删除无关的已跟踪或未跟踪内容，也不用宽泛忽略规则隐藏异常来源。

## 暂存和提交

本节只在用户明确要求创建 commit 时适用。不要使用 `git add .`；只暂存明确的插件和登记文件路径，提交前检查 `git diff --cached --name-only` 和 `git diff --cached`，确保无关的已跟踪文件、未跟踪文件、生成文件和本机文件没有进入提交。

提交说明保持聚焦，例如 `feat(experimental): add conversation enhancements`、`fix(experimental): restore usage totals` 和 `docs(personal): clarify fork rules`。可复用的 DSH 扩展点改动与私人插件业务实现使用不同提交。

## 文档和 Agent Note

每个个人插件都维护准确的包 README，说明配置、行为、生命周期、限制和模型可见影响。代码行为变化时，同步更新相关 JSDoc 和生成文档。

只修改单个个人私有插件时不要求编写 Agent Note。修改官方 DSH 包、跨包共享 API、持久化或 wire 数据、配置格式、仓库流程，或者作出未来维护时仍需理解其取舍的重要设计决策时，才新增或更新 Agent Note。没有新增 Agent Note 时，仍可把仓库现有 Agent Note 作为设计参考。

## 验证

实现任务时运行能够覆盖当前改动的最小测试和检查。浏览器可见改动必须进行真实页面的功能和视觉验证；包清单、aggregate 或构建相关改动必须运行对应的 typecheck、build 和仓库检查。默认不运行完整测试套件，除非用户明确要求或改动确实无法缩小验证范围。

验证完成后报告改动、检查结果和当前 Git 状态，不自动提交、推送或安装。

## 用户要求时同步上游

只有用户明确要求并指定目标版本、标签或 commit 时才同步官方上游；发现新版本、版本跨度较大或本文提供了命令都不构成同步授权。用户只要求查看更新或评估冲突时不得应用改动或创建 commit；用户明确要求执行同步到指定目标时，才创建本节规定的单个同步 commit，但不自动推送任何远端。

`master` 只跟踪用户本次选定的官方目标，不放个人改动。同步前要求 `personal` 工作区干净，通过 `upstream` 获取官方 refs，保存移动前的 `master` commit 作为前一官方基线，确认目标是它的后继，然后在不切换 checkout 的情况下先把本地 `master` 引用推进到目标。当前 checkout 始终保持在 `personal`，因为本机 Agent preset 的 Junction 指向当前工作区中的 `personal/agent-presets/`。

只把前一官方基线到新 `master` 之间的树差异以三方方式应用到 `personal`。逐个检查冲突，不得对整份文件盲目选择 ours 或 theirs：官方架构、公共包和正式数据格式以目标版本为基础，个人插件、预设和本文规定的行为按新架构重新适配。冲突解决后运行覆盖受影响范围的最小检查，并检查暂存内容；检查失败或冲突未解决时不创建同步提交。

每次成功同步只在 `personal` 创建一个汇总提交，例如 `chore(upstream): sync dsh 0.1.1 to 0.1.2`；该提交是前一官方基线到目标之间全部变化的 squash 结果。上游范围内的单个 commit 不进入 `personal` 的祖先历史。同步提交正文使用 `Upstream-From` 和 `Upstream-To` trailer 记录精确官方 commit；它们不是备份，而是 `personal` 已经吸收的官方区间书签，供同步中断恢复和后续增量核对。推送 `origin/master` 或 `origin/personal` 仍需用户另行明确要求。

以下命令只说明增量压缩机制，不授权执行。`<目标官方 ref>` 和提交说明中的版本必须使用用户指定的实际值；冲突解决、暂存路径和验证命令按本次变化决定。

```powershell
git fetch upstream --tags
$previous = git rev-parse master
$target = git rev-parse '<目标官方 ref>'
git merge-base --is-ancestor $previous $target
if ($LASTEXITCODE -ne 0) { throw '目标官方 ref 不是当前 master 基线的后继' }
git update-ref refs/heads/master $target $previous
$patch = Join-Path $env:TEMP 'dsh-upstream-sync.patch'
git diff --binary --full-index --output=$patch $previous $target
git apply --3way --index $patch
# 逐个解决冲突，运行相关检查，并检查 git diff --cached
git commit -m 'chore(upstream): sync dsh <上一版本> to <目标版本>' `
  -m "Upstream-From: $previous`nUpstream-To: $target"
Remove-Item -LiteralPath $patch
```

如果用户同时明确要求推送，在本地同步提交和基线更新都成功后，再分别推送 `master` 和 `personal`；同步请求本身不授权 push。
