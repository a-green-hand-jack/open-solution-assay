# Gewu Solution Audits

## 使用 OSA

OSA 接受任意非空 solution repository。输入可以是 Git repository，也可以是
普通文件夹；不要求固定文件名或目录结构。输入目录应同时包含待解决的问题、
solution 以及可提供的证明、实验、证书或验证代码。

在源码目录安装开发版本：

```bash
./install.sh
```

审查一个 solution：

```bash
osa ./path/to/solution-repo
```

等价的脚本形式是：

```bash
osa audit ./path/to/solution-repo
```

OSA 会复制并冻结输入，不会修改原始目录。报告写入 timestamped run 下的
`.assay/report/assay.md`。不调用模型、只运行确定性阶段时使用：

```bash
osa ./path/to/solution-repo --prepare-only
```

## 开发与验证

Docker 是开发运行时，不是另一套 OSA 实现：

```bash
docker build -f docker/Dockerfile -t osa-dev .
docker run --rm -it \
  -v "$PWD:/src/osa" \
  -v "$PWD/tasks:/data/tasks:ro" \
  -v "$PWD/runs:/runs" \
  osa-dev /data/tasks/example --prepare-only
```

Docker 入口会构建绑定的 `/src/osa`，然后调用与本地相同的 OSA CLI。

也可以使用 Compose 直接模拟安装后的用户行为。Compose 默认联网，并以只读方式
挂载开发者的 OpenCode 配置和运行状态；配置只读，运行状态允许写入日志和 session。
不要把这个配置挂载方式用于不可信的容器：

```bash
docker compose run --rm osa-dev /data/tasks/example --prepare-only
```

输入从 `./tasks` 只读挂载，运行结果写入 `./runs`。修改 `src/` 或 `prompts/`
后重新执行即可验证当前工作树。

开发者验证基础设施：

```bash
npm run typecheck
npm run build
bash -n install.sh docker/entrypoint.sh
```

Central repository for auditing **accepted solution repositories** harvested
from the Gewu Lab problem journal (`git.gewu-lab.ai`).

The audit target is the private HF snapshot dataset
[`Jack-Jieke-Wu/Gewu-Solutions`](https://huggingface.co/datasets/Jack-Jieke-Wu/Gewu-Solutions)
(39 solution directories, harvested 2026-09-03, covering
`journal-mathematics-a` and `journal-physics-a`). This repository holds the
audit *process* — checklists, review-report templates, per-solution reviews,
and aggregate summaries. Source repositories and data are not vendored here;
the dataset is the single source of truth.

## Audit process

Each solution is audited in 8 steps:

1. **Binding audit** — directory name, `solution.yaml`
   (`problem_project_id` / `problem_sha`), README `### Problem References`,
   and the source commit on `git.gewu-lab.ai` must agree; verify
   `artifacts/SHA256SUMS-*` where present.
2. **Rubric + claims** — read `docs/evaluation-rubric.md` (the acceptance
   criteria) and extract the core claim + scope from the README.
3. **Completeness** — standard six-file template
   (README `SOLUTION.md` `problem.yaml` `solution.yaml` `VALIDATION.md`
   `WORKLOG.md`) plus `docs/` `paper/` `artifacts/`; record deviations.
4. **Mathematical / physical correctness** — line-by-line review of
   `SOLUTION.md` (definitions, quantifiers, inferences, conclusions);
   for witnesses/counterexamples, substitute every object into the premises
   and verify the claimed property exactly.
5. **Reproducibility** — execute the Reproduction column of `VALIDATION.md`
   and compare Expected vs Observed. Floating-point evidence alone is not
   terminal; exact arithmetic / combinatorial certificates /
   independently replayable checks are required.
6. **Independent cross-check** — do not rely on author-written scripts
   verifying author-written certificates. Pin hashes, re-derive, and run
   adversarial checks (boundary values, degenerate cases, minimal
   counterexample search, finite→universal transitions).
7. **Boundary & paper consistency** — claims must not exceed stated
   assumptions ("Open Questions" reflects real gaps); `paper.pdf` must agree
   with `SOLUTION.md`.
8. **Report** — one report per solution (see `templates/`) plus an aggregate
   39-row summary table under `reports/`.

Constraint that applies to every step: the independent checker validates
the supplied certificate; it does **not** replace human (or independent
agent) mathematical review of the proof narrative.

## Structural groups (from the 2026-09-03 snapshot)

| Group | Meaning | Dirs | Audit emphasis |
|---|---|---|---|
| A | standard template (full six-file set) | 24 | full 8-step flow |
| B1 | template minus `problem.yaml` (mapping-cone batch: p1014, p19795, p305, p308, p314, p324, p331, p340, p341) | 9 | binding via README refs + reverse lookup; batch review |
| B3 | canonical YAMLs, no SOLUTION/VALIDATION/WORKLOG (p2113) | 1 | correctness from `experiments/` + write-up |
| B4 | no YAML metadata: Ch.S ×2, kun-agent p17208, p3535 | 4 | audit via each repo's own `problem/` `proof/` `verification/` `audit/` `manuscript/` structure |
| B2 | raw workbench dump (lewton-agent kerrDeflection) | 1 | paper `.tex`/`.pdf` as primary object; independently build the claim list |

## Repository layout

```
templates/          review-report template + audit checklist
reports/            per-solution review reports + aggregate summary table
```

## Status

Initialized. Audit run order proposed: B1 (batch, isomorphic) → Group A
focused papers → B4/B2 (special cases).
