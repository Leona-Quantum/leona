import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ARTIFACT_PAGE_SIZE, fetchArtifactPages } from "./artifact-page.ts";

/** Artifact ids are UUIDv7 — time-ordered — so a descending list counts down. */
function artifact(n: number) {
  return { id: `0199${String(n).padStart(8, "0")}-0000-7000-8000-000000000000`, name: `a${n}` };
}

function ok(rows: unknown[]): Response {
  return { ok: true, status: 200, json: async () => rows } as unknown as Response;
}

/**
 * A server holding `total` artifacts, ordered id DESC, honouring `cursor`
 * exactly the way `repos/artifacts.list_artifacts` does (`id < cursor`).
 */
function server(total: number, calls: string[] = []) {
  const all = Array.from({ length: total }, (_, i) => artifact(total - i));
  return {
    calls,
    read: async (query: string) => {
      calls.push(query);
      const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
      const limit = Number(params.get("limit"));
      const cursor = params.get("cursor");
      const start = cursor === null ? 0 : all.findIndex((row) => row.id === cursor) + 1;
      return ok(all.slice(start, start + limit));
    },
  };
}

describe("fetchArtifactPages", () => {
  it("reads every page, not the first one", async () => {
    // 237 is the case the old code got wrong: one un-paged fetch returned the
    // route's default 50 and nothing said the other 187 existed.
    const { read, calls } = server(237);
    const result = await fetchArtifactPages(read);
    assert.equal(result.rows.length, 237);
    assert.equal(result.complete, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[0], `?limit=${ARTIFACT_PAGE_SIZE}`);
    assert.ok(calls[1].includes("cursor="), "the second page must carry a cursor");
  });

  it("returns every row exactly once", async () => {
    const { read } = server(237);
    const { rows } = await fetchArtifactPages(read);
    const ids = rows.map((row) => (row as { id: string }).id);
    assert.equal(new Set(ids).size, 237, "a page boundary must not repeat or skip a row");
  });

  it("stops on the first short page rather than asking for one more", async () => {
    const { read, calls } = server(30);
    const result = await fetchArtifactPages(read);
    assert.equal(result.rows.length, 30);
    assert.equal(result.complete, true);
    assert.equal(calls.length, 1);
  });

  it("spends one extra request when the total is an exact multiple of the page", async () => {
    // 200 rows in pages of 100 look identical to "there is more" until asked.
    // Being wrong here would drop a whole page, so the extra round trip is the
    // deliberate trade.
    const { read, calls } = server(200);
    const result = await fetchArtifactPages(read);
    assert.equal(result.rows.length, 200);
    assert.equal(result.complete, true);
    assert.equal(calls.length, 3);
  });

  it("is complete on an empty workspace", async () => {
    const { read } = server(0);
    assert.deepEqual(await fetchArtifactPages(server(0).read), { rows: [], complete: true });
    void read;
  });

  it("reports INCOMPLETE rather than silently truncating at the page ceiling", async () => {
    // The whole point of this module is that a silent stop is the bug. A stop
    // that claims the list is whole is the same bug one layer up.
    const { read } = server(1000);
    const result = await fetchArtifactPages(read, { pageSize: 10, maxPages: 3 });
    assert.equal(result.rows.length, 30);
    assert.equal(result.complete, false);
  });

  it("reports INCOMPLETE when the server ignores the cursor, instead of looping", async () => {
    // A server that drops `cursor` returns page one forever. Terminating is the
    // minimum; saying the list is whole would be a lie about duplicated rows.
    let calls = 0;
    const page = Array.from({ length: 5 }, (_, i) => artifact(5 - i));
    const result = await fetchArtifactPages(
      async () => {
        calls += 1;
        return ok(page);
      },
      { pageSize: 5, maxPages: 20 },
    );
    assert.equal(result.complete, false);
    assert.equal(calls, 2, "it must notice on the second page, not keep asking");
  });

  it("reports INCOMPLETE when a row carries no id to page from", async () => {
    const result = await fetchArtifactPages(async () => ok([{ name: "no id here" }, {}]), {
      pageSize: 2,
      maxPages: 5,
    });
    assert.equal(result.complete, false);
    assert.equal(result.rows.length, 2);
  });

  it("throws on a failed response, the way every call site already expects", async () => {
    await assert.rejects(
      () => fetchArtifactPages(async () => ({ ok: false, status: 503 }) as unknown as Response),
      /503/,
    );
  });

  it("throws when the payload is not a list", async () => {
    await assert.rejects(
      () =>
        fetchArtifactPages(
          async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response,
        ),
      /not an array/,
    );
  });

  it("asks for the API's maximum page size, not the route default", async () => {
    // The route clamps `limit` to 100 and defaults to 50. Asking for 50 would
    // double the number of round trips for no reason.
    const { read, calls } = server(5);
    await fetchArtifactPages(read);
    assert.equal(new URLSearchParams(calls[0].slice(1)).get("limit"), "100");
  });
});
