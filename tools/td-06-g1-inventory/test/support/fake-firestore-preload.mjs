import { readFile } from "node:fs/promises";

const fixture = JSON.parse(
  await readFile(new URL("../../fixtures/synthetic-firestore-documents.json", import.meta.url), "utf8"),
);

const proof = {
  transport: "synthetic-fake-fetch",
  totalRequests: 0,
  aggregationReads: 0,
  documentReads: 0,
  writeRequests: 0,
  rejectedRequests: 0,
  networkRequests: 0,
};

function jsonResponse(payload) {
  return { ok: true, json: async () => payload };
}

function requestMethod(input, options) {
  return String(options?.method ?? input?.method ?? "GET").toUpperCase();
}

async function applyConfiguredDelay(signal) {
  const delayMs = Number(process.env.TD06_FAKE_DELAY_MS ?? "0");
  if (!Number.isSafeInteger(delayMs) || delayMs <= 0) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      const error = new Error("synthetic abort");
      error.name = "AbortError";
      reject(error);
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

globalThis.fetch = async (input, options = {}) => {
  proof.totalRequests += 1;
  const url = new URL(input instanceof URL ? input.href : input?.url ?? input);
  const method = requestMethod(input, options);

  await applyConfiguredDelay(options.signal);

  if (url.hostname !== "firestore.googleapis.com") {
    proof.rejectedRequests += 1;
    throw new Error("FAKE_TRANSPORT_ENDPOINT_REJECTED");
  }

  if (method === "POST" && url.pathname.endsWith("/documents:runAggregationQuery")) {
    const body = JSON.parse(options.body ?? "{}");
    const collection = body?.structuredAggregationQuery?.structuredQuery?.from?.[0]?.collectionId;
    const documents = fixture.collections[collection];
    if (!documents) {
      proof.rejectedRequests += 1;
      throw new Error("FAKE_TRANSPORT_COLLECTION_REJECTED");
    }
    proof.aggregationReads += 1;
    return jsonResponse({
      result: { aggregateFields: { doc_count: { integerValue: String(documents.length) } } },
    });
  }

  if (method === "GET" && url.pathname.includes("/documents/")) {
    const collection = decodeURIComponent(url.pathname.split("/documents/")[1] ?? "");
    const documents = fixture.collections[collection];
    if (!documents) {
      proof.rejectedRequests += 1;
      throw new Error("FAKE_TRANSPORT_COLLECTION_REJECTED");
    }
    const pageToken = url.searchParams.get("pageToken") ?? "";
    const start = pageToken === "synthetic-page-2" ? 2 : 0;
    if (pageToken && pageToken !== "synthetic-page-2") {
      proof.rejectedRequests += 1;
      throw new Error("FAKE_TRANSPORT_PAGE_TOKEN_REJECTED");
    }
    const page = documents.slice(start, start + 2);
    proof.documentReads += 1;
    return jsonResponse({
      documents: page,
      ...(start === 0 && documents.length > 2 ? { nextPageToken: "synthetic-page-2" } : {}),
    });
  }

  proof.writeRequests += 1;
  throw new Error("FAKE_TRANSPORT_WRITE_REJECTED");
};

process.on("exit", () => {
  process.stderr.write(`TD06_FAKE_TRANSPORT_PROOF ${JSON.stringify(proof)}\n`);
});
