import assert from "node:assert/strict";
import test from "node:test";

import { graphRequest } from "../dist/meta-api.js";

test("graphRequest blocks POST mutations when META_ADS_DISABLE_MUTATIONS=1", async () => {
  const original = process.env.META_ADS_DISABLE_MUTATIONS;
  process.env.META_ADS_DISABLE_MUTATIONS = "1";

  try {
    await assert.rejects(
      graphRequest({
        path: "123",
        method: "POST",
        accessToken: "token",
        body: { status: "PAUSED" },
      }),
      /META_ADS_DISABLE_MUTATIONS/
    );
  } finally {
    if (original === undefined) {
      delete process.env.META_ADS_DISABLE_MUTATIONS;
    } else {
      process.env.META_ADS_DISABLE_MUTATIONS = original;
    }
  }
});
