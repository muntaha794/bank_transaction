const express = require("express");
const rateLimit = require("express-rate-limit");
const authController = require("../controllers/auth.controller");
const { authMiddleware } = require("../middleware/auth.middleware");
const validate = require("../middleware/validate.middleware");
const { registerSchema, loginSchema } = require("../validators/auth.validator");

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "too many attempts, please try again later" },
});

router.post("/register", authLimiter, validate(registerSchema), authController.userRegisterController);
router.post("/login", authLimiter, validate(loginSchema), authController.userLoginController);
router.post("/refresh-token", authLimiter, authController.refreshTokenController);
router.post("/logout", authController.userLogoutController);
router.get("/me", authMiddleware, authController.getCurrentUserController);

module.exports = router;
