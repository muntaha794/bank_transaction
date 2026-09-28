const logger = require("../utils/logger");
const ApiError = require("../utils/ApiError");

function notFound(req, res, next) {
  next(new ApiError(404, `route not found: ${req.method} ${req.originalUrl}`));
}


function errorHandler(err, req, res, next) {
  let { statusCode, message, details } = err;

  if (err.name === "ValidationError") {
    statusCode = 422;
    message = "validation failed";
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0];
    message = field ? `${field} already exists` : "duplicate value";
  } else if (err.name === "CastError") {
    statusCode = 400;
    message = `invalid value for ${err.path}`;
  } else if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "invalid or expired token";
  }

  if (!statusCode) statusCode = 500;
  if (!message || statusCode === 500) message = statusCode === 500 ? "internal server error" : message;

  if (statusCode >= 500) {
    logger.error({ err, requestId: req.id }, "unhandled error");
  } else {
    logger.warn({ requestId: req.id, statusCode, message }, "request error");
  }

  res.status(statusCode).json({
    message,
    ...(details ? { details } : {}),
    requestId: req.id,
  });
}

module.exports = { notFound, errorHandler };
