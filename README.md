# Open SolutionAssay（OSA）

OSA 是一个基于 OpenCode 的 solution 审核 agent。它接收一个任意形式的 solution repo，恢复其中要解决的问题，理解 solution 的声明和证据，并判断这个 solution 是否真正解决了问题。

solution repo 可以是 Git 仓库，也可以是普通文件夹；不要求固定文件名、目录结构、YAML 元数据或特定编程语言。问题和 solution 应该一起放在输入目录中。

## 用户安装

用户不需要 clone 本仓库，也不需要安装本仓库的 Node.js 依赖。发布版本提供独立安装脚本：

```bash
curl -fsSL https://raw.githubusercontent.com/a-green-hand-jack/open-solution-assay/main/install.sh | bash
```

安装脚本会安装 OSA 命令及其运行所需的 OpenCode 运行时。安装完成后检查环境：

```bash
osa doctor
```

如果当前项目尚未发布远程安装脚本，也可以在开发者工作树中执行 `./install.sh` 安装开发版本；这不是普通用户的推荐方式。

## 审核一个 solution repo

直接把路径交给 OSA：

```bash
osa /path/to/solution-repo
```

等价的显式形式：

```bash
osa audit /path/to/solution-repo
```

OSA 不会修改原始 solution repo。它会在独立的 run workspace 中复制、记录和冻结输入，并把最终审核文档写入：

```text
osa-runs/<run-id>/.assay/report/assay.md
```

命令结束时，终端会打印完整的 `report` 路径。你可以直接用编辑器打开它：

```bash
$EDITOR osa-runs/<run-id>/.assay/report/assay.md
```

如果忘记了 run 路径，可以列出所有最终审核文档：

```bash
find osa-runs -path '*/.assay/report/assay.md' -type f -print
```

每个报告都是独立的 Markdown 文档；最先阅读 `## Resolution`，然后阅读
`## Problem recovered`、`## What OSA established`、`## Shortfall`、
`## Verification agenda` 和 `## What was not checked`。

最终文档会说明：

- OSA 恢复出的原始问题；
- solution 声称完成的内容；
- 问题要求和 solution 声明的对应关系；
- 实际执行过的验证；
- 独立交叉检查结果；
- 已建立的支持和没有建立的支持；
- solution 是否完整解决、部分解决、无法验证或被反驳；
- 具体 shortfall；
- 需要人类专家继续检查的内容。

## 常用选项

只执行不需要模型的阶段：

```bash
osa /path/to/solution-repo --prepare-only
```

限制验证命令：

```bash
osa /path/to/solution-repo \
  --execute python-only \
  --exec-timeout 120000 \
  --max-commands 40
```

查看运行状态、重新校验或单独执行最终报告 gate：

```bash
osa status <run-workspace>
osa validate <run-workspace>
osa gate <run-workspace>
```

## 审核结果

OSA 不只输出 PASS/FAIL。Resolution 可能是：

```text
closed
declared-partial
narrowed
unsupported
unverifiable
contradicted
misaligned
unauditable
```

OSA 会把“solution 声称覆盖的范围”和“证据实际支持的范围”分开报告。没有发现反例不等于证明正确；无法机械闭合的证明步骤会列入人工验证清单。

## 开发者入口

Docker 是开发者用来模拟用户运行 OSA 的隔离环境。开发、构建、完整 agent E2E、文件修改影响和排错方法见 [`DEV.md`](DEV.md)。

本仓库保存 OSA 的源码、agent prompt、Docker 开发环境和审核协议，不保存大型 solution 数据集。真实评测 corpus 使用 Hugging Face 数据集 [`Jack-Jieke-Wu/Gewu-Solutions`](https://huggingface.co/datasets/Jack-Jieke-Wu/Gewu-Solutions)。
