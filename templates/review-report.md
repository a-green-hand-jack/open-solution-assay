# Independent review: <Problem / solution id>

- Reviewer:
- Date:
- Outcome: **PASS / FAIL / WITH-COMMENTS**
- Source dir: `<owner>_solution-<problem>__<commit>`

## Role and boundary

One no-context independent review of the fixed candidate. What was / was not
read, created, or modified.

## Frozen bindings

SHA-256 of every reviewed artifact (certificate, checker, SOLUTION.md,
RESULT.json, etc.).

## Binding audit

| Item | Expected | Observed |
|---|---|---|
| Directory name ↔ MANIFEST commit | | |
| `solution.yaml` problem_project_id / problem_sha | | |
| README `### Problem References` link / title | | |
| Source repo HEAD on git.gewu-lab.ai | | |

## Source and statement match

Does the solution address the pinned problem statement? Any quantifier,
scope, or parameter mismatch?

## Proof / solution review (by claim)

For each claim in SOLUTION.md:
- Claim, and whether definitions/quantifiers/inferences/conclusions hold
- Witness/counterexample objects substituted into premises and verified

## Reproduction checks

| Command (from VALIDATION.md) | Expected | Observed | Pass |
|---|---|---|---|
|  |  |  |  |

Note: floating-point evidence alone is not terminal.

## Independent cross-check / adversarial checks

- Boundary values / degenerate cases:
- Minimal counterexample searches:
- Finite→universal transitions:
- Independent implementation of the checker, or manual certificate recheck:

## Boundary and paper consistency

Claims stay within stated assumptions? Open Questions reflect real gaps?
`paper.pdf` agrees with `SOLUTION.md`?

## Verdict

Summary, severity-ordered defects (if any), and next actions.