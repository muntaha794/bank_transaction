require("dotenv").config({ quiet: true });
const http = require("http");
const app = require("./src/app");
const connectToDB = require("./src/config/db");
const { initSocket } = require("./src/realtime/socket");
const { getOrCreateTreasuryAccount } = require("./src/services/treasury.service");
const logger = require("./src/utils/logger");

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer(app);
initSocket(httpServer);

async function start() {
  try {
    await connectToDB();
  } catch (err) {
    logger.error({ err }, "failed to connect to MongoDB - server will not start");
    process.exit(1);
  }

  await getOrCreateTreasuryAccount().catch((err) => {
    logger.error({ err }, "failed to initialize treasury account - deposits will retry lazily");
  });

  httpServer.listen(PORT, () => {
    logger.info(`server running on port ${PORT}`);
  });
}

start();

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaught exception");
  process.exit(1);
});

function gracefulShutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  httpServer.close(() => {
    require("mongoose").connection.close(false).then(() => {
      logger.info("closed out remaining connections");
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
