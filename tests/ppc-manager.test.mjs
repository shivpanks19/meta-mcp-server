import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBudgetRecommendations,
  buildDeliveryDiagnostics,
  buildFatigueRecommendations,
  enrichPerformanceRows,
  extractConversions,
  summarizeBreakdowns,
  summarizePerformance,
} from "../dist/ppc-manager.js";

test("extractConversions recognizes common Meta conversion action variants", () => {
  assert.equal(
    extractConversions([
      { action_type: "link_click", value: "10" },
      { action_type: "onsite_conversion.lead_grouped", value: "3" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "2" },
    ]),
    5
  );
});

test("enrichPerformanceRows derives CTR, CPM, CPA and conversions", () => {
  const rows = enrichPerformanceRows([
    {
      adset_id: "123",
      impressions: "1000",
      clicks: "20",
      spend: "500",
      frequency: "4.2",
      actions: [{ action_type: "lead", value: "5" }],
    },
  ]);

  assert.equal(rows[0].ctr_num, 2);
  assert.equal(rows[0].cpm_num, 500);
  assert.equal(rows[0].conversions, 5);
  assert.equal(rows[0].cpa, 100);
  assert.deepEqual(summarizePerformance(rows), {
    row_count: 1,
    spend: 500,
    impressions: 1000,
    clicks: 20,
    conversions: 5,
    ctr: 2,
    cpc: 25,
    cpa: 100,
  });
});

test("fatigue recommendations include exact follow-up mutation tools in validate-only mode", () => {
  const rows = enrichPerformanceRows([
    {
      ad_id: "ad_1",
      ad_name: "Old creative",
      impressions: "10000",
      clicks: "30",
      spend: "1500",
      ctr: "0.3",
      cpm: "800",
      frequency: "5",
      actions: [],
    },
  ]);

  const recommendations = buildFatigueRecommendations(rows, "creative");

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].priority, "high");
  assert.equal(recommendations[0].tool_to_apply, "update_meta_ad_status");
  assert.deepEqual(recommendations[0].tool_arguments, {
    ad_id: "ad_1",
    status: "PAUSED",
    validate_only: true,
  });
});

test("budget recommendations identify high-CPA ad sets against stronger peers", () => {
  const rows = enrichPerformanceRows([
    {
      adset_id: "winner",
      adset_name: "Winner",
      spend: "1000",
      impressions: "5000",
      clicks: "100",
      actions: [{ action_type: "lead", value: "10" }],
    },
    {
      adset_id: "laggard",
      adset_name: "Laggard",
      spend: "2000",
      impressions: "7000",
      clicks: "80",
      actions: [{ action_type: "lead", value: "4" }],
    },
  ]);

  const recommendations = buildBudgetRecommendations(rows);

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].entity_id, "laggard");
  assert.equal(recommendations[0].tool_to_apply, "update_meta_adset_budget");
  assert.equal(recommendations[0].tool_arguments.validate_only, true);
});

test("delivery and breakdown diagnostics surface weak segments", () => {
  const deliveryRows = enrichPerformanceRows([
    { adset_id: "no_delivery", spend: "0", impressions: "0", clicks: "0" },
  ]);
  assert.equal(buildDeliveryDiagnostics(deliveryRows)[0].priority, "high");

  const breakdownRows = enrichPerformanceRows([
    {
      publisher_platform: "facebook",
      platform_position: "feed",
      spend: "750",
      impressions: "5000",
      clicks: "5",
      ctr: "0.1",
      actions: [],
    },
  ]);
  const result = summarizeBreakdowns(breakdownRows, [
    "publisher_platform",
    "platform_position",
  ]);

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.recommendations[0].tool_to_apply, "meta_update_adset");
});
