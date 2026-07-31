import assert from "node:assert/strict";
import test from "node:test";

import { publishSocialPost } from "../dist/social-publish.js";

test("publishSocialPost rejects empty message before API calls", async () => {
  await assert.rejects(
    () =>
      publishSocialPost(
        {
          page_id: "123",
          message: "   ",
          platforms: ["facebook"],
        },
        "token"
      ),
    /message is required/
  );
});

test("publishSocialPost rejects invalid platform names", async () => {
  await assert.rejects(
    () =>
      publishSocialPost(
        {
          page_id: "123",
          message: "hello",
          platforms: ["twitter"],
        },
        "token"
      ),
    /Invalid platform/
  );
});
