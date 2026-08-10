import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceFiles = ["policy.mjs", "analyze.mjs", "firestore-readonly.mjs", "cli.mjs"];
const source = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (name) => [
      name,
      await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"),
    ]),
  ),
);
const combined = Object.values(source).join("\n");

test("source has no write-capable client, filesystem write, or subprocess API", () => {
  const forbidden = [
    /\bwriteFile(?:Sync)?\b/,
    /\bappendFile(?:Sync)?\b/,
    /\bcreateWriteStream\b/,
    /node:child_process/,
    /firebase-admin|@google-cloud\/firestore/,
    /\b(?:documentRef|docRef|batch|transaction|writer)\s*\.\s*(?:create|set|update|delete)\s*\(/,
    /\b(?:batchWrite|BulkWriter|runTransaction)\b/,
    /documents:(?:commit|batchWrite|write)/,
  ];
  for (const pattern of forbidden) assert.doesNotMatch(combined, pattern);
});

test("all network access is isolated to the read-only transport", () => {
  assert.doesNotMatch(source["policy.mjs"], /\bfetch\s*\(/);
  assert.doesNotMatch(source["analyze.mjs"], /\bfetch\s*\(/);
  assert.doesNotMatch(source["cli.mjs"], /\bfetch\s*\(/);
  assert.equal((source["firestore-readonly.mjs"].match(/\bfetch\s*\(/g) ?? []).length, 1);
  assert.match(source["firestore-readonly.mjs"], /hostname !== "firestore\.googleapis\.com"/);
  assert.match(source["firestore-readonly.mjs"], /:runAggregationQuery/);
  assert.doesNotMatch(source["firestore-readonly.mjs"], /method:\s*"(?:PUT|PATCH|DELETE)"/);
});

test("source never prints remote bodies or raw documents", () => {
  assert.doesNotMatch(source["firestore-readonly.mjs"], /console\.|process\.stdout|process\.stderr/);
  assert.doesNotMatch(source["analyze.mjs"], /console\.|process\.stdout|process\.stderr/);
  assert.doesNotMatch(source["cli.mjs"], /console\.|process\.stderr/);
  assert.doesNotMatch(source["cli.mjs"], /JSON\.stringify\s*\(\s*(?:document|payload|error)/);
});
