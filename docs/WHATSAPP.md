# WhatsApp Business Cloud API

Send WhatsApp messages via Meta Graph API from the Meta MCP server.

## Environment

```bash
# Token with whatsapp_business_messaging (+ whatsapp_business_management for list)
META_ACCESS_TOKEN=
# Or dedicated WhatsApp token:
# WHATSAPP_ACCESS_TOKEN=

# Default sender (Phone number ID from Meta Business Manager → WhatsApp → API setup)
WHATSAPP_PHONE_NUMBER_ID=

# Required for meta_whatsapp_list_phone_numbers
WHATSAPP_BUSINESS_ACCOUNT_ID=
```

Find IDs in [Meta Business Manager](https://business.facebook.com/) → WhatsApp Manager → API setup.

## Permissions

| Tool | Permissions |
|------|-------------|
| `meta_whatsapp_list_phone_numbers` | `whatsapp_business_management` |
| `meta_whatsapp_send_message` | `whatsapp_business_messaging` |
| `meta_whatsapp_send_template` | `whatsapp_business_messaging` |

## Tools

| Tool | Purpose |
|------|---------|
| `meta_whatsapp_list_phone_numbers` | List numbers on a WABA |
| `meta_whatsapp_send_message` | Send free-form text (24-hour window) |
| `meta_whatsapp_send_template` | Send approved template (outbound / cold) |

## Examples

### List phone numbers

```json
{
  "waba_id": "123456789012345"
}
```

Tool: `meta_whatsapp_list_phone_numbers`

### Send text (customer messaged you within 24h)

```json
{
  "to": "+919730696887",
  "body": "Thanks for your inquiry — we'll call you shortly."
}
```

Tool: `meta_whatsapp_send_message`

### Send template (business-initiated)

```json
{
  "to": "+919730696887",
  "template_name": "hello_world",
  "language_code": "en_US"
}
```

Tool: `meta_whatsapp_send_template`

With body variables:

```json
{
  "to": "+919730696887",
  "template_name": "order_update",
  "language_code": "en_US",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Shiv" },
        { "type": "text", "text": "ORD-12345" }
      ]
    }
  ]
}
```

## Notes

- `to` must include country code (E.164). `+919730696887` is valid; spaces and `+` are stripped automatically.
- Free-text messages fail outside the **24-hour customer care window** — use templates instead.
- Mutations respect `META_ADS_DISABLE_MUTATIONS=1`.
- WhatsApp API uses JSON POST bodies (not form-urlencoded).
