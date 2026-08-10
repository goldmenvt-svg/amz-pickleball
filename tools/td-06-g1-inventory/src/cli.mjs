import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInventoryAccumulator } from "./analyze.mjs";
import { createFirestoreReadOnlyTransport } from "./firestore-readonly.mjs";
import {
  CANONICAL_PLAN_SHA256,
  COLLECTIONS,
  OFFICIAL_BASELINE_SHA,
  REPORT_SCHEMA_VERSION,
  canonicalText,
} from "./policy.mjs";

const SOURCE_FILES = Object.freeze([
  "./policy.mjs",
  "./analyze.mjs",
  "./firestore-readonly.mjs",
  "./cli.mjs",
  "../schema/aggregate-report.schema.json",
]);

class GateError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const allowed = new Set([
    "mode",
    "project-id",
    "database-id",
    "operator-label",
    "tool-git-commit",
    "emulator-proof-sha256",
    "max-documents",
    "max-reads",
    "max-duration-ms",
    "request-timeout-ms",
    "max-errors",
    "max-drift",
    "max-cost-micros",
    "cost-micros-per-read",
    "aggregation-entry-unit",
  ]);
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith("--") || value === undefined) throw new GateError("INVALID_ARGUMENTS");
    const key = token.slice(2);
    if (!allowed.has(key) || Object.hasOwn(args, key)) throw new GateError("INVALID_ARGUMENTS");
    args[key] = value;
  }
  return args;
}

function positiveInteger(value, code, { allowZero = false } = {}) {
  if (!/^\d+$/.test(value ?? "")) throw new GateError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (allowZero ? parsed < 0 : parsed <= 0)) {
    throw new GateError(code);
  }
  return parsed;
}

async function canonicalFileSha(url) {
  return sha256(canonicalText(await readFile(url, "utf8")));
}

async function sourceSha() {
  const parts = [];
  for (const relative of SOURCE_FILES) {
    const url = new URL(relative, import.meta.url);
    parts.push(`${relative}\n${canonicalText(await readFile(url, "utf8"))}`);
  }
  return sha256(parts.join("\n--TD06-FILE--\n"));
}

function estimateCountReads(counts, aggregationEntryUnit) {
  return COLLECTIONS.reduce(
    (sum, collection) => sum + Math.max(1, Math.ceil(counts[collection] / aggregationEntryUnit)),
    0,
  );
}

function estimateSingleCountReads(count, aggregationEntryUnit) {
  return Math.max(1, Math.ceil(count / aggregationEntryUnit));
}

function enforceBudget({ documents, reads, durationMs, errors, costMicros }, budget) {
  if (documents > budget.maxDocuments) throw new GateError("DOCUMENT_LIMIT_EXCEEDED");
  if (reads > budget.maxReads) throw new GateError("READ_LIMIT_EXCEEDED");
  if (durationMs > budget.maxDurationMs) throw new GateError("TIME_LIMIT_EXCEEDED");
  if (errors > budget.maxErrors) throw new GateError("ERROR_LIMIT_EXCEEDED");
  if (costMicros > budget.maxCostMicros) throw new GateError("COST_LIMIT_EXCEEDED");
}

function zeroCollections(docTotals) {
  return Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection,
      {
        DOC_TOTAL: docTotals[collection],
        DOC_SCANNED: 0,
        READ_ERROR_COUNT: 0,
      },
    ]),
  );
}

function validateAggregateOnlyReport(report) {
  const serialized = JSON.stringify(report);
  const forbiddenKeys = ["documentId", "documentPath", "rawDocument", "sampleValue", "recordId"];
  if (forbiddenKeys.some((key) => serialized.includes(`\"${key}\"`))) {
    throw new GateError("PII_OUTPUT_SCAN_FAILED");
  }
  if (!/^[a-f0-9]{64}$/.test(report.runMetadata.projectDatabaseSha256)) {
    throw new GateError("REPORT_SCHEMA_INVALID");
  }
  if (report.result.status !== "COMPLETE" && report.result.status !== "GATE_HOLD") {
    throw new GateError("REPORT_SCHEMA_INVALID");
  }
}

