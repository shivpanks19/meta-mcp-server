import assert from "node:assert/strict";
import test from "node:test";

import {
  handleWhatsAppTool,
  isWhatsAppTool,
  normalizeWhatsAppRecipient,
  sendWhatsAppTextMessage,
} from "../dist/whatsapp.js";

test("isWhatsAppTool recognizes WhatsApp tool names", () => {
  assert.equal(isWhatsAppTool("meta_whatsapp_send_message"), true);
  assert.equal(isWhatsAppTool("meta_publish_social_post"), false);
});

test("normalizeWhatsAppRecipient strips formatting", () => {
  assert.equal(normalizeWhatsAppRecipient("+91 97306 96887"), "919730696887");
  assert.equal(normalizeWhatsAppRecipient("919730696887"), "919730696887");
});

test("normalizeWhatsAppRecipient rejects empty input", () => {
  assert.throws(
    () => normalizeWhatsAppRecipient(""),
    /to is required/
  );
});

test("sendWhatsAppTextMessage rejects empty body", async () => {
  await assert.rejects(
    () =>
      sendWhatsAppTextMessage({
        to: "+919730696887",
        body: "   ",
        phone_number_id: "123456789",
        access_token: "test-token",
      }),
    /body is required/
  );
});

test("meta_whatsapp_list_phone_numbers requires waba_id", async () => {
  const prev = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  try {
    await assert.rejects(
      () =>
        handleWhatsAppTool(
          "meta_whatsapp_list_phone_numbers",
          { access_token: "test-token" },
          "user-token"
        ),
      /WHATSAPP_BUSINESS_ACCOUNT_ID/
    );
  } finally {
    if (prev !== undefined) {
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = prev;
    }
  }
});

test("handleWhatsAppTool returns null for unknown tools", async () => {
  const result = await handleWhatsAppTool(
    "meta_unknown_tool",
    {},
    "fake-token"
  );
  assert.equal(result, null);
});
