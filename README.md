# Gewu Solution Audits

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