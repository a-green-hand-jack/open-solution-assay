# OSA 开发者指南

本文说明如何构建 OSA 的 Docker 开发环境，以及如何在隔离容器中模拟用户使用 OSA，对真实 solution repo 运行完整 agent E2E。

## OSA 行为与代码映射

修改不同文件会改变不同层面的行为：

| 文件 | 影响的行为 |
|---|---|
| `src/cli.ts` | 用户命令、参数、默认值、exit code、状态和报告路径 |
| `src/controller.ts` | phase 顺序、OpenCode session 生命周期、失败/中断恢复和模型调用时机 |
| `src/input.ts` | 输入目录校验、复制、符号链接处理、缓存剔除和 source 只读冻结 |
| `src/inventory.ts` | 文件发现、hash、self-verdict、第三方内容和 shadow copy 分类 |
| `src/problem.ts` | 问题陈述、问题候选、外部 pin、rubric 和 resolution ceiling |
| `src/exec.ts` | reproduction 命令发现、执行策略、timeout、命令上限和执行记录 |
| `src/graph.ts` | claim/evidence 支撑关系、coverage 和机械 findings |
| `src/validation.ts` | phase artifact、最终报告结构、resolution、coverage 和 export gate |
| `src/assets.ts` | OpenCode permission、OSA agent 配置和 prompt 安装 |
| `src/phases.ts` | phase 协议、输出 artifact、报告章节和结论枚举 |
| `prompts/osa-audit.md` | agent 如何理解问题、solution、claim、证据、交叉检查和报告 |
| `docker/Dockerfile` | 容器中的 Node、OpenCode、Python、系统工具和依赖版本 |
| `docker/entrypoint.sh` | Docker 参数转发、当前源码构建和容器默认行为 |
| `docker-compose.yml` | 源码、输入、输出、OpenCode 配置、runtime 状态和网络挂载 |
| `install.sh` | 用户安装、构建和 CLI 链接方式 |
| `README.md` | 用户安装、使用和结果说明 |
| `DEV.md` | 开发者运行和评测说明 |

优先修改正确的层：运行安全问题改 TypeScript runtime，agent 判断问题改 prompt/workflow，环境问题改 Docker，用户命令问题改 CLI。不要为了修复 agent 判断而继续堆叠固定文件名 parser。

## 前置条件

- Docker Engine 和 Docker Compose v2；
- 可访问模型 provider 的 OpenCode 配置；
- 当前工作树已经包含 `package.json`、`src/`、`prompts/` 和 `docker/`；
- 一个 solution repo。它可以是 Git repo，也可以是普通文件夹；
- Node.js >= 20 只在宿主机运行本地 typecheck/build 时需要，容器内已提供 Node 22。

## 目录约定

```text
tasks/     solution repo 输入，只读挂载到 /data/tasks
runs/      OSA 输出，挂载到 /runs
src/       OSA TypeScript 实现，挂载到 /src/osa
prompts/   OSA agent prompt，挂载到 /src/osa/prompts
```

大型数据集不提交到本仓库。`Gewu-Solutions` 使用本机 HF cache 或其他外部目录挂载。

## 构建 Docker

```bash
docker compose build osa-dev
```

镜像包含：

- Node.js 22；
- OpenCode 固定版本；
- Git、Python 3 和 `python` 别名；
- `pdftotext`；
- OSA 需要的 Python 科学计算包；
- 从当前源码构建的 OSA CLI。

Compose 将当前工作树挂载到 `/src/osa`。每次容器启动时，`docker/entrypoint.sh` 都会重新构建当前工作树并执行当前版本，因此修改 `src/` 或 `prompts/` 后不需要重新发布 npm 包。

## 运行环境自检

```bash
docker compose run --rm osa-dev doctor
```

容器默认联网。OpenCode 配置以只读方式挂载：

```text
${HOME}/.config/opencode -> /root/.config/opencode:ro
```

OpenCode 的日志和 session 状态挂载到可写目录：

```text
${HOME}/.local/share/opencode -> /root/.local/share/opencode
```

这使容器中的 OSA 使用与用户本地 OpenCode 相同的 provider/model 配置，同时允许 OpenCode 正常写日志。不要对不可信容器使用该身份挂载方式。

## 运行单个 solution 的确定性 E2E

把 solution 放入 `tasks/` 后运行：

```bash
docker compose run --rm osa-dev /data/tasks/<solution-name> --prepare-only
```

