import "dotenv/config";

import Fastify, { LogController } from "fastify";

import { closeDatabase } from "./db/client.js";
import { registerGarminConnectRoutes } from "./garmin-connect/routes.js";
import { registerGarminLiveRoutes } from "./garmin-live/routes.js";

const app = Fastify({
  logger: true,
  // The Garmin webhook uses an opaque path token; avoid putting it in request logs.
  logController: new LogController({ disableRequestLogging: true }),
  bodyLimit: 20 * 1024 * 1024,
});

app.get("/health", async () => ({ status: "ok" }));
await registerGarminConnectRoutes(app);
await registerGarminLiveRoutes(app);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const message = error instanceof Error ? error.message : "Unknown error";
  const statusCode = message.startsWith("subjectId") ? 400 : 500;
  void reply.code(statusCode).send({
    error: statusCode === 400 ? message : "Internal server error",
  });
});

const shutdown = async () => {
  await app.close();
  await closeDatabase();
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST?.trim() || "0.0.0.0";
await app.listen({ port, host });
