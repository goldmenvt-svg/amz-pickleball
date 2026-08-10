import {
  ALIAS_STATES,
  COLLECTIONS,
  FIELD_SPECS,
  PLAYER_ALIASES,
  QUARANTINE_REASONS,
  TEST_MARKER,
  TOURNAMENT_LEGACY_FIELDS,
  classifyValue,
} from "./policy.mjs";

export class InventoryDataError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function counter(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function fieldCounter() {
  return {
    FIELD_PRESENT: 0,
    FIELD_MISSING: 0,
    FIELD_NULL: 0,
    FIELD_TYPE_VALID: 0,
    FIELD_TYPE_INVALID: 0,
  };
}

function collectionCounter(collection, docTotal) {
  const result = {
    DOC_TOTAL: docTotal,
    DOC_SCANNED: 0,
    READ_ERROR_COUNT: 0,
    UNKNOWN_FIELD_PRESENT_DOCS: 0,
    TEST_MARKER_COUNT: 0,
    QUARANTINE_ANY: 0,
    QUARANTINE_REASON_COUNT: counter(QUARANTINE_REASONS),
    FIELD_COVERAGE: Object.fromEntries(
      Object.keys(FIELD_SPECS[collection]).map((field) => [field, fieldCounter()]),
    ),
  };

  if (collection === "players") {
    result.ALIAS_COMPARISON = Object.fromEntries(
      Object.entries(PLAYER_ALIASES).map(([canonical, alias]) => [
        `${canonical}__${alias}`,
        counter(ALIAS_STATES),
      ]),
    );
  }

  if (collection === "tournaments") {
    result.LEGACY_FIELD_PRESENT = counter(TOURNAMENT_LEGACY_FIELDS);
  }

  if (collection === "events") {
    result.EVENT_RELATION = counter([
      "EVENT_TOURNAMENT_ID_MISSING",
      "EVENT_TOURNAMENT_ID_INVALID_TYPE",
      "EVENT_TOURNAMENT_ORPHAN",
      "EVENT_TOURNAMENT_VALID",
    ]);
  }

  return result;
}

function decodeFirestoreValue(encoded) {
  if (!encoded || typeof encoded !== "object" || Array.isArray(encoded)) {
    throw new InventoryDataError("MALFORMED_DOCUMENT_VALUE");
  }
  if (Object.hasOwn(encoded, "nullValue")) {
    if (encoded.nullValue !== null) throw new InventoryDataError("MALFORMED_NULL");
    return { kind: "null", value: null };
  }
  if (Object.hasOwn(encoded, "stringValue")) {
    if (typeof encoded.stringValue !== "string") {
      throw new InventoryDataError("MALFORMED_STRING");
    }
    return { kind: "string", value: encoded.stringValue };
  }
  if (Object.hasOwn(encoded, "integerValue")) {
    if (typeof encoded.integerValue !== "string" || !/^-?\d+$/.test(encoded.integerValue)) {
      throw new InventoryDataError("MALFORMED_INTEGER");
    }
    const value = Number(encoded.integerValue);
    if (!Number.isSafeInteger(value)) throw new InventoryDataError("UNSAFE_INTEGER");
    return { kind: "integer", value };
  }
  if (Object.hasOwn(encoded, "doubleValue")) {
    if (typeof encoded.doubleValue !== "number" || !Number.isFinite(encoded.doubleValue)) {
      throw new InventoryDataError("NON_FINITE_OR_MALFORMED_NUMBER");
    }
    return { kind: "number", value: encoded.doubleValue };
  }
  if (Object.hasOwn(encoded, "booleanValue")) {
    if (typeof encoded.booleanValue !== "boolean") {
      throw new InventoryDataError("MALFORMED_BOOLEAN");
    }
    return { kind: "boolean", value: encoded.booleanValue };
  }
  if (Object.hasOwn(encoded, "timestampValue")) {
    return { kind: "timestamp", value: null };
  }
  if (Object.hasOwn(encoded, "arrayValue")) {
    const values = encoded.arrayValue?.values ?? [];
    if (!Array.isArray(values)) throw new InventoryDataError("MALFORMED_ARRAY");
    return { kind: "array", value: values.map(decodeFirestoreValue) };
  }
  if (Object.hasOwn(encoded, "mapValue")) {
    const fields = encoded.mapValue?.fields ?? {};
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
      throw new InventoryDataError("MALFORMED_MAP");
    }
    return { kind: "object", value: null };
  }
  return { kind: "unsupported", value: null };
}

