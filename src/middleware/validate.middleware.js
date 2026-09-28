const ApiError = require("../utils/ApiError");

// schema is expected to validate { body, params, query }
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join(".").replace(/^body\./, ""),
        message: issue.message,
      }));
      return next(new ApiError(422, "validation failed", details));
    }

    // use the parsed (coerced/trimmed) values going forward
    req.body = result.data.body ?? req.body;
    req.query = result.data.query ?? req.query;
    next();
  };
}

module.exports = validate;
