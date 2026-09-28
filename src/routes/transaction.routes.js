const { Router } = require("express");
const { authMiddleware, authSystemMiddleware } = require("../middleware/auth.middleware");
const transactionController = require("../controllers/transaction.controller");
const validate = require("../middleware/validate.middleware");
const { createTransactionSchema, depositSchema } = require("../validators/transaction.validator");

const router = Router();

router.post("/", authMiddleware, validate(createTransactionSchema), transactionController.createTransaction);

// System-only: fund a user's account (sandbox top-up / admin credit).
router.post(
  "/deposits",
  authSystemMiddleware,
  validate(depositSchema),
  transactionController.createDeposit,
);

router.get("/", authMiddleware, transactionController.getMyTransactions);
router.get("/export.csv", authMiddleware, transactionController.exportTransactionsCsv);

// Dev/demo convenience - see controller for the production guard.
router.post(
  "/sandbox-topup",
  authMiddleware,
  validate(depositSchema),
  transactionController.sandboxTopUp,
);

router.get("/:transactionId", authMiddleware, transactionController.getTransactionById);

module.exports = router;
