const accountModel = require("../models/account.model");
const transactionModel = require("../models/transaction.model");
const catchAsync = require("../utils/catchAsync");
const ApiError = require("../utils/ApiError");

const createAccountController = catchAsync(async (req, res) => {
  const user = req.user;

  const account = await accountModel.create({
    user: user._id,
    currency: req.body?.currency,
  });

  res.status(201).json({ account });
});

const getUserAccountController = catchAsync(async (req, res) => {
  const accounts = await accountModel.find({ user: req.user._id }).sort({ createdAt: -1 });

  const withBalances = await Promise.all(
    accounts.map(async (account) => ({
      ...account.toObject(),
      balance: await account.getBalance(),
    })),
  );

  res.status(200).json({ accounts: withBalances });
});

const getAccountBalanceController = catchAsync(async (req, res) => {
  const { accountId } = req.params;

  const account = await accountModel.findOne({ _id: accountId, user: req.user._id });
  if (!account) {
    throw new ApiError(404, "account not found");
  }

  const balance = await account.getBalance();

  res.status(200).json({ accountId: account._id, currency: account.currency, balance });
});


const getAccountTransactionsController = catchAsync(async (req, res) => {
  const { accountId } = req.params;
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const { status } = req.query;

  const account = await accountModel.findOne({ _id: accountId, user: req.user._id });
  if (!account) {
    throw new ApiError(404, "account not found");
  }

  const filter = { $or: [{ fromAccount: account._id }, { toAccount: account._id }] };
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

module.exports = {
  createAccountController,
  getUserAccountController,
  getAccountBalanceController,
  getAccountTransactionsController,
};
