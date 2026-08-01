import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeImageUrls,
  publishCarouselPost,
  publishSocialPost,
} from "../dist/social-publish.js";

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

test("normalizeImageUrls requires at least 2 URLs", () => {
  assert.throws(
    () => normalizeImageUrls(["https://example.com/one.jpg"]),
    /at least 2 image URLs/
  );
});

test("normalizeImageUrls rejects more than 10 URLs", () => {
  const urls = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}.jpg`);
  assert.throws(() => normalizeImageUrls(urls), /up to 10 images/);
});

test("publishCarouselPost rejects empty message before API calls", async () => {
  await assert.rejects(
    () =>
      publishCarouselPost(
        {
          page_id: "123",
          message: "",
          image_urls: [
            "https://example.com/1.jpg",
            "https://example.com/2.jpg",
          ],
          platforms: ["facebook"],
        },
        "token"
      ),
    /message is required/
  );
});
