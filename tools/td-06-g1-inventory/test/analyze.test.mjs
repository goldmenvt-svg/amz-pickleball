import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createInventoryAccumulator, InventoryDataError } from "../src/analyze.mjs";

const fixture = JSON.parse(
  await readFile(new URL("../fixtures/synthetic-firestore-documents.json", import.meta.url), "utf8"),
);
const collections = ["players", "tournaments", "events"];

function analyzeFixture() {
  const totals = Object.fromEntries(
    collections.map((collection) => [collection, fixture.collections[collection].length]),
  );
  const accumulator = createInventoryAccumulator(totals);
  for (const collection of collections) {
    for (const document of fixture.collections[collection]) accumulator.observe(collection, document);
  }
  return accumulator.finish();
}

test("synthetic fixture produces the approved aggregate classifications", () => {
  const output = analyzeFixture();

  assert.deepEqual(
    Object.fromEntries(collections.map((name) => [name, output[name].DOC_TOTAL])),
    { players: 4, tournaments: 3, events: 4 },
  );
  assert.deepEqual(
    Object.fromEntries(collections.map((name) => [name, output[name].DOC_SCANNED])),
    { players: 4, tournaments: 3, events: 4 },
  );
  assert.deepEqual(
    Object.fromEntries(collections.map((name) => [name, output[name].TEST_MARKER_COUNT])),
    { players: 1, tournaments: 1, events: 1 },
  );
  assert.deepEqual(
    Object.fromEntries(collections.map((name) => [name, output[name].QUARANTINE_ANY])),
    { players: 3, tournaments: 2, events: 3 },
  );

  assert.deepEqual(output.players.ALIAS_COMPARISON.full_name__name, {
    CANONICAL_ONLY: 1,
    ALIAS_ONLY: 1,
    BOTH_EXACT: 0,
    BOTH_TRIM_EQUAL: 1,
    CONFLICT: 1,
    NEITHER: 0,
    INVALID_TYPE: 0,
  });
  assert.equal(output.players.FIELD_COVERAGE.elo_version.FIELD_TYPE_INVALID, 1);
  assert.equal(output.players.UNKNOWN_FIELD_PRESENT_DOCS, 1);
  assert.deepEqual(output.tournaments.LEGACY_FIELD_PRESENT, {
    date: 1,
    endDate: 0,
    createdAt: 1,
    updatedAt: 0,
    maxTeamsPerCategory: 0,
    entryFee: 0,
    registrationDeadline: 0,
  });
  assert.equal(output.tournaments.UNKNOWN_FIELD_PRESENT_DOCS, 1);
  assert.deepEqual(output.events.EVENT_RELATION, {
    EVENT_TOURNAMENT_ID_MISSING: 1,
    EVENT_TOURNAMENT_ID_INVALID_TYPE: 1,
    EVENT_TOURNAMENT_ORPHAN: 1,
    EVENT_TOURNAMENT_VALID: 1,
  });
});

test("unknown field values are never decoded", () => {
  const accumulator = createInventoryAccumulator({ players: 1, tournaments: 0, events: 0 });
  accumulator.observe("players", {
    name: "projects/synthetic/databases/(default)/documents/players/synthetic-safe",
    fields: {
      full_name: { stringValue: "Synthetic Safe" },
      created_at: { stringValue: "2026-01-01T00:00:00Z" },
      unknown_field: { arrayValue: { values: "malformed-but-ignored" } },
    },
  });
  const output = accumulator.finish();
  assert.equal(output.players.UNKNOWN_FIELD_PRESENT_DOCS, 1);
});

test("document total mismatch fails closed", () => {
  const accumulator = createInventoryAccumulator({ players: 1, tournaments: 0, events: 0 });
  assert.throws(
    () => accumulator.finish(),
    (error) => error instanceof InventoryDataError && error.code === "DOCUMENT_COUNT_MISMATCH",
  );
});
