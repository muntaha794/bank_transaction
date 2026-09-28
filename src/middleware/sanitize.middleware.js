// express-mongo-sanitize reassigns req.query wholesale, which breaks on
// Express 5 (req.query is a getter-only accessor there). This strips
// Mongo operator keys ($gt, $where, ...) and dotted keys in place instead.
function sanitizeValue(value) {
  if (Array.isArray(value)) {
    value.forEach(sanitizeValue);
    return value;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (key.startsWith("$") || key.includes(".")) {
        delete value[key];
        continue;
      }
      sanitizeValue(value[key]);
    }
  }
  return value;
}

function mongoSanitize() {
  return (req, res, next) => {
    if (req.body) sanitizeValue(req.body);
    if (req.params) sanitizeValue(req.params);
    if (req.query) sanitizeValue(req.query); // mutate keys in place, never reassign req.query
    next();
  };
}

module.exports = mongoSanitize;
