import test from "node:test";
import assert from "node:assert/strict";

import {
  cacheTitleReviewJobs,
  getCachedTitleReviewJobs,
  invalidateTitleReviewListCache,
  prefetchTitleReviewJobs,
  titleReviewListCacheKey,
  type TitleReviewListOptions,
  type TitleReviewListResponse,
} from "./jobTitleReview";

const options: TitleReviewListOptions = {
  applierName: "Oliver Baltay",
  tab: "review_required",
  page: 1,
  limit: 500,
  q: "",
  sort: "confidence_desc",
};

function response(revision = "1"): TitleReviewListResponse {
  return {
    success: true,
    data: [],
    pagination: { page: 1, limit: 500, total: 0, totalPages: 0 },
    meta: {
      cacheSource: "memory",
      revision,
      stale: false,
      serverDurationMs: 1,
    },
  };
}

test.afterEach(() => invalidateTitleReviewListCache());

test("cache keys include paging, sorting, and search state", () => {
  assert.notEqual(
    titleReviewListCacheKey(options),
    titleReviewListCacheKey({ ...options, limit: 250 }),
  );
  assert.notEqual(
    titleReviewListCacheKey(options),
    titleReviewListCacheKey({ ...options, q: "mulesoft" }),
  );
  assert.notEqual(
    titleReviewListCacheKey(options),
    titleReviewListCacheKey({ ...options, sort: "newest" }),
  );
});

test("keeps the last successful list available for stale-while-revalidate rendering", () => {
  const cached = response("42");
  cacheTitleReviewJobs(options, cached);
  assert.equal(getCachedTitleReviewJobs(options), cached);
  assert.equal(getCachedTitleReviewJobs({ ...options, page: 2 }), null);
  invalidateTitleReviewListCache();
  assert.equal(getCachedTitleReviewJobs(options), null);
});

test("deduplicates concurrent page prefetches", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return new Response(JSON.stringify(response("99")), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const [first, second] = await Promise.all([
      prefetchTitleReviewJobs(options),
      prefetchTitleReviewJobs(options),
    ]);
    assert.equal(calls, 1);
    assert.equal(first.meta.revision, "99");
    assert.equal(second, first);
    assert.equal(getCachedTitleReviewJobs(options), first);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
