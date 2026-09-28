const express = require("express");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const mongoSanitize = require("./middleware/sanitize.middleware");
const pinoHttp = require("pino-http");
const { randomUUID } = require("crypto");
const swaggerUi = require("swagger-ui-express");
const path = require("path");
const logger = require("./utils/logger");
const openApiSpec = require("./config/openapi");
const { notFound, errorHandler } = require("./middleware/error.middleware");
const authRouter = require("./routes/auth.routes");
const accountRouter = require("./routes/account.routes");
const transactionRouter = require("./routes/transaction.routes");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

// security & platform middleware 
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());
app.use(mongoSanitize()); //operators from user input (NoSQL injection)

// request id + structured request logging
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
});
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id,
    autoLogging: { ignore: (req) => req.url === "/health" },
  }),
);

// --- static demo UI 

app.use(express.static(path.join(__dirname, "..", "public")));

//  docs & health 
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec));
app.get("/api/openapi.json", (req, res) => res.json(openApiSpec));

// routes 
app.use("/api/auth", authRouter);
app.use("/api/accounts", accountRouter);
app.use("/api/transactions", transactionRouter);

//  errors 
app.use(notFound);
app.use(errorHandler);

module.exports = app;
