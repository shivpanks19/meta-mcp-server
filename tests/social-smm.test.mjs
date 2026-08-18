import assert from "node:assert/strict";
import test from "node:test";

import {
  handleSocialSmmTool,
  isSocialSmmTool,
} from "../dist/social-smm.js";

test("isSocialSmmTool recognizes SMM tool names", () => {
  assert.equal(isSocialSmmTool("meta_get_page_smm_insights"), true);
  assert.equal(isSocialSmmTool("meta_list_instagram_media"), false);
});

test("meta_schedule_facebook_post rejects past timestamps", async () => {
  await assert.rejects(
    () =>
      handleSocialSmmTool(
        "meta_schedule_facebook_post",
        {
          page_id: "123",
          message: "Hello",
          scheduled_publish_time: Math.floor(Date.now() / 1000) - 60,
        },
        "fake-token"
      ),
    /at least 10 minutes in the future/
  );
});

test("meta_list_post_comments requires page_id for instagram", async () => {
  await assert.rejects(
    () =>
      handleSocialSmmTool(
        "meta_list_post_comments",
        {
          object_id: "1789",
          platform: "instagram",
        },
        "fake-token"
      ),
    /page_id is required when platform is instagram/
  );
});

test("handleSocialSmmTool returns null for unknown tools", async () => {
  const result = await handleSocialSmmTool(
    "meta_unknown_tool",
    {},
    "fake-token"
  );
  assert.equal(result, null);
});