function stoppedEnvelope(code) {
  const zeroHash = "0".repeat(64);
  const zeroGitSha = "0".repeat(40);
  const counts = { players: 0, tournaments: 0, events: 0 };
  const now = new Date().toISOString();
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runMetadata: {
      mode: "NOT_STARTED",
      planSha256: CANONICAL_PLAN_SHA256,
      toolSourceSha256: zeroHash,
      toolGitCommit: zeroGitSha,
      baselineSha: OFFICIAL_BASELINE_SHA,
      environment: "unverified",
      projectDatabaseSha256: zeroHash,
      operatorLabel: "UNVERIFIED",
      startedAt: now,
      finishedAt: now,
    },
    readBudget: {
      preliminaryDocuments: 0,
      maxDocuments: 0,
      maxReads: 0,
      maxDurationMs: 0,
      maxErrors: 0,
      maxEstimatedCostMicros: 0,
      documentsRead: 0,
      readsUsedEstimate: 0,
      estimatedCostMicros: 0,
      aggregationEntryUnit: 0,
      costMicrosPerRead: 0,
      durationMs: 0,
    },
    collections: zeroCollections(counts),
    drift: {
      beforeCounts: counts,
      afterCounts: { ...counts },
      delta: { ...counts },
      absoluteDrift: 0,
      approvedMaximum: 0,
      detected: false,
      readWindowIsAtomic: false,
    },
    controls: {
      firestoreWritePathPresent: false,
      transportEndpointAllowlistEnforced: true,
      reportSchemaValidation: "NOT_RUN",
      aggregateOnlyOutputValidation: "PASS",
      emulatorProofSha256: zeroHash,
    },
    result: {
      status: "STOPPED",
      reasonCode: /^[A-Z0-9_]+$/.test(code) ? code : "INTERNAL_ERROR",
      inventoryComplete: false,
    },
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (!["count-only", "full"].includes(args.mode)) throw new GateError("MODE_NOT_ALLOWED");
  if (!/^[A-Z0-9_-]{1,32}$/.test(args["operator-label"] ?? "")) {
    throw new GateError("OPERATOR_LABEL_INVALID");
  }
  if (!/^[a-f0-9]{40}$/.test(args["tool-git-commit"] ?? "")) {
    throw new GateError("TOOL_COMMIT_INVALID");
  }
  if (!/^[a-f0-9]{64}$/.test(args["emulator-proof-sha256"] ?? "")) {
    throw new GateError("EMULATOR_PROOF_INVALID");
  }

  const approvedProject = process.env.TD06_APPROVED_PROJECT_ID;
  const approvedDatabase = process.env.TD06_APPROVED_DATABASE_ID;
  if (!approvedProject || !approvedDatabase) throw new GateError("APPROVED_TARGET_MISSING");
  if (args["project-id"] !== approvedProject || args["database-id"] !== approvedDatabase) {
    throw new GateError("PROJECT_MISMATCH");
  }

  const budget = {
    maxDocuments: positiveInteger(args["max-documents"], "INVALID_DOCUMENT_LIMIT"),
    maxReads: positiveInteger(args["max-reads"], "INVALID_READ_LIMIT"),
    maxDurationMs: positiveInteger(args["max-duration-ms"], "INVALID_TIME_LIMIT"),
    maxErrors: positiveInteger(args["max-errors"], "INVALID_ERROR_LIMIT", { allowZero: true }),
    maxDrift: positiveInteger(args["max-drift"], "INVALID_DRIFT_LIMIT", { allowZero: true }),
    maxCostMicros: positiveInteger(args["max-cost-micros"], "INVALID_COST_LIMIT"),
    costMicrosPerRead: positiveInteger(args["cost-micros-per-read"], "INVALID_READ_COST"),
    aggregationEntryUnit: positiveInteger(args["aggregation-entry-unit"], "INVALID_AGGREGATION_UNIT"),
  };
  const requestTimeoutMs = positiveInteger(args["request-timeout-ms"], "INVALID_REQUEST_TIMEOUT");

  const planUrl = new URL(
    "../../../docs/evidence/TD-06/G1-scope-and-inventory-plan.md",
    import.meta.url,
  );
  if ((await canonicalFileSha(planUrl)) !== CANONICAL_PLAN_SHA256) {
    throw new GateError("PLAN_HASH_MISMATCH");
  }

  const approvedToolSourceSha256 = process.env.TD06_APPROVED_TOOL_SOURCE_SHA256;
  const approvedToolGitCommit = process.env.TD06_APPROVED_TOOL_GIT_COMMIT;
  const approvedEmulatorProofSha256 = process.env.TD06_APPROVED_EMULATOR_PROOF_SHA256;
  if (!/^[a-f0-9]{64}$/.test(approvedToolSourceSha256 ?? "")) {
    throw new GateError("APPROVED_TOOL_SOURCE_MISSING");
  }
  if (!/^[a-f0-9]{40}$/.test(approvedToolGitCommit ?? "")) {
    throw new GateError("APPROVED_TOOL_COMMIT_MISSING");
  }
  if (!/^[a-f0-9]{64}$/.test(approvedEmulatorProofSha256 ?? "")) {
    throw new GateError("APPROVED_EMULATOR_PROOF_MISSING");
  }

  const verifiedToolSourceSha256 = await sourceSha();
  if (verifiedToolSourceSha256 !== approvedToolSourceSha256) {
    throw new GateError("TOOL_SOURCE_HASH_MISMATCH");
  }
  if (args["tool-git-commit"] !== approvedToolGitCommit) {
    throw new GateError("TOOL_COMMIT_MISMATCH");
  }

  const proofUrl = new URL(
    "../docs/evidence/G1-P2-fake-transport-proof.json",
    import.meta.url,
  );
  const verifiedEmulatorProofSha256 = await canonicalFileSha(proofUrl);
  if (
    args["emulator-proof-sha256"] !== approvedEmulatorProofSha256 ||
    verifiedEmulatorProofSha256 !== approvedEmulatorProofSha256
  ) {
    throw new GateError("EMULATOR_PROOF_MISMATCH");
  }

  const accessToken = process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  if (!accessToken) throw new GateError("AUTH_DENIED");

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const deadlineMs = startedMs + budget.maxDurationMs;
  if (!Number.isSafeInteger(deadlineMs)) throw new GateError("INVALID_TIME_LIMIT");
  const minimumInitialCountReads =
    COLLECTIONS.length * (args.mode === "full" ? 2 : 1);
  enforceBudget(
    {
      documents: 0,
      reads: minimumInitialCountReads,
      durationMs: Date.now() - startedMs,
      errors: 0,
      costMicros: minimumInitialCountReads * budget.costMicrosPerRead,
    },
    budget,
  );

  const transport = createFirestoreReadOnlyTransport({
    projectId: args["project-id"],
    databaseId: args["database-id"],
    accessToken,
    requestTimeoutMs,
    deadlineMs,
    maxPages: budget.maxDocuments,
  });

  const beforeCounts = {};
  let preliminaryDocuments = 0;
  let beforeCountReads = 0;
  for (let index = 0; index < COLLECTIONS.length; index += 1) {
    const collection = COLLECTIONS[index];
    const minimumRemainingBeforeCounts = COLLECTIONS.length - index;
    const minimumAfterCounts = args.mode === "full" ? COLLECTIONS.length : 0;
    const reservedDocumentReads = args.mode === "full" ? preliminaryDocuments : 0;
    const minimumReservedReads =
      beforeCountReads +
      minimumRemainingBeforeCounts +
      minimumAfterCounts +
      reservedDocumentReads;
    enforceBudget(
      {
        documents: preliminaryDocuments,
        reads: minimumReservedReads,
        durationMs: Date.now() - startedMs,
        errors: 0,
        costMicros: minimumReservedReads * budget.costMicrosPerRead,
      },
      budget,
    );

    const count = await transport.count(collection);
    beforeCounts[collection] = count;
    preliminaryDocuments += count;
    beforeCountReads += estimateSingleCountReads(count, budget.aggregationEntryUnit);
  }

  enforceBudget(
    {
      documents: preliminaryDocuments,
      reads: beforeCountReads,
      durationMs: Date.now() - startedMs,
      errors: 0,
      costMicros: beforeCountReads * budget.costMicrosPerRead,
    },
    budget,
  );

  let collections = zeroCollections(beforeCounts);
  let afterCounts = { ...beforeCounts };
  let documentsRead = 0;
  let readsUsed = beforeCountReads;

  if (args.mode === "full") {
    const reservedAfterCountReads = beforeCountReads;
    enforceBudget(
      {
        documents: preliminaryDocuments,
        reads: beforeCountReads + preliminaryDocuments + reservedAfterCountReads,
        durationMs: Date.now() - startedMs,
        errors: 0,
        costMicros:
          (beforeCountReads + preliminaryDocuments + reservedAfterCountReads) *
          budget.costMicrosPerRead,
      },
      budget,
    );
    const accumulator = createInventoryAccumulator(beforeCounts);
    for (const collection of COLLECTIONS) {
      for await (const document of transport.documents(collection, {
        maxDocuments: beforeCounts[collection],
      })) {
        documentsRead += 1;
        readsUsed += 1;
        enforceBudget(
          {
            documents: documentsRead,
            reads: readsUsed + reservedAfterCountReads,
            durationMs: Date.now() - startedMs,
            errors: 0,
            costMicros: (readsUsed + reservedAfterCountReads) * budget.costMicrosPerRead,
          },
          budget,
        );
        accumulator.observe(collection, document);
      }
    }
    collections = accumulator.finish();
    afterCounts = {};
    let afterCountReads = 0;
    for (let index = 0; index < COLLECTIONS.length; index += 1) {
      const collection = COLLECTIONS[index];
      const minimumRemainingAfterCounts = COLLECTIONS.length - index;
      const minimumReservedReads = readsUsed + afterCountReads + minimumRemainingAfterCounts;
      enforceBudget(
        {
          documents: documentsRead,
          reads: minimumReservedReads,
          durationMs: Date.now() - startedMs,
          errors: 0,
          costMicros: minimumReservedReads * budget.costMicrosPerRead,
        },
        budget,
      );

      const count = await transport.count(collection);
      afterCounts[collection] = count;
      afterCountReads += estimateSingleCountReads(count, budget.aggregationEntryUnit);
    }
    readsUsed += afterCountReads;
  }

  const drift = Object.fromEntries(
    COLLECTIONS.map((collection) => [
      collection,
      afterCounts[collection] - beforeCounts[collection],
    ]),
  );
  const absoluteDrift = COLLECTIONS.reduce(
    (sum, collection) => sum + Math.abs(drift[collection]),
    0,
  );
  const durationMs = Date.now() - startedMs;
  const estimatedCostMicros = readsUsed * budget.costMicrosPerRead;
  enforceBudget(
    { documents: documentsRead, reads: readsUsed, durationMs, errors: 0, costMicros: estimatedCostMicros },
    budget,
  );

  const inventoryComplete =
    args.mode === "full" &&
    COLLECTIONS.every(
      (collection) => collections[collection].DOC_SCANNED === collections[collection].DOC_TOTAL,
    ) &&
    absoluteDrift <= budget.maxDrift;

  const report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    runMetadata: {
      mode: args.mode === "full" ? "FULL_AGGREGATE" : "COUNT_ONLY",
      planSha256: CANONICAL_PLAN_SHA256,
      toolSourceSha256: verifiedToolSourceSha256,
      toolGitCommit: args["tool-git-commit"],
      baselineSha: OFFICIAL_BASELINE_SHA,
      environment: "production",
      projectDatabaseSha256: sha256(`${args["project-id"]}\n${args["database-id"]}`),
      operatorLabel: args["operator-label"],
      startedAt,
      finishedAt: new Date().toISOString(),
    },
    readBudget: {
      preliminaryDocuments,
      maxDocuments: budget.maxDocuments,
      maxReads: budget.maxReads,
      maxDurationMs: budget.maxDurationMs,
      maxErrors: budget.maxErrors,
      maxEstimatedCostMicros: budget.maxCostMicros,
      documentsRead,
      readsUsedEstimate: readsUsed,
      estimatedCostMicros,
      aggregationEntryUnit: budget.aggregationEntryUnit,
      costMicrosPerRead: budget.costMicrosPerRead,
      durationMs,
    },
    collections,
    drift: {
      beforeCounts,
      afterCounts,
      delta: drift,
      absoluteDrift,
      approvedMaximum: budget.maxDrift,
      detected: absoluteDrift > 0,
      readWindowIsAtomic: false,
    },
    controls: {
      firestoreWritePathPresent: false,
      transportEndpointAllowlistEnforced: true,
      reportSchemaValidation: "PASS",
      aggregateOnlyOutputValidation: "PASS",
      emulatorProofSha256: args["emulator-proof-sha256"],
    },
    result: {
      status: inventoryComplete || args.mode === "count-only" ? "COMPLETE" : "GATE_HOLD",
      reasonCode:
        args.mode === "count-only"
          ? "COUNT_ONLY_PREFLIGHT_COMPLETE"
          : inventoryComplete
            ? "FULL_AGGREGATE_COMPLETE"
            : "DRIFT_OR_INCOMPLETE",
      inventoryComplete,
    },
  };

  validateAggregateOnlyReport(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run().catch((error) => {
  process.stdout.write(`${JSON.stringify(stoppedEnvelope(error?.code ?? "INTERNAL_ERROR"))}\n`);
  process.exitCode = 1;
});
