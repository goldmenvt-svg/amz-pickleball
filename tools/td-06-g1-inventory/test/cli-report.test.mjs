import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateJsonSchema } from "./support/schema-validator.mjs";

const rootUrl = new URL("../", import.meta.url);
const schema = JSON.parse(
  await readFile(new URL("schema/aggregate-report.schema.json", rootUrl), "utf8"),
);
const fixture = JSON.parse(
  await readFile(new URL("fixtures/synthetic-firestore-documents.json", rootUrl), "utf8"),
);
const recordedProof = JSON.parse(
  await readFile(new URL("docs/evidence/G1-P2-fake-transport-proof.json", rootUrl), "utf8"),
);

const sourceFiles = [
  "src/policy.mjs",
  "src/analyze.mjs",
  "src/firestore-readonly.mjs",
  "src/cli.mjs",
  "schema/aggregate-report.schema.json",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalText(text) {
  return text.replace(/\r\n/g, "\n");
}

async function canonicalFileSha(url) {
  return sha256(canonicalText(await readFile(url, "utf8")));
}

async function approvedSourceSha() {
  const parts = [];
  for (const relative of sourceFiles) {
    const runtimeRelative = relative.startsWith("src/")
      ? `./${relative.slice("src/".length)}`
      : `../${relative}`;
    parts.push(
      `${runtimeRelative}\n${canonicalText(await readFile(new URL(relative, rootUrl), "utf8"))}`,
    );
  }
  return sha256(parts.join("\n--TD06-FILE--\n"));
}

const approvedToolSourceSha256 = await approvedSourceSha();
const approvedEmulatorProofSha256 = await canonicalFileSha(
  new URL("docs/evidence/G1-P2-fake-transport-proof.json", rootUrl),
);
const approvedToolGitCommit = "a".repeat(40);

function runSyntheticCli({ mode = "full", argOverrides = {}, envOverrides = {} } = {}) {
  const preload = new URL("support/fake-firestore-preload.mjs", import.meta.url);
  const cli = fileURLToPath(new URL("src/cli.mjs", rootUrl));
  const argValues = {
    mode,
    "project-id": "synthetic-project",
    "database-id": "synthetic-database",
    "operator-label": "SYNTHETIC_QA",
    "tool-git-commit": approvedToolGitCommit,
    "emulator-proof-sha256": approvedEmulatorProofSha256,
    "max-documents": "100",
    "max-reads": "100",
    "max-duration-ms": "10000",
    "request-timeout-ms": "1000",
    "max-errors": "0",
    "max-drift": "0",
    "max-cost-micros": "1000",
    "cost-micros-per-read": "1",
    "aggregation-entry-unit": "1000",
    ...argOverrides,
  };
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      preload.href,
      cli,
      ...Object.entries(argValues).flatMap(([key, value]) => [`--${key}`, value]),
    ],
    {
      cwd: fileURLToPath(rootUrl),
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        TD06_APPROVED_PROJECT_ID: "synthetic-project",
        TD06_APPROVED_DATABASE_ID: "synthetic-database",
        TD06_APPROVED_TOOL_SOURCE_SHA256: approvedToolSourceSha256,
        TD06_APPROVED_TOOL_GIT_COMMIT: approvedToolGitCommit,
        TD06_APPROVED_EMULATOR_PROOF_SHA256: approvedEmulatorProofSha256,
        GOOGLE_OAUTH_ACCESS_TOKEN: "synthetic-noncredential-token",
        ...envOverrides,
      },
      timeout: 15000,
    },
  );
  assert.equal(result.error, undefined);
  return result;
}

function proofFrom(execution) {
  const proofLine = execution.stderr
    .split(/\r?\n/)
    .find((line) => line.startsWith("TD06_FAKE_TRANSPORT_PROOF "));
  assert.ok(proofLine, "missing fake-transport proof");
  return JSON.parse(proofLine.slice("TD06_FAKE_TRANSPORT_PROOF ".length));
}

function assertStoppedBeforeOrAfter(execution, code, totalRequests) {
  assert.equal(execution.error, undefined);
  assert.equal(execution.status, 1);
  const report = JSON.parse(execution.stdout);
  assert.equal(report.result.status, "STOPPED");
  assert.equal(report.result.reasonCode, code);
  assert.equal(proofFrom(execution).totalRequests, totalRequests);
}

function fixtureSecrets() {
  const values = new Set();
  for (const documents of Object.values(fixture.collections)) {
    for (const document of documents) {
      values.add(document.name);
      values.add(document.name.split("/").at(-1));
      for (const encoded of Object.values(document.fields)) {
        for (const [key, value] of Object.entries(encoded)) {
          if ((key === "stringValue" || key === "timestampValue") && typeof value === "string") {
            values.add(value);
          }
        }
      }
    }
  }
  values.add("unexpected_synthetic_field");
  values.add("unknown_synthetic_field");
  return [...values];
}

