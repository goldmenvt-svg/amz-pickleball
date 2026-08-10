import assert from "node:assert/strict";
import test from "node:test";
import {
  createFirestoreReadOnlyTransport,
  ReadOnlyTransportError,
} from "../src/firestore-readonly.mjs";

const originalFetch = globalThis.fetch;

function transport(options = {}) {
  return createFirestoreReadOnlyTransport({
    projectId: "synthetic-project",
    databaseId: "synthetic-database",
    accessToken: "synthetic-noncredential-token",
    requestTimeoutMs: 1000,
    deadlineMs: Date.now() + 10000,
    pageSize: 2,
    maxPages: 3,
    ...options,
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("count uses only the read-only aggregation endpoint", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      json: async () => ({
        result: { aggregateFields: { doc_count: { integerValue: "4" } } },
      }),
    };
  };

  assert.equal(await transport().count("players"), 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.match(calls[0].url, /\/documents:runAggregationQuery$/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.structuredAggregationQuery.structuredQuery.from[0].collectionId, "players");
  assert.equal(JSON.stringify(body).includes("write"), false);
});

test("documents reads bounded pages with GET only", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    const pageToken = new URL(url).searchParams.get("pageToken");
    return {
      ok: true,
      json: async () =>
        pageToken
          ? { documents: [{ name: "synthetic-2", fields: {} }] }
          : {
              documents: [{ name: "synthetic-1", fields: {} }],
              nextPageToken: "synthetic-next",
            },
    };
  };

  const documents = [];
  for await (const document of transport().documents("events", { maxDocuments: 2 })) {
    documents.push(document);
  }
  assert.equal(documents.length, 2);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET"]);
  assert.ok(calls.every((call) => /\/documents\/events\?/.test(call.url)));
});

test("pagination token cycle fails closed", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ documents: [], nextPageToken: "cycle" }),
  });
  await assert.rejects(
    async () => {
      for await (const _document of transport().documents("players", { maxDocuments: 3 })) {
        // Intentionally empty.
      }
    },
    (error) => error instanceof ReadOnlyTransportError && error.code === "PAGINATION_CYCLE",
  );
});

test("page limit stops unique unbounded tokens", async () => {
  let page = 0;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ documents: [], nextPageToken: `page-${++page}` }),
  });
  await assert.rejects(
    async () => {
      for await (const _document of transport({ maxPages: 2 }).documents("players", {
        maxDocuments: 3,
      })) {
        // Intentionally empty.
      }
    },
    (error) => error instanceof ReadOnlyTransportError && error.code === "PAGE_LIMIT_EXCEEDED",
  );
});

test("document limit bounds pageSize and stops before an extra request", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return {
      ok: true,
      json: async () => ({
        documents: [{ name: "synthetic-1", fields: {} }],
        nextPageToken: "more-exists",
      }),
    };
  };

  await assert.rejects(
    async () => {
      for await (const _document of transport().documents("events", { maxDocuments: 1 })) {
        // Intentionally empty.
      }
    },
    (error) =>
      error instanceof ReadOnlyTransportError && error.code === "DOCUMENT_LIMIT_EXCEEDED",
  );
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("pageSize"), "1");
});

test("expired deadline fails before fetch", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("must not run");
  };

  await assert.rejects(
    () => transport({ deadlineMs: Date.now() - 1 }).count("players"),
    (error) =>
      error instanceof ReadOnlyTransportError && error.code === "TIME_LIMIT_EXCEEDED",
  );
  assert.equal(fetchCalls, 0);
});

test("collection allowlist and remote errors expose fixed codes only", async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: false, json: async () => ({ secret: "must-not-be-read" }) };
  };

  await assert.rejects(
    () => transport().count("settings"),
    (error) => error.code === "COLLECTION_NOT_ALLOWED",
  );
  assert.equal(fetchCalls, 0);

  await assert.rejects(
    () => transport().count("players"),
    (error) =>
      error instanceof ReadOnlyTransportError &&
      error.code === "QUERY_FAILED" &&
      !String(error).includes("must-not-be-read"),
  );
});
