const mongoose = require("mongoose");
const ledgerModel = require("./ledger.model");

const accountSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: [true, "acc must be associated"],
    },

    status: {
      type: String,
      enum: {
        values: ["ACTIVE", "FROZEN", "CLOSED"],
        message: "status can be either ACTIVE, FROZEN or CLOSED",
      },
      default: "ACTIVE",
    },

    currency: {
      type: String,
      required: [true, "currency is required for creating an acc"],
      default: "BDT",
    },

    balance: {
      type: Number,
      required: true,
      default: 0,
    },

    role: {
      type: String,
      enum: ["USER", "TREASURY"],
      default: "USER",
    },
  },
  {
    timestamps: true,
  },
);

accountSchema.index({ user: 1, status: 1 });
accountSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: "TREASURY" } },
);

accountSchema.methods.getBalance = async function () {
  return this.balance;
};

accountSchema.statics.computeBalanceFromLedger = async function (accountId) {
  const balanceData = await ledgerModel.aggregate([
    { $match: { account: new mongoose.Types.ObjectId(accountId) } },
    {
      $group: {
        _id: null,
        totalDebit: {
          $sum: {
            $cond: [{ $eq: ["$type", "DEBIT"] }, "$amount", 0],
          },
        },
        totalCredit: {
          $sum: {
            $cond: [{ $eq: ["$type", "CREDIT"] }, "$amount", 0],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        balance: {
          $subtract: ["$totalCredit", "$totalDebit"],
        },
      },
    },
  ]);

  return balanceData.length === 0 ? 0 : balanceData[0].balance;
};

const accountModel = mongoose.model("account", accountSchema);

module.exports = accountModel;
