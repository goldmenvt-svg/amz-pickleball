import { COLLECTIONS } from "./policy.mjs";

export class ReadOnlyTransportError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function allowedCollection(collection) {
  if (!COLLECTIONS.includes(collection)) {
    throw new ReadOnlyTransportError("COLLECTION_NOT_ALLOWED");
  }
}

function segment(value) {
  return encodeURIComponent(value);
}

async function safeJsonFetch(url, options, { timeoutMs, timeoutCode }) {
  if (!(url instanceof URL) || url.protocol !== "https:" || url.hostname !== "firestore.googleapis.com") {
    throw new ReadOnlyTransportError("ENDPOINT_NOT_ALLOWED");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new ReadOnlyTransportError("QUERY_FAILED");
    try {
      return await response.json();
    } catch {
      throw new ReadOnlyTransportError("INVALID_REMOTE_RESPONSE");
    }
  } catch (error) {
    if (error instanceof ReadOnlyTransportError) throw error;
    if (error?.name === "AbortError") throw new ReadOnlyTransportError(timeoutCode);
    throw new ReadOnlyTransportError("QUERY_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}

export function createFirestoreReadOnlyTransport({
  projectId,
  databaseId,
  accessToken,
  requestTimeoutMs,
  deadlineMs,
  pageSize = 300,
  maxPages = 10000,
}) {
  if (!projectId || !databaseId || !accessToken) {
    throw new ReadOnlyTransportError("AUTH_OR_TARGET_MISSING");
  }
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new ReadOnlyTransportError("INVALID_TIMEOUT");
  }
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) {
    throw new ReadOnlyTransportError("INVALID_DEADLINE");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new ReadOnlyTransportError("INVALID_PAGE_SIZE");
  }
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new ReadOnlyTransportError("INVALID_PAGE_LIMIT");
  }

  const documentsRoot = `https://firestore.googleapis.com/v1/projects/${segment(projectId)}/databases/${segment(databaseId)}/documents`;
  const headers = Object.freeze({
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  });

  function requestWindow() {
    const remainingMs = deadlineMs - Date.now();
    if (remainingMs <= 0) {
      throw new ReadOnlyTransportError("TIME_LIMIT_EXCEEDED");
    }
    return {
      timeoutMs: Math.min(requestTimeoutMs, remainingMs),
      timeoutCode: remainingMs <= requestTimeoutMs ? "TIME_LIMIT_EXCEEDED" : "TIMEOUT",
    };
  }

  return Object.freeze({
    async count(collection) {
      allowedCollection(collection);
      const url = new URL(`${documentsRoot}:runAggregationQuery`);
      const body = {
        structuredAggregationQuery: {
          aggregations: [{ alias: "doc_count", count: {} }],
          structuredQuery: { from: [{ collectionId: collection }] },
        },
      };
      const payload = await safeJsonFetch(
        url,
        { method: "POST", headers, body: JSON.stringify(body) },
        requestWindow(),
      );
      const rows = Array.isArray(payload) ? payload : [payload];
      const raw = rows.find((row) => row?.result?.aggregateFields?.doc_count)?.result
        ?.aggregateFields?.doc_count?.integerValue;
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new ReadOnlyTransportError("INVALID_COUNT_RESPONSE");
      }
      return value;
    },

    async *documents(collection, { maxDocuments } = {}) {
      allowedCollection(collection);
      if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 0) {
        throw new ReadOnlyTransportError("INVALID_DOCUMENT_LIMIT");
      }
      let pageToken = "";
      let pagesRead = 0;
      let documentsRead = 0;
      const seenPageTokens = new Set();
      if (maxDocuments === 0) return;
      do {
        pagesRead += 1;
        if (pagesRead > maxPages) {
          throw new ReadOnlyTransportError("PAGE_LIMIT_EXCEEDED");
        }
        const url = new URL(`${documentsRoot}/${segment(collection)}`);
        const remainingDocuments = maxDocuments - documentsRead;
        if (remainingDocuments <= 0) {
          throw new ReadOnlyTransportError("DOCUMENT_LIMIT_EXCEEDED");
        }
        url.searchParams.set("pageSize", String(Math.min(pageSize, remainingDocuments)));
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const payload = await safeJsonFetch(
          url,
          { method: "GET", headers },
          requestWindow(),
        );
        const documents = payload?.documents ?? [];
        if (!Array.isArray(documents)) {
          throw new ReadOnlyTransportError("INVALID_DOCUMENT_RESPONSE");
        }
        if (documents.length > remainingDocuments) {
          throw new ReadOnlyTransportError("DOCUMENT_LIMIT_EXCEEDED");
        }
        for (const document of documents) {
          documentsRead += 1;
          yield document;
        }
        const nextPageToken =
          typeof payload?.nextPageToken === "string" ? payload.nextPageToken : "";
        if (nextPageToken && seenPageTokens.has(nextPageToken)) {
          throw new ReadOnlyTransportError("PAGINATION_CYCLE");
        }
        if (nextPageToken) seenPageTokens.add(nextPageToken);
        pageToken = nextPageToken;
      } while (pageToken);
    },
  });
}
