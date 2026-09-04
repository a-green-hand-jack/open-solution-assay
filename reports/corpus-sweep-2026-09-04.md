# Corpus sweep — 2026-09-04

`osa batch` over all 39 solution directories, deterministic phases only
(`--prepare-only --exec-timeout 45000 --max-commands 20`), inside `osa:dev`.

Tier distribution: T0 5 · T2 32 · T3 2 · T4 0.

| Task | Files | Tier | Ceiling | Coverage | Findings |
|---|---:|---|---|---:|---:|
| `Ch.S_povm-conjecture2-solution__d2af6469` | 17 | T0 | closed | 0/1 | 4 |
| `Ch.S_stabilizer-multientropy-solution__c5d6460a` | 20 | T0 | closed | 3/3 | 2 |
| `iintsjds_solution-p17189__7ce23457` | 10 | T2 | narrowed | 1/6 | 3 |
| `jiangweiqi_solution-p2113__ee352d7f` | 8 | T2 | narrowed | 2/5 | 3 |
| `jiangweiqi_solution-p3234__e1e1caa3` | 16 | T2 | narrowed | 3/14 | 3 |
| `jiangweiqi_solution-p3535__2f473e83` | 29 | T0 | closed | 0/1 | 5 |
| `kun-agent_solution-p17208-endpoint-entropy__d6737968` | 15 | T3 | declared-partial | 0/4 | 5 |
| `lewton-agent_kerrDeflection-solution__57b47284` | 151 | T3 | declared-partial | 0/3 | 7 |
| `wangqihang_solution-bayesian-nh-saturability__6c9df65e` | 22 | T2 | narrowed | 22/25 | 2 |
| `wangqihang_solution-p1014__907960ae` | 11 | T2 | narrowed | 3/8 | 3 |
| `wangqihang_solution-p1192__34ac4430` | 30 | T2 | narrowed | 24/125 | 7 |
| `wangqihang_solution-p1193__9ec72564` | 34 | T2 | narrowed | 29/30 | 4 |
| `wangqihang_solution-p1203__8c274ef3` | 19 | T2 | narrowed | 13/30 | 5 |
| `wangqihang_solution-p1208__4b04b192` | 26 | T2 | narrowed | 4/34 | 6 |
| `wangqihang_solution-p1209__c9637973` | 68 | T2 | narrowed | 17/32 | 6 |
| `wangqihang_solution-p1211__f9028ec4` | 38 | T2 | narrowed | 19/50 | 6 |
| `wangqihang_solution-p1261__53dfa37b` | 16 | T0 | closed | 0/5 | 3 |
| `wangqihang_solution-p18022__ea63150b` | 15 | T2 | narrowed | 0/6 | 4 |
| `wangqihang_solution-p1962__4b5c8aec` | 27 | T2 | narrowed | 4/18 | 7 |
| `wangqihang_solution-p1963__17325d6b` | 21 | T2 | narrowed | 6/8 | 3 |
| `wangqihang_solution-p1967__6bd79c9c` | 22 | T2 | narrowed | 11/19 | 6 |
| `wangqihang_solution-p19795__68e8c624` | 11 | T2 | narrowed | 0/5 | 4 |
| `wangqihang_solution-p2034__5eb84e0b` | 30 | T2 | narrowed | 23/27 | 4 |
| `wangqihang_solution-p2038__ec54dc5f` | 25 | T2 | narrowed | 10/15 | 4 |
| `wangqihang_solution-p302__40d3f430` | 13 | T2 | narrowed | 5/13 | 5 |
| `wangqihang_solution-p305__c33dcf3c` | 9 | T2 | narrowed | 0/6 | 5 |
| `wangqihang_solution-p306__2b8c7a1d` | 14 | T2 | narrowed | 1/10 | 4 |
| `wangqihang_solution-p307__4a862b00` | 23 | T2 | narrowed | 1/7 | 4 |
| `wangqihang_solution-p308__ae1fa420` | 19 | T2 | narrowed | 1/6 | 3 |
| `wangqihang_solution-p314__19d682b4` | 25 | T2 | narrowed | 3/8 | 3 |
| `wangqihang_solution-p324__5b1bebc2` | 15 | T2 | narrowed | 1/7 | 4 |
| `wangqihang_solution-p3241__453397ae` | 13 | T0 | closed | 0/7 | 3 |
| `wangqihang_solution-p331__299091ab` | 21 | T2 | narrowed | 20/26 | 4 |
| `wangqihang_solution-p340__25545acc` | 16 | T2 | narrowed | 3/10 | 5 |
| `wangqihang_solution-p341__6c7e167f` | 12 | T2 | narrowed | 3/8 | 3 |
| `wangqihang_solution-p559__4aaa9ee1` | 18 | T2 | narrowed | 16/46 | 8 |
| `wangqihang_solution-p687__14a43080` | 30 | T2 | narrowed | 6/8 | 2 |

- FAILED `wangqihang_solution-p1189-qihang__83097646`: execute failed validation: .assay/graph/exec.json:non-empty: 3 bytes
- FAILED `wangqihang_solution-p1432__ba3ba1e6`: execute failed validation: .assay/graph/exec.json:non-empty: 3 bytes
