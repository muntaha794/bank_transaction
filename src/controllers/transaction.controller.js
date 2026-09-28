const mongoose = require("mongoose");
const transactionModel = require("../models/transaction.model");
const ledgerModel = require("../models/ledger.model");
const accountModel = require("../models/account.model");
const emailService = require("../services/email.service");
const { getOrCreateTreasuryAccount } = require("../services/treasury.service");
const { emitToUser } = require("../realtime/socket");
const { withTransactionRetry } = require("../utils/withTransactionRetry");
const catchAsync = require("../utils/catchAsync");
const ApiError = require("../utils/ApiError");
const logger = require("../utils/logger");

const FRAUD_FLAG_THRESHOLD = Number(process.env.FRAUD_FLAG_THRESHOLD || 100000);

async function performTransfer({
  fromAccount,
  toAccount,
  amount,
  idempotencyKey,
  note,
  type,
  initiatedBy,
}) {
  const existing = await transactionModel.findOne({
    initiatedBy,
    idempotencyKey,
  });
  if (existing) {
    return assertIdempotentReplayMatches(existing, {
      fromAccount,
      toAccount,
      amount,
      type,
    });
  }

  if (fromAccount === toAccount) {
    throw new ApiError(400, "cannot transfer an account to itself");
  }

  const flagged = amount >= FRAUD_FLAG_THRESHOLD;

  const session = await mongoose.startSession();
  let transaction;
  let toUserAccount;

  try {
    await withTransactionRetry(session, async () => {
      const debitFilter = { _id: fromAccount, status: "ACTIVE" };
      if (type !== "DEPOSIT") debitFilter.balance = { $gte: amount };

      const debited = await accountModel.findOneAndUpdate(
        debitFilter,
        { $inc: { balance: -amount } },
        { session, new: true },
      );

      if (!debited) {
        const account = await accountModel
          .findById(fromAccount)
          .session(session);
        if (!account || account.status !== "ACTIVE") {
          throw new ApiError(
            400,
            "source account could not be found or is not active",
          );
        }
        throw new ApiError(
          400,
          `insufficient balance, current balance is ${account.balance}`,
        );
      }

      const credited = await accountModel.findOneAndUpdate(
        { _id: toAccount, status: "ACTIVE" },
        { $inc: { balance: amount } },
        { session, new: true },
      );
      if (!credited) {
        throw new ApiError(
          400,
          "destination account could not be found or is not active",
        );
      }
      toUserAccount = credited;

      transaction = (
        await transactionModel.create(
          [
            {
              fromAccount,
              toAccount,
              amount,
              idempotencyKey,
              note,
              type,
              initiatedBy,
              status: "SUCCESS",
              flagged,
              flagReason: flagged
                ? `amount >= ${FRAUD_FLAG_THRESHOLD}`
                : undefined,
            },
          ],
          { session },
        )
      )[0];

      await ledgerModel.create(
        [
          {
            account: fromAccount,
            amount,
            transaction: transaction._id,
            type: "DEBIT",
          },
        ],
        {
          session,
        },
      );
      await ledgerModel.create(
        [
          {
            account: toAccount,
            amount,
            transaction: transaction._id,
            type: "CREDIT",
          },
        ],
        {
          session,
        },
      );
    });
  } catch (error) {
    if (error.code === 11000) {
      const winner = await transactionModel.findOne({
        initiatedBy,
        idempotencyKey,
      });
      if (winner)
        return assertIdempotentReplayMatches(winner, {
          fromAccount,
          toAccount,
          amount,
          type,
        });
    }

    if (error instanceof ApiError) throw error;

    logger.error({ err: error, idempotencyKey }, "transfer failed");
    throw new ApiError(500, "transaction could not be completed, please retry");
  } finally {
    session.endSession();
  }

  return { transaction, replayed: false, toUserAccount };
}

function assertIdempotentReplayMatches(
  existing,
  { fromAccount, toAccount, amount, type },
) {
  const matches =
    existing.fromAccount.toString() === fromAccount.toString() &&
    existing.toAccount.toString() === toAccount.toString() &&
    existing.amount === amount &&
    existing.type === type;

  if (!matches) {
    throw new ApiError(
      409,
      "idempotencyKey was already used with different request parameters",
    );
  }

  return { transaction: existing, replayed: true };
}

