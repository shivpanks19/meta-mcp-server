import {
  graphJsonRequest,
  graphRequest,
} from "./meta-api.js";

export function normalizeWhatsAppRecipient(to: unknown): string {
  const raw = String(to).trim();
  if (!raw) {
    throw new Error("to is required (E.164 phone number, e.g. +919730696887).");
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error(
      `Invalid phone number "${raw}". Use E.164 with country code (e.g. +919730696887).`
    );
  }
  return digits;
}

export function resolveWhatsAppAccessToken(explicit?: string): string {
  const token =
    explicit?.trim() ||
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() ||
    process.env.META_SYSTEM_USER_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "WhatsApp access token is not set. Configure WHATSAPP_ACCESS_TOKEN, META_SYSTEM_USER_TOKEN, or META_ACCESS_TOKEN with whatsapp_business_messaging permission."
    );
  }
  return token;
}

export function resolveWhatsAppPhoneNumberId(explicit?: string): string {
  const id =
    explicit?.trim() || process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!id) {
    throw new Error(
      "phone_number_id is required (pass in the call or set WHATSAPP_PHONE_NUMBER_ID)."
    );
  }
  return id;
}

export function resolveWhatsAppBusinessAccountId(explicit?: string): string {
  const id =
    explicit?.trim() || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim();
  if (!id) {
    throw new Error(
      "waba_id is required (pass waba_id or set WHATSAPP_BUSINESS_ACCOUNT_ID)."
    );
  }
  return id;
}

export async function listWhatsAppPhoneNumbers(input: {
  waba_id?: string;
  fields?: string;
  limit?: number;
  access_token?: string;
}): Promise<unknown> {
  const wabaId = resolveWhatsAppBusinessAccountId(input.waba_id);
  const token = resolveWhatsAppAccessToken(input.access_token);
  return graphRequest({
    path: `${wabaId}/phone_numbers`,
    accessToken: token,
    params: {
      fields:
        input.fields ??
        "id,display_phone_number,verified_name,quality_rating,code_verification_status",
      limit: input.limit ?? 50,
    },
  });
}

export async function sendWhatsAppTextMessage(input: {
  to: string;
  body: string;
  phone_number_id?: string;
  preview_url?: boolean;
  access_token?: string;
}): Promise<unknown> {
  const message = String(input.body).trim();
  if (!message) {
    throw new Error("body is required.");
  }

  const phoneNumberId = resolveWhatsAppPhoneNumberId(input.phone_number_id);
  const token = resolveWhatsAppAccessToken(input.access_token);
  const to = normalizeWhatsAppRecipient(input.to);

  return graphJsonRequest({
    path: `${phoneNumberId}/messages`,
    accessToken: token,
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: input.preview_url === true,
        body: message,
      },
    },
  });
}

export async function sendWhatsAppTemplateMessage(input: {
  to: string;
  template_name: string;
  language_code?: string;
  components?: unknown[];
  phone_number_id?: string;
  access_token?: string;
}): Promise<unknown> {
  const templateName = String(input.template_name).trim();
  if (!templateName) {
    throw new Error("template_name is required.");
  }

  const phoneNumberId = resolveWhatsAppPhoneNumberId(input.phone_number_id);
  const token = resolveWhatsAppAccessToken(input.access_token);
  const to = normalizeWhatsAppRecipient(input.to);
  const languageCode = (input.language_code as string | undefined)?.trim() || "en_US";

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: languageCode },
  };
  if (input.components?.length) {
    template.components = input.components;
  }

  return graphJsonRequest({
    path: `${phoneNumberId}/messages`,
    accessToken: token,
    body: {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template,
    },
  });
}

const WHATSAPP_TOOL_NAMES = new Set([
  "meta_whatsapp_list_phone_numbers",
  "meta_whatsapp_send_message",
  "meta_whatsapp_send_template",
]);

export function isWhatsAppTool(name: string): boolean {
  return WHATSAPP_TOOL_NAMES.has(name);
}

export const whatsAppToolDefinitions = [
  {
    name: "meta_whatsapp_list_phone_numbers",
    description:
      "List WhatsApp Business phone numbers for a WABA (WhatsApp Business Account). Requires whatsapp_business_management.",
    inputSchema: {
      type: "object",
      properties: {
        waba_id: {
          type: "string",
          description:
            "WhatsApp Business Account ID (default: WHATSAPP_BUSINESS_ACCOUNT_ID env)",
        },
        fields: {
          type: "string",
          description:
            "Default: id,display_phone_number,verified_name,quality_rating,code_verification_status",
        },
        limit: { type: "number", description: "Default 50" },
        access_token: {
          type: "string",
          description: "Override WHATSAPP_ACCESS_TOKEN / META_ACCESS_TOKEN",
        },
      },
    },
  },
  {
    name: "meta_whatsapp_send_message",
    description:
      "Send a WhatsApp text message via Cloud API. Works inside the 24-hour customer service window; otherwise use meta_whatsapp_send_template.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient E.164 phone (e.g. +919730696887)",
        },
        body: { type: "string", description: "Message text" },
        phone_number_id: {
          type: "string",
          description:
            "Sender phone number id (default: WHATSAPP_PHONE_NUMBER_ID env)",
        },
        preview_url: {
          type: "boolean",
          description: "Enable link preview in message (default false)",
        },
        access_token: { type: "string" },
      },
      required: ["to", "body"],
    },
  },
  {
    name: "meta_whatsapp_send_template",
    description:
      "Send an approved WhatsApp template message (required for business-initiated outreach outside the 24-hour window).",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient E.164 phone (e.g. +919730696887)",
        },
        template_name: {
          type: "string",
          description: "Approved template name in Meta Business Manager",
        },
        language_code: {
          type: "string",
          description: "BCP-47 language code (default en_US)",
        },
        components: {
          type: "array",
          description:
            "Optional template variable components (body/header/button parameters)",
          items: { type: "object" },
        },
        phone_number_id: {
          type: "string",
          description:
            "Sender phone number id (default: WHATSAPP_PHONE_NUMBER_ID env)",
        },
        access_token: { type: "string" },
      },
      required: ["to", "template_name"],
    },
  },
] as const;

export async function handleWhatsAppTool(
  name: string,
  args: Record<string, unknown>,
  _userToken: string
): Promise<unknown | null> {
  if (!isWhatsAppTool(name)) return null;

  const accessToken = args.access_token
    ? String(args.access_token).trim()
    : undefined;

  switch (name) {
    case "meta_whatsapp_list_phone_numbers":
      return listWhatsAppPhoneNumbers({
        waba_id: args.waba_id as string | undefined,
        fields: args.fields as string | undefined,
        limit: args.limit as number | undefined,
        access_token: accessToken,
      });
    case "meta_whatsapp_send_message":
      return sendWhatsAppTextMessage({
        to: String(args.to),
        body: String(args.body),
        phone_number_id: args.phone_number_id as string | undefined,
        preview_url: args.preview_url === true,
        access_token: accessToken,
      });
    case "meta_whatsapp_send_template":
      return sendWhatsAppTemplateMessage({
        to: String(args.to),
        template_name: String(args.template_name),
        language_code: args.language_code as string | undefined,
        components: args.components as unknown[] | undefined,
        phone_number_id: args.phone_number_id as string | undefined,
        access_token: accessToken,
      });
    default:
      return null;
  }
}
