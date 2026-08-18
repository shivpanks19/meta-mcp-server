import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReel,
  computeOrganicStrengthScore,
  filterMediaByDateRange,
  filterMediaByType,
  isInstagramReelsTool,
  isReelMedia,
  isUnsupportedMetricError,
  median,
  parseDateRange,
  parseInsightsResponse,
  percentileRank,
  safeDivide,
} from "../dist/instagram-reels.js";
import { MetaGraphError } from "../dist/meta-api.js";

test("isInstagramReelsTool recognizes reel analytics tools", () => {
  assert.equal(isInstagramReelsTool("meta_get_instagram_reel_analytics"), true);
  assert.equal(isInstagramReelsTool("meta_list_pages"), false);
});

test("isReelMedia uses media_product_type REELS only", () => {
  assert.equal(isReelMedia({ id: "1", media_product_type: "REELS" }), true);
  assert.equal(
    isReelMedia({ id: "2", media_type: "VIDEO", media_product_type: "FEED" }),
    false
  );
  assert.equal(isReelMedia({ id: "3", media_type: "VIDEO" }), false);
});

test("filterMediaByType REELS", () => {
  const items = [
    { id: "1", media_product_type: "REELS" },
    { id: "2", media_type: "VIDEO", media_product_type: "FEED" },
    { id: "3", media_type: "IMAGE" },
  ];
  const reels = filterMediaByType(items, "REELS");
  assert.equal(reels.length, 1);
  assert.equal(reels[0].id, "1");
});

test("filterMediaByDateRange applies since/until", () => {
  const items = [
    { id: "1", timestamp: "2026-07-15T10:00:00+0000" },
    { id: "2", timestamp: "2026-08-01T10:00:00+0000" },
    { id: "3", timestamp: "2026-09-01T10:00:00+0000" },
  ];
  const { sinceMs, untilMs } = parseDateRange("2026-07-01", "2026-08-18");
  const filtered = filterMediaByDateRange(items, sinceMs, untilMs);
  assert.deepEqual(filtered.map((i) => i.id), ["1", "2"]);
});

test("parseDateRange rejects invalid dates", () => {
  assert.throws(() => parseDateRange("bad-date"), /Invalid since/);
});

test("safeDivide handles division by zero", () => {
  assert.equal(safeDivide(10, 0), null);
  assert.equal(safeDivide(10, 2), 5);
  assert.equal(safeDivide(null, 5), null);
});

test("median returns null for empty array", () => {
  assert.equal(median([]), null);
  assert.equal(median([1, 3, 2]), 2);
});

test("parseInsightsResponse uses null not zero for missing metrics", () => {
  const parsed = parseInsightsResponse([
    { name: "reach", values: [{ value: 100 }] },
    { name: "views", values: [{ value: 200 }] },
  ]);
  assert.equal(parsed.insights.reach, 100);
  assert.equal(parsed.insights.views, 200);
  assert.equal(parsed.insights.shares, null);
  assert.equal(parsed.paid_vs_organic_available, false);
});

test("isUnsupportedMetricError detects metric errors", () => {
  const err = new MetaGraphError("metric not valid", 100, {
    error: { code: 100, message: "metric not valid" },
  });
  assert.equal(isUnsupportedMetricError(err), true);
});

test("classifyReel returns INSUFFICIENT_DATA without metrics", () => {
  const result = classifyReel({
    reach: null,
    views: null,
    engagement_rate: null,
    share_rate: null,
    save_rate: null,
    follow_rate: null,
    profile_conversion_rate: null,
    view_to_reach_ratio: null,
    reach_percentile: null,
    engagement_percentile: null,
    share_percentile: null,
    save_percentile: null,
    follow_percentile: null,
    is_promoted: null,
    paid_reach: null,
    organic_reach: null,
    paid_vs_organic_available: false,
    has_minimum_metrics: false,
  });
  assert.equal(result.classification, "INSUFFICIENT_DATA");
});

test("classifyReel PAID_DEPENDENT when paid reach dominates", () => {
  const result = classifyReel({
    reach: 1000,
    views: 2000,
    engagement_rate: 0.1,
    share_rate: 0.02,
    save_rate: 0.01,
    follow_rate: 0.01,
    profile_conversion_rate: null,
    view_to_reach_ratio: 2,
    reach_percentile: 50,
    engagement_percentile: 50,
    share_percentile: 50,
    save_percentile: 50,
    follow_percentile: 50,
    is_promoted: true,
    paid_reach: 800,
    organic_reach: 200,
    paid_vs_organic_available: true,
    has_minimum_metrics: true,
  });
  assert.equal(result.classification, "PAID_DEPENDENT");
});

test("classifyReel ORGANIC_WINNER at high percentiles", () => {
  const result = classifyReel({
    reach: 10000,
    views: 15000,
    engagement_rate: 0.12,
    share_rate: 0.05,
    save_rate: 0.04,
    follow_rate: 0.03,
    profile_conversion_rate: 0.5,
    view_to_reach_ratio: 1.5,
    reach_percentile: 90,
    engagement_percentile: 80,
    share_percentile: 85,
    save_percentile: 70,
    follow_percentile: 60,
    is_promoted: false,
    paid_reach: null,
    organic_reach: null,
    paid_vs_organic_available: false,
    has_minimum_metrics: true,
  });
  assert.equal(result.classification, "ORGANIC_WINNER");
});

test("computeOrganicStrengthScore averages percentiles", () => {
  assert.equal(
    computeOrganicStrengthScore({
      reach: 80,
      engagement: 60,
      share: 70,
      save: 50,
      follow: 40,
    }),
    60
  );
});

test("percentileRank handles empty population", () => {
  assert.equal(percentileRank(5, []), null);
});
