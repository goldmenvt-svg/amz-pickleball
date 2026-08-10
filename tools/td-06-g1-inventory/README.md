# TD-06 G1 inventory tool — G1-P2.3 corrective verification

## Gate status

This directory contains the source, synthetic fixtures, and isolated verification
evidence through the isolated `TD-06 G1-P2.3` corrective verification.

- Official owner-reported baseline: `0747fdf5ccc72de2d6bb628c436fb58cf49d4c90`.
- Local content-equivalent planning baseline: `6937383308e6436775d8d91bc65a968f1a846ae2`.
- G1-P1 source and fixtures: owner accepted for G1-P2 verification.
- G1-P2 verification: synthetic unit/integration tests, strict report schema,
  PII-output scan, static source audit, and fake-transport proof completed locally.
- Not permitted: use credentials, contact Firebase/Google Cloud/Production, install
  dependencies, commit, push, deploy, migrate data, or perform any external write.

G1-P2 completion does not authorize running `src/cli.mjs` against Firebase or any
external target. Production count-only remains a separate owner authorization gate.

## Safety design

- The Firestore transport exposes only aggregate count and paginated document read.
- The count request uses Firestore `runAggregationQuery`; its HTTP `POST` is a
  read operation to a fixed aggregation endpoint, not a document mutation.
- Collections are hard-coded to `players`, `tournaments`, and `events`.
- Project and database must exactly match separately supplied approved values.
- Tool-source SHA-256, tool commit, and emulator-proof SHA-256 must match
  separately supplied approved values before an access token is used for any request.
- Minimum count read/cost budgets are checked before the first request and again
  between count requests. Full scans reserve document and follow-up count reads.
- Every request timeout is capped by the remaining run deadline. Document page size
  is capped by the verified preliminary count, and an extra page is rejected before
  another request.
- The tool has no Firestore create, set, update, delete, transaction, batch,
  BulkWriter, import/export, deploy, or mutation path.
- Documents are processed one at a time. Raw documents are not logged, serialized,
  cached, or included in the report.
- Tournament document IDs are retained only in memory during a full scan to count
  orphan event relationships. IDs are never emitted or hashed into the report.
- The only intended output is a fixed aggregate JSON report on standard output.
- Errors are reduced to fixed reason codes; remote error bodies are never printed.
- Node.js built-ins are sufficient. No new package or dependency is required.
- The source does not choose Firestore pricing assumptions or operating limits.
  Aggregation units, per-read cost ceilings, document/read/time/error/drift caps,
  project, database, and operator must be separately verified and approved before
  the authorized Production phase.

## G1-P2.3 verification

The dependency-free verification command is:

```bash
node --test test/*.test.mjs
```

It verifies:

1. audit every source file for write-capable APIs and data leakage;
2. add and run unit tests against the synthetic fixture;
3. validate report shape against `schema/aggregate-report.schema.json`;
4. prove the report contains no document value or identifier;
5. run a fake-transport proof showing zero Firestore writes and zero external network;
6. reject repeated or unbounded pagination tokens;
7. reject unexpected report properties, including injected sample values.
8. reject source, commit, or proof lineage mismatches before any request;
9. reject insufficient read/cost budgets before the first request and recheck
   budget between count requests;
10. cap request timeout by the remaining run deadline and bound paginated reads by
    the verified preliminary collection count.

The recorded fake-transport proof is
`docs/evidence/G1-P2-fake-transport-proof.json`. Exact checksums and audit findings
are recorded in `docs/evidence/G1-P2-audit-report.md`.
