# TD-06 G1-P2.3 source, budget, lineage, schema, PII, and zero-write audit

## Decision

`TD-06 G1-P2.3` passes in the isolated workspace after the P2 final audit and
five fail-closed corrections:

1. bounded document pagination now rejects repeated tokens and page counts above
   the approved document-derived limit;
2. the report schema now uses exact allowlists for every collection metric and
   rejects unexpected nested properties.
3. source SHA-256, tool commit, and emulator-proof SHA-256 now require exact
   independently approved values before any network request;
4. minimum read/cost budgets are enforced before the first request and rechecked
   between every preliminary and follow-up count request;
5. each request timeout is capped by the remaining run deadline, while document
   page size is bounded by the verified preliminary count.

This result does not authorize G1-P3 or any Firebase/Production access.

## Scope and lineage

- Official owner-reported baseline: `0747fdf5ccc72de2d6bb628c436fb58cf49d4c90`.
- Local content-equivalent baseline: `6937383308e6436775d8d91bc65a968f1a846ae2`.
- Accepted G1-P1 patch SHA-256:
  `ba7b8c19b754f4a660546f80c3e788db806716949dac5acfe26e449713f10a27`.
- P2 final-audit input patch SHA-256:
  `a33e7f7e5ee2b57616e3ab2f2e1936ad1e550ecd0290fa15751a87e416fc64f6`.
- P2 final-audit input manifest SHA-256:
  `b9a2a33e7a5c9a1e6538089812c549b5ba7d7a620e3d4f747295e6ca6fff684d`.
- Canonical G1 plan SHA-256:
  `32a410c6ae3904a0c0b7cc3fca6d327d70361055476d58a2c5692d91cc7306f0`.
- Runtime: Node.js `v24.14.0`; no dependency installation.
- Data: only `td06-g1-synthetic/v1`; no credential or Production data.

## Verification results

| Control | Evidence | Result |
|---|---|---|
| Source syntax | `node --check` on every `.mjs` file | PASS |
| JSON syntax | parsed every `.json` file | PASS |
| Unit/integration tests | `node --test test/*.test.mjs` — 19 tests | PASS — 19/19 |
| Static write-path audit | no Firestore writer SDK/API, filesystem writer, subprocess, mutation endpoint, or non-transport fetch in production source | PASS |
| Full synthetic transport | 6 aggregation reads + 6 paginated document reads | PASS |
| Full synthetic writes | 0 | PASS |
| Count-only transport | 3 aggregation reads; 0 document reads; 0 writes | PASS |
| External network | fake fetch only; 0 external request | PASS |
| Credentials | sanitized child environment with synthetic non-credential token only | PASS |
| Report schema | full and count-only reports match the fixed schema | PASS |
| Schema negative test | injected `collections.players.sampleValue` rejected | PASS |
| PII/value scan | no fixture value, document ID/path, unknown field name, target ID, database ID, or token in report | PASS |
| Remote error hygiene | response body not read or exposed on non-OK response | PASS |
| Pagination bound | repeated token and unique unbounded token sequence fail closed | PASS |
| Lineage preflight | source, tool commit, and proof mismatch cases stop with 0 request | PASS |
| Minimum budget preflight | insufficient read/cost caps stop with 0 request | PASS |
| Between-count budget | expanded aggregation estimate stops before request 2 | PASS |
| Deadline-bound timeout | delayed request is aborted at the remaining run deadline | PASS |
| Document read bound | page size is capped by preliminary count; extra page stops before request | PASS |
| Whitespace | `git diff --check --no-index` for every deliverable file | PASS |

The recorded fake-transport evidence is
`docs/evidence/G1-P2-fake-transport-proof.json`, SHA-256:
`6351959b68659b5854bf016cdf16cc1a7e750d674e22c33fe255afde65d60956`.

## Audited checksums

| File | SHA-256 |
|---|---|
| `README.md` | `3dae808e921c5f92f538f3f19ed80208aa4ff37142b410865416fd48986e6ade` |
| `src/policy.mjs` | `bbb9bac4e93a2373de9bc14f9a5624c1c6688f845c2f125c45719b9c96909c9e` |
| `src/analyze.mjs` | `694a2477a7deda9ee9f66ebc6fc61dc7f0c6b2d9de4e430faa1b0f0c93901641` |
| `src/firestore-readonly.mjs` | `33d6e36faa85a196d5d56c620936e419f293b99e362c95b627b7aa2aeb41a616` |
| `src/cli.mjs` | `1ed5e5f8ce1ca82fa3637bd1c0f20be55777bbcf563ad76eb5efbc32da9d006e` |
| `schema/aggregate-report.schema.json` | `1deac20a935ea0328a40b318dc4e6a0cfee2bce069b0280f7af4e799420a6585` |
| `fixtures/synthetic-firestore-documents.json` | `b35b7ef91ce6b7c76469d2705bf303ca25425d727fba33b1676a6237bd509fbd` |
| `test/analyze.test.mjs` | `b8cf1022ab337f9352dfbd4ab2ac90399bc608de9b6685641e2c8c343dfa12f2` |
| `test/cli-report.test.mjs` | `ad43d1ac592d4d40ea43a0bc461d1a7262114b0825db293c19e7064ea9ce3214` |
| `test/firestore-readonly.test.mjs` | `dee876bbbde8f829be150cb5e52220e2e493385d04db9187c2b2bda45bd05a4e` |
| `test/static-audit.test.mjs` | `1e41c8581a29648fe61408b93ef944feb864c3a37ca99bc7bcc1f73bf4cbb8df` |
| `test/support/fake-firestore-preload.mjs` | `dcaf2ca3adb5a48976ab5dfe9e93fa4349077b4032dd787e6bd355b836388472` |
| `test/support/schema-validator.mjs` | `3319aeb459c6dd28e39a93a36557ead6fc6572aa6d64e4c15e16976f8ef996ca` |
| `docs/evidence/G1-P2-fake-transport-proof.json` | `6351959b68659b5854bf016cdf16cc1a7e750d674e22c33fe255afde65d60956` |

Canonical tool-source SHA-256 produced by the runtime `sourceSha()` algorithm:

`f950ee59d7e84a5acd241b0bbe0b3d333def91654ba8b53c156fb7fedb4938a8`

## Remaining boundaries and risks

- Fake transport proves the audited code path issues zero writes; it does not prove
  Production IAM, deployed rules, billing, connectivity, or data state.
- The workspace baseline is content-equivalent but not the official Git object.
  Any later application must start from official `0747fdf5...` and repeat patch,
  checksum, test, and scope verification.
- The approved lineage values must be supplied independently at the later authorized
  run; accepting values calculated ad hoc in the same run would defeat this control.
- Any source/schema change invalidates the tool-source checksum and requires the
  synthetic proof to be rerun.
- No credential, Firebase/Google Cloud/Production access, dependency installation,
  commit, push, deploy, migration, backup, or restore occurred.
- G1-P3 count-only Production preflight remains `NOT AUTHORIZED`.