const createTransaction = catchAsync(async (req, res) => {
  const { fromAccount, toAccount, amount, idempotencyKey, note } = req.body;

  const ownsSource = await accountModel.exists({
    _id: fromAccount,
    user: req.user._id,
  });
  if (!ownsSource) {
    throw new ApiError(403, "you can only send money from an account you own");
  }

  const { transaction, replayed, toUserAccount } = await performTransfer({
    fromAccount,
    toAccount,
    amount,
    idempotencyKey,
    note,
    type: "TRANSFER",
    initiatedBy: req.user._id,
  });

  if (replayed) {
    return res.status(200).json({
      message: "transaction already processed (idempotent replay)",
      transaction,
    });
  }

  emitToUser(req.user._id, "transaction:completed", { transaction });
  if (toUserAccount) {
    emitToUser(toUserAccount.user, "transaction:received", { transaction });
  }

  emailService
    .sendTransactionEmail(req.user.email, req.user.name, amount, toAccount)
    .catch(() => {});

  res.status(201).json({ message: "transaction completed", transaction });
});

const createDeposit = catchAsync(async (req, res) => {
  const { toAccount, amount, idempotencyKey, note } = req.body;

  const treasuryAccountId = await getOrCreateTreasuryAccount();

  const { transaction, replayed } = await performTransfer({
    fromAccount: treasuryAccountId.toString(),
    toAccount,
    amount,
    idempotencyKey,
    note,
    type: "DEPOSIT",
    initiatedBy: req.user._id,
  });

  const toAccountDoc = await accountModel.findById(toAccount);
  if (toAccountDoc) {
    emitToUser(toAccountDoc.user, "transaction:received", { transaction });
  }

  res.status(replayed ? 200 : 201).json({
    message: replayed
      ? "deposit already processed (idempotent replay)"
      : "deposit completed",
    transaction,
  });
});

const getMyTransactions = catchAsync(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const { status } = req.query;

  const myAccountIds = await accountModel
    .find({ user: req.user._id })
    .distinct("_id");

  const filter = {
    $or: [
      { fromAccount: { $in: myAccountIds } },
      { toAccount: { $in: myAccountIds } },
    ],
  };
  if (status) filter.status = status;

  const [transactions, total] = await Promise.all([
    transactionModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    transactionModel.countDocuments(filter),
  ]);

  res.status(200).json({
    transactions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

const getTransactionById = catchAsync(async (req, res) => {
  const myAccountIds = await accountModel
    .find({ user: req.user._id })
    .distinct("_id");
  const idSet = myAccountIds.map((id) => id.toString());

  const transaction = await transactionModel.findById(req.params.transactionId);
  if (
    !transaction ||
    (!idSet.includes(transaction.fromAccount.toString()) &&
      !idSet.includes(transaction.toAccount.toString()))
  ) {
    throw new ApiError(404, "transaction not found");
  }

  res.status(200).json({ transaction });
});

function csvField(value) {
  const str = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const exportTransactionsCsv = catchAsync(async (req, res) => {
  const myAccountIds = await accountModel
    .find({ user: req.user._id })
    .distinct("_id");
  const idStrings = myAccountIds.map((id) => id.toString());

  const transactions = await transactionModel
    .find({
      $or: [
        { fromAccount: { $in: myAccountIds } },
        { toAccount: { $in: myAccountIds } },
      ],
    })
    .sort({ createdAt: -1 })
    .limit(1000);

  const rows = [
    [
      "date",
      "type",
      "direction",
      "amount",
      "status",
      "counterparty_account",
      "note",
    ],
  ];
  for (const t of transactions) {
    const direction = idStrings.includes(t.fromAccount.toString())
      ? "DEBIT"
      : "CREDIT";
    const counterparty = direction === "DEBIT" ? t.toAccount : t.fromAccount;
    rows.push([
      t.createdAt.toISOString(),
      t.type,
      direction,
      t.amount,
      t.status,
      counterparty.toString(),
      t.note || "",
    ]);
  }

  const csv = rows.map((row) => row.map(csvField).join(",")).join("\r\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=statement.csv");
  res.status(200).send(csv);
});

const sandboxTopUp = catchAsync(async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    throw new ApiError(403, "sandbox top-up is disabled in production");
  }

  const { toAccount, amount, idempotencyKey, note } = req.body;

  const owns = await accountModel.exists({
    _id: toAccount,
    user: req.user._id,
  });
  if (!owns) {
    throw new ApiError(403, "you can only top up your own account");
  }

  const treasuryAccountId = await getOrCreateTreasuryAccount();
  const { transaction, replayed } = await performTransfer({
    fromAccount: treasuryAccountId.toString(),
    toAccount,
    amount,
    idempotencyKey,
    note: note || "sandbox top-up",
    type: "DEPOSIT",
    initiatedBy: req.user._id,
  });

  emitToUser(req.user._id, "transaction:received", { transaction });

  res.status(replayed ? 200 : 201).json({
    message: replayed
      ? "top-up already processed (idempotent replay)"
      : "sandbox top-up completed",
    transaction,
  });
});

module.exports = {
  createTransaction,
  createDeposit,
  sandboxTopUp,
  getMyTransactions,
  getTransactionById,
  exportTransactionsCsv,
};