test("full synthetic CLI report passes schema, PII scan, and zero-write proof", () => {
  const execution = runSyntheticCli();
  assert.equal(execution.status, 0, execution.stderr);
  const report = JSON.parse(execution.stdout);
  const proof = proofFrom(execution);

  assert.deepEqual(validateJsonSchema(schema, report), []);
  const injectedReport = structuredClone(report);
  injectedReport.collections.players.sampleValue = "synthetic-sensitive-value";
  assert.match(
    validateJsonSchema(schema, injectedReport).join("\n"),
    /collections\.players: expected exactly one oneOf match/,
  );
  assert.equal(report.result.status, "COMPLETE");
  assert.equal(report.result.inventoryComplete, true);
  assert.equal(report.runMetadata.toolSourceSha256, approvedToolSourceSha256);
  assert.equal(report.runMetadata.toolGitCommit, approvedToolGitCommit);
  assert.equal(report.controls.emulatorProofSha256, approvedEmulatorProofSha256);
  assert.deepEqual(report.drift.delta, { players: 0, tournaments: 0, events: 0 });
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(report.collections).map(([name, collection]) => [name, collection.DOC_SCANNED]),
    ),
    { players: 4, tournaments: 3, events: 4 },
  );

  assert.deepEqual(proof, {
    transport: "synthetic-fake-fetch",
    totalRequests: 12,
    aggregationReads: 6,
    documentReads: 6,
    writeRequests: 0,
    rejectedRequests: 0,
    networkRequests: 0,
  });
  assert.deepEqual(recordedProof.requests, {
    total: proof.totalRequests,
    aggregationReads: proof.aggregationReads,
    documentReads: proof.documentReads,
    writes: proof.writeRequests,
    rejected: proof.rejectedRequests,
  });
  assert.equal(recordedProof.externalNetworkRequests, proof.networkRequests);
  assert.equal(recordedProof.credentialsUsed, false);
  assert.equal(recordedProof.result, "PASS");

  const serialized = JSON.stringify(report);
  for (const secret of fixtureSecrets()) {
    assert.equal(serialized.includes(secret), false, `fixture value leaked: ${secret}`);
  }
  assert.equal(serialized.includes("synthetic-project"), false);
  assert.equal(serialized.includes("synthetic-database"), false);
  assert.equal(serialized.includes("synthetic-noncredential-token"), false);
});

test("count-only synthetic CLI report uses no document reads and passes schema", () => {
  const execution = runSyntheticCli({ mode: "count-only" });
  assert.equal(execution.status, 0, execution.stderr);
  const report = JSON.parse(execution.stdout);
  const proof = proofFrom(execution);

  assert.deepEqual(validateJsonSchema(schema, report), []);
  assert.equal(report.runMetadata.mode, "COUNT_ONLY");
  assert.equal(report.result.status, "COMPLETE");
  assert.equal(report.result.inventoryComplete, false);
  assert.equal(proof.totalRequests, 3);
  assert.equal(proof.aggregationReads, 3);
  assert.equal(proof.documentReads, 0);
  assert.equal(proof.writeRequests, 0);
  assert.equal(proof.networkRequests, 0);
});

test("source, commit, and proof lineage mismatches fail before network", () => {
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      envOverrides: { TD06_APPROVED_TOOL_SOURCE_SHA256: "f".repeat(64) },
    }),
    "TOOL_SOURCE_HASH_MISMATCH",
    0,
  );
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      envOverrides: { TD06_APPROVED_TOOL_GIT_COMMIT: "c".repeat(40) },
    }),
    "TOOL_COMMIT_MISMATCH",
    0,
  );
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      argOverrides: { "emulator-proof-sha256": "d".repeat(64) },
      envOverrides: { TD06_APPROVED_EMULATOR_PROOF_SHA256: "d".repeat(64) },
    }),
    "EMULATOR_PROOF_MISMATCH",
    0,
  );
});

test("minimum read and cost budgets fail before the first request", () => {
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      mode: "count-only",
      argOverrides: { "max-reads": "2" },
    }),
    "READ_LIMIT_EXCEEDED",
    0,
  );
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      mode: "count-only",
      argOverrides: { "max-cost-micros": "2" },
    }),
    "COST_LIMIT_EXCEEDED",
    0,
  );
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      mode: "full",
      argOverrides: { "max-reads": "5" },
    }),
    "READ_LIMIT_EXCEEDED",
    0,
  );
});

test("count budget is rechecked before the next request", () => {
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      mode: "count-only",
      argOverrides: {
        "max-reads": "5",
        "aggregation-entry-unit": "1",
      },
    }),
    "READ_LIMIT_EXCEEDED",
    1,
  );
});

test("remaining deadline caps an individual request timeout", () => {
  assertStoppedBeforeOrAfter(
    runSyntheticCli({
      mode: "count-only",
      argOverrides: {
        "max-duration-ms": "50",
        "request-timeout-ms": "1000",
      },
      envOverrides: { TD06_FAKE_DELAY_MS: "250" },
    }),
    "TIME_LIMIT_EXCEEDED",
    1,
  );
});
