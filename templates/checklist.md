# Audit checklist — <solution-dir>

- [ ] **0. Preparation**: `MANIFEST.md` entry recorded (problem, source URL, commit)
- [ ] **1. Binding**
  - [ ] dir name ↔ MANIFEST commit
  - [ ] `solution.yaml` `problem_project_id` / `problem_sha` matches
  - [ ] README `### Problem References` link + title matches
  - [ ] `artifacts/SHA256SUMS-*` verify (where present)
- [ ] **2. Rubric & claims**
  - [ ] `docs/evaluation-rubric.md` read; acceptance criteria recorded
  - [ ] Core claim + scope extracted from README
- [ ] **3. Completeness**
  - [ ] standard template files present (`README.md` `SOLUTION.md` `problem.yaml` `solution.yaml` `VALIDATION.md` `WORKLOG.md`)
  - [ ] `docs/` `paper/` `artifacts/` present (or recorded as absent / substituted)
  - [ ] `.gitlab-ci.yml` / package manifest (where expected) checked
- [ ] **4. Correctness**
  - [ ] definitions / quantifiers / inferences / conclusions reviewed line-by-line
  - [ ] witnesses/counterexamples substituted into premises; properties verified exactly
- [ ] **5. Reproducibility**
  - [ ] every Reproduction command in `VALIDATION.md` executed; Expected == Observed
  - [ ] exact arithmetic / certificates / independently replayable checks only (no floating-point-only terminal claims)
- [ ] **6. Independent cross-check**
  - [ ] hashes frozen before review
  - [ ] independent re-derivation (no author-conclusion read)
  - [ ] adversarial checks: boundary, degenerate, minimal counterexample, finite→universal
- [ ] **7. Boundary & paper consistency**
  - [ ] claims do not exceed stated assumptions
  - [ ] Open Questions honestly reflect gaps
  - [ ] `paper.pdf` consistent with `SOLUTION.md`
- [ ] **8. Report written** to `reports/<solution-dir>/`

Reviewer: ______  Date: ______  Outcome: ______