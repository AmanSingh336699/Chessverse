import { createServer } from "node:net";
import { buildServer } from "./server.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const ensurePortAvailable = async (port: number, host: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const probe = createServer();

    probe.once("error", (error: NodeJS.ErrnoException) => {
      probe.close();
      if (error.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Stop the existing process using that port and try again.`));
        return;
      }
      reject(error);
    });

    probe.once("listening", () => {
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve();
      });
    });

    probe.listen(port, host);
  });

const host = "0.0.0.0";

try {
  await ensurePortAvailable(env.PORT, host);
} catch (error) {
  logger.error({ error, port: env.PORT }, "Configured API port is unavailable");
  process.exit(1);
}

const app = await buildServer();

try {
  await app.listen({
    port: env.PORT,
    host,
  });
} catch (error) {
  app.log.error({ error }, "Failed to start API server");
  await app.close().catch(() => undefined);
  process.exit(1);
}