function extractDocumentId(documentName) {
  if (typeof documentName !== "string") {
    throw new InventoryDataError("MALFORMED_DOCUMENT_NAME");
  }
  const parts = documentName.split("/");
  const id = parts.at(-1);
  if (!id) throw new InventoryDataError("MALFORMED_DOCUMENT_NAME");
  return id;
}

function compareAlias(canonicalValue, aliasValue, spec, trimEqual) {
  if (!canonicalValue && !aliasValue) return "NEITHER";

  if (canonicalValue) {
    const state = classifyValue(canonicalValue, spec);
    if (!state.validType || !state.validValidator) return "INVALID_TYPE";
  }
  if (aliasValue) {
    const state = classifyValue(aliasValue, spec);
    if (!state.validType || !state.validValidator) return "INVALID_TYPE";
  }

  if (canonicalValue && !aliasValue) return "CANONICAL_ONLY";
  if (!canonicalValue && aliasValue) return "ALIAS_ONLY";
  const bothNumeric =
    ["integer", "number"].includes(canonicalValue.kind) &&
    ["integer", "number"].includes(aliasValue.kind);
  if (canonicalValue.kind !== aliasValue.kind && !bothNumeric) return "CONFLICT";
  if (canonicalValue.value === aliasValue.value) return "BOTH_EXACT";
  if (
    trimEqual &&
    canonicalValue.kind === "string" &&
    canonicalValue.value.trim() === aliasValue.value.trim()
  ) {
    return "BOTH_TRIM_EQUAL";
  }
  return "CONFLICT";
}

function markReason(reasons, reason) {
  reasons.add(reason);
}

function observeFields(collection, decoded, output, reasons) {
  for (const [field, spec] of Object.entries(FIELD_SPECS[collection])) {
    const fieldOutput = output.FIELD_COVERAGE[field];
    if (!Object.hasOwn(decoded, field)) {
      fieldOutput.FIELD_MISSING += 1;
      continue;
    }

    fieldOutput.FIELD_PRESENT += 1;
    const value = decoded[field];
    if (value.kind === "null") fieldOutput.FIELD_NULL += 1;

    const state = classifyValue(value, spec);
    if (state.validType) {
      fieldOutput.FIELD_TYPE_VALID += 1;
    } else {
      fieldOutput.FIELD_TYPE_INVALID += 1;
      markReason(reasons, "INVALID_FIELD_TYPE");
    }
    if (state.validType && !state.validValidator) {
      markReason(reasons, "OUTSIDE_APPROVED_VALIDATOR");
    }
  }
}

function allowedFields(collection) {
  const allowed = new Set(Object.keys(FIELD_SPECS[collection]));
  if (collection === "players") {
    for (const alias of Object.values(PLAYER_ALIASES)) allowed.add(alias);
  }
  if (collection === "tournaments") {
    for (const legacy of TOURNAMENT_LEGACY_FIELDS) allowed.add(legacy);
  }
  return allowed;
}

function decodableFields(collection) {
  const fields = new Set(Object.keys(FIELD_SPECS[collection]));
  if (collection === "players") {
    for (const alias of Object.values(PLAYER_ALIASES)) fields.add(alias);
  }
  return fields;
}

function observeUnknownFields(encodedFields, allowed, output) {
  if (Object.keys(encodedFields).some((field) => !allowed.has(field))) {
    output.UNKNOWN_FIELD_PRESENT_DOCS += 1;
  }
}

function observeCreatedAt(collection, decoded, reasons) {
  const canonical = decoded.created_at;
  const alias = collection === "players" ? decoded.createdAt : undefined;
  const canonicalUsable =
    canonical &&
    classifyValue(canonical, FIELD_SPECS[collection].created_at).validType &&
    classifyValue(canonical, FIELD_SPECS[collection].created_at).validValidator;
  const aliasUsable =
    alias &&
    classifyValue(alias, FIELD_SPECS.players.created_at).validType &&
    classifyValue(alias, FIELD_SPECS.players.created_at).validValidator;
  if (!canonicalUsable && !aliasUsable) markReason(reasons, "MISSING_CREATED_AT");
}

function observeTestMarker(collection, decoded, output, reasons) {
  let candidate = decoded.name;
  if (collection === "players") candidate = decoded.full_name ?? decoded.name;
  if (candidate?.kind === "string" && TEST_MARKER.test(candidate.value)) {
    output.TEST_MARKER_COUNT += 1;
    markReason(reasons, "TEST_DATA_MARKER");
  }
}

