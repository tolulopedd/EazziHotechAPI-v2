import { logger } from "../logger/logger";

type ErrorContext = {
  requestId?: string;
  path?: string;
  method?: string;
  tenantId?: string;
  userId?: string;
  code?: string;
  status?: number;
};

export function trackError(err: unknown, context: ErrorContext = {}) {
  const webhookUrl = process.env.ERROR_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  const error = err instanceof Error ? err : new Error(String(err));
  const payload = {
    source: "eazzihotech-api",
    at: new Date().toISOString(),
    message: error.message,
    stack: error.stack,
    context,
  };

  void fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((sendErr) => {
    logger.warn({ err: sendErr }, "Failed to send error webhook");
  });
}