该模式不调用模型，只执行 intake、problem、graph、execute 和 shortfall，用于快速检查输入隔离、文件发现、命令执行和确定性产物。

## 运行完整 agent E2E

完整流程不使用 `--prepare-only`：

```bash
docker compose run --rm osa-dev /data/tasks/<solution-name>
```

容器入口会自动：

1. 构建当前 OSA 源码；
2. 复制并冻结 solution repo；
3. 启动 OpenCode；
4. 运行 claims、crosscheck 和 report agent phases；
5. 运行确定性校验和 export gate；
6. 把完整 run workspace 写入 `runs/`。

最终报告：

```text
runs/<run-id>/.assay/report/assay.md
```

其他重要产物：

```text
runs/<run-id>/.osa-run/run.json
runs/<run-id>/.assay/raw/
runs/<run-id>/.assay/graph/
runs/<run-id>/.assay/exec/
```

## 使用 HF corpus

当前本机已缓存的 `Gewu-Solutions` snapshot 可以通过完整 cache 挂载，以保留 snapshot 到 `blobs/` 的符号链接：

```bash
HF_CACHE="$HOME/.cache/huggingface/hub/datasets--Jack-Jieke-Wu--Gewu-Solutions"

docker compose run --rm \
  -v "$HF_CACHE:/data/tasks:ro" \
  osa-dev \
  /data/tasks/snapshots/<revision>/<solution-name>
```

不要只挂载 `snapshots/<revision>`；HF snapshot 中的文件可能是指向同一个 cache 下 `blobs/` 的符号链接。只挂载 snapshot 会导致输入文件无法解析。

如果使用本仓库的 `tasks/`，直接挂载 `./tasks:/data/tasks:ro` 即可。

## 开发者验证

每次修改后至少运行：

```bash
npm run typecheck
npm run build
bash -n install.sh docker/entrypoint.sh
docker compose config
```

然后运行一个真实 solution 的 `--prepare-only` 和完整 agent E2E。完整 E2E 不是只检查 CLI 退出码，而是确认 OSA agent 确实被调用并完成 judgment phases。重点检查：

- 所有 phase 是否完成；
- `.assay/report/assay.md` 是否存在；
- report 的 Resolution、claim reach、established support 是否有依据；
- shortfall 和 verification agenda 是否具体；
- source 是否没有被修改；
- Docker 和本地 CLI 是否使用同一套核心流程。

确认 agent 被真实调用的方法：

1. 不使用 `--prepare-only`；
2. 日志中应出现 `claims (model)`、`crosscheck (model)` 和 `report (model)`；
3. `.osa-run/run.json` 中这三个 phase 的状态应为 `completed`；
4. `.assay/raw/02_claims.md`、`.assay/raw/05_crosscheck.md` 和 `.assay/report/assay.md` 应存在；
5. `.assay/report/assay.md` 必须包含 Resolution、Claims and typing、What OSA established、Shortfall 和 What was not checked；
6. 报告中的结论必须引用输入文件、执行记录或 OSA 生成的验证结果，而不是只复述作者 verdict。

完整 E2E 的成功条件是“得到可读、可追踪的审核文档”，不是“solution 被判定为正确”。`unsupported`、`unverifiable` 或 `contradicted` 都可能是正确的审核结果。

## 常见问题

### OpenCode server 退出并提示 `opencode.log`

确认 `${HOME}/.local/share/opencode` 已挂载为可写，而不是 `:ro`。OpenCode 正常运行需要写日志和 session 状态。

### 报告没有生成

先查看：

```bash
osa status runs/<run-id>
```

如果 phase 在 `claims`、`crosscheck` 或 `report` 失败，检查同一 run 下的 `.osa-run/run.json` 和 `.opencode/` 运行日志。没有完成 `report` phase 时，`.assay/report/assay.md` 不应被当作存在。

### 输入文件数量为 0

优先检查是否只挂载了 HF snapshot 而没有挂载其父级 cache。对于普通 Git repo 或普通文件夹，也检查输入目录是否为空以及是否包含断开的符号链接。

### 完整流程超时

先用 `--prepare-only` 验证确定性阶段，再降低样本规模或增加 phase timeout：

```bash
docker compose run --rm osa-dev /data/tasks/<solution-name> \
  --timeout 1800000 \
  --exec-timeout 45000 \
  --max-commands 20
```

agent 超时表示运行失败，不是 solution 的审核结论。
