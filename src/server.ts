import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./common/logger/logger";
import { trackError } from "./common/observability/error-tracker";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info(`API running on http://localhost:${env.PORT}`);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
  trackError(reason, { code: "UNHANDLED_REJECTION", status: 500 });
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  trackError(err, { code: "UNCAUGHT_EXCEPTION", status: 500 });
});