export function createInventoryAccumulator(docTotals) {
  for (const collection of COLLECTIONS) {
    if (!Number.isSafeInteger(docTotals[collection]) || docTotals[collection] < 0) {
      throw new InventoryDataError("INVALID_DOCUMENT_TOTAL");
    }
  }

  const collections = Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection,
      collectionCounter(collection, docTotals[collection]),
    ]),
  );
  const tournamentIds = new Set();

  return {
    observe(collection, document) {
      if (!COLLECTIONS.includes(collection)) {
        throw new InventoryDataError("COLLECTION_NOT_ALLOWED");
      }
      if (!document || typeof document !== "object" || Array.isArray(document)) {
        throw new InventoryDataError("MALFORMED_DOCUMENT");
      }
      const encodedFields = document.fields ?? {};
      if (!encodedFields || typeof encodedFields !== "object" || Array.isArray(encodedFields)) {
        throw new InventoryDataError("MALFORMED_DOCUMENT_FIELDS");
      }

      const allowed = allowedFields(collection);
      const decodable = decodableFields(collection);
      const decoded = Object.fromEntries(
        Object.entries(encodedFields)
          .filter(([field]) => decodable.has(field))
          .map(([field, value]) => [field, decodeFirestoreValue(value)]),
      );
      const output = collections[collection];
      const reasons = new Set();

      output.DOC_SCANNED += 1;
      observeFields(collection, decoded, output, reasons);
      observeUnknownFields(encodedFields, allowed, output);
      observeCreatedAt(collection, decoded, reasons);
      observeTestMarker(collection, decoded, output, reasons);

      if (collection === "players") {
        for (const [canonical, alias] of Object.entries(PLAYER_ALIASES)) {
          const state = compareAlias(
            decoded[canonical],
            decoded[alias],
            FIELD_SPECS.players[canonical],
            canonical === "full_name",
          );
          output.ALIAS_COMPARISON[`${canonical}__${alias}`][state] += 1;
          if (state === "CONFLICT") markReason(reasons, "CANONICAL_ALIAS_CONFLICT");
          if (state === "INVALID_TYPE") {
            const values = [decoded[canonical], decoded[alias]].filter(Boolean);
            const states = values.map((value) =>
              classifyValue(value, FIELD_SPECS.players[canonical]),
            );
            if (states.some((item) => !item.validType)) {
              markReason(reasons, "INVALID_FIELD_TYPE");
            }
            if (states.some((item) => item.validType && !item.validValidator)) {
              markReason(reasons, "OUTSIDE_APPROVED_VALIDATOR");
            }
          }
        }
      }

      if (collection === "tournaments") {
        for (const legacy of TOURNAMENT_LEGACY_FIELDS) {
          if (Object.hasOwn(encodedFields, legacy)) output.LEGACY_FIELD_PRESENT[legacy] += 1;
        }
        tournamentIds.add(extractDocumentId(document.name));
      }

      if (collection === "events") {
        const relation = decoded.tournament_id;
        if (!relation || (relation.kind === "string" && relation.value.trim() === "")) {
          output.EVENT_RELATION.EVENT_TOURNAMENT_ID_MISSING += 1;
          markReason(reasons, "EVENT_RELATION_MISSING");
        } else if (relation.kind !== "string") {
          output.EVENT_RELATION.EVENT_TOURNAMENT_ID_INVALID_TYPE += 1;
          markReason(reasons, "EVENT_RELATION_MISSING");
        } else if (!tournamentIds.has(relation.value)) {
          output.EVENT_RELATION.EVENT_TOURNAMENT_ORPHAN += 1;
          markReason(reasons, "EVENT_RELATION_ORPHAN");
        } else {
          output.EVENT_RELATION.EVENT_TOURNAMENT_VALID += 1;
        }
      }

      for (const reason of reasons) output.QUARANTINE_REASON_COUNT[reason] += 1;
      if (reasons.size > 0) output.QUARANTINE_ANY += 1;
    },

    finish() {
      for (const collection of COLLECTIONS) {
        if (collections[collection].DOC_SCANNED !== docTotals[collection]) {
          throw new InventoryDataError("DOCUMENT_COUNT_MISMATCH");
        }
      }
      tournamentIds.clear();
      return collections;
    },
  };
}
