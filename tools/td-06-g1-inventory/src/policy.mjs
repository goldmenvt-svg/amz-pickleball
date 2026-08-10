export const OFFICIAL_BASELINE_SHA =
  "0747fdf5ccc72de2d6bb628c436fb58cf49d4c90";

export const CANONICAL_PLAN_SHA256 =
  "32a410c6ae3904a0c0b7cc3fca6d327d70361055476d58a2c5692d91cc7306f0";

export const REPORT_SCHEMA_VERSION = "td06-g1-inventory-report/v1";

export const COLLECTIONS = Object.freeze(["players", "tournaments", "events"]);

export const TEST_MARKER = /^test(?:$|[\s_\-–—])/i;

export const QUARANTINE_REASONS = Object.freeze([
  "CANONICAL_ALIAS_CONFLICT",
  "MISSING_CREATED_AT",
  "INVALID_FIELD_TYPE",
  "OUTSIDE_APPROVED_VALIDATOR",
  "EVENT_RELATION_MISSING",
  "EVENT_RELATION_ORPHAN",
  "TEST_DATA_MARKER",
]);

const string = Object.freeze({ kinds: ["string"] });
const nonEmptyString = Object.freeze({ kinds: ["string"], nonEmpty: true });
const number = Object.freeze({ kinds: ["number", "integer"] });
const nullableNumber = Object.freeze({ kinds: ["number", "integer", "null"] });
const integer = Object.freeze({ kinds: ["integer"] });
const nullableInteger = Object.freeze({ kinds: ["integer", "null"] });
const boolean = Object.freeze({ kinds: ["boolean"] });
const isoString = Object.freeze({ kinds: ["string"], iso8601: true });
const stringArray = Object.freeze({ kinds: ["array"], arrayItems: "string" });
const object = Object.freeze({ kinds: ["object"] });

export const FIELD_SPECS = Object.freeze({
  players: Object.freeze({
    full_name: nonEmptyString,
    amz_rating: nullableNumber,
    elo_score: number,
    elo_version: integer,
    is_active: boolean,
    phone: string,
    email: string,
    gender: string,
    birth_year: nullableInteger,
    club: string,
    location: string,
    self_rating: nullableNumber,
    dominant_hand: Object.freeze({ kinds: ["string"], enum: ["left", "right"] }),
    note: string,
    categories: stringArray,
    stats: object,
    created_at: isoString,
    updated_at: isoString,
  }),
  tournaments: Object.freeze({
    name: string,
    start_date: string,
    end_date: string,
    venue: string,
    court_count: integer,
    status: string,
    description: string,
    created_at: string,
    updated_at: string,
    levels: stringArray,
    type: string,
    max_teams: integer,
    image: string,
  }),
  events: Object.freeze({
    tournament_id: nonEmptyString,
    name: string,
    event_type: string,
    status: string,
    rating_min: number,
    rating_max: number,
    max_players: integer,
    entry_fee: number,
    created_at: isoString,
    updated_at: isoString,
  }),
});

export const PLAYER_ALIASES = Object.freeze({
  full_name: "name",
  amz_rating: "duprLevel",
  elo_score: "elo",
  is_active: "isActive",
  created_at: "createdAt",
  updated_at: "updatedAt",
});

export const TOURNAMENT_LEGACY_FIELDS = Object.freeze([
  "date",
  "endDate",
  "createdAt",
  "updatedAt",
  "maxTeamsPerCategory",
  "entryFee",
  "registrationDeadline",
]);

export const ALIAS_STATES = Object.freeze([
  "CANONICAL_ONLY",
  "ALIAS_ONLY",
  "BOTH_EXACT",
  "BOTH_TRIM_EQUAL",
  "CONFLICT",
  "NEITHER",
  "INVALID_TYPE",
]);

export function canonicalText(text) {
  return text.replace(/\r\n/g, "\n");
}

export function isIso8601(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

export function classifyValue(value, spec) {
  if (!value || typeof value.kind !== "string") {
    return { validType: false, validValidator: false };
  }

  const typeAllowed = spec.kinds.includes(value.kind);
  if (!typeAllowed) {
    return { validType: false, validValidator: false };
  }

  let validValidator = true;
  if (spec.nonEmpty && value.kind === "string") {
    validValidator = value.value.trim().length > 0;
  }
  if (spec.iso8601 && value.kind === "string") {
    validValidator = isIso8601(value.value);
  }
  if (spec.enum && value.kind === "string") {
    validValidator = spec.enum.includes(value.value);
  }
  if (spec.arrayItems === "string" && value.kind === "array") {
    validValidator = value.value.every((item) => item.kind === "string");
  }

  return { validType: true, validValidator };
}
