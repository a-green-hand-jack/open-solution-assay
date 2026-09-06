# Gewu Solutions Corpus Summary

Generated from the latest valid completed OSA run for each of the 39 samples in
the Hugging Face snapshot `576302afd4bc95cd3b3ed809f4822c611a1ea95f`.

## Run gate

- Samples evaluated: 39
- Samples with a completed run and final report: 39
- Samples without a valid completed report: 0
- A container exit code of zero is treated only as successful OSA execution. It
  is not evidence that the submitted solution is correct.

## Resolution distribution

| Resolution | Count |
|---|---:|
| `declared-partial` | 11 |
| `narrowed` | 3 |
| `unsupported` | 5 |
| `unverifiable` | 16 |
| `contradicted` | 4 |
| `closed` | 0 |
| **Total** | **39** |

## Interpretation

The corpus contains no solution that reached `closed` under the current
evidence standard. The dominant result is `unverifiable` (16/39), usually
because the canonical problem pin could not be recovered or because the
load-bearing replay/checker evidence was incomplete.

Four `contradicted` results concern concrete false claims, most commonly
checker coverage or integrity claims. They should not be read as proof that
every independently reproduced numerical result in those repositories is
wrong.

The `declared-partial` and `narrowed` results generally reflect honest scope
limits or partial support rather than a failed OSA run. `unsupported` means the
available repository evidence did not establish the advertised solution.

## Main corpus-level findings

1. Recovering and hash-verifying the canonical problem is often the controlling
   limitation. A fixed-instance calculation cannot establish compliance with
   an unavailable pinned problem.
2. Presence-only CI and incomplete certificate checkers are not substantive
   verification. Several checkers accept altered matrices, signs, hashes, or
   certificate fields that they claim to validate.
3. The current runner completed all 39 samples after the resumable, absolute
   path runner fix. Per-sample run state and report paths are retained under
   `runs/`; the latest 12-sample batch is indexed by
   `/tmp/opencode/osa-e2e-results.tsv`.
4. Reproduction command parsing was corrected for Markdown shell line
   continuations. Existing conclusions caused by the previous trailing `\\`
   parsing bug should be rechecked before being treated as solution failures.

## Limitations

This is a corpus summary, not a claim that the 39 reports are mathematically
correct. Judgment stability, canonical problem retrieval, and checker
semantic coverage remain audit targets. Historical runs are preserved and are
not silently replaced; the distribution above uses the latest valid completed
report per sample.
