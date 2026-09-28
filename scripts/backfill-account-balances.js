require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const connectToDB = require("../src/config/db");
const accountModel = require("../src/models/account.model");
const logger = require("../src/utils/logger");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  await connectToDB();

  const accounts = await accountModel.find({});
  let driftCount = 0;

  for (const account of accounts) {
    const trueBalance = await accountModel.computeBalanceFromLedger(
      account._id,
    );
    if (trueBalance !== account.balance) {
      driftCount++;
      logger.warn(
        {
          accountId: account._id.toString(),
          cached: account.balance,
          actual: trueBalance,
        },
        "balance drift detected",
      );
      if (!dryRun) {
        await accountModel.updateOne(
          { _id: account._id },
          { balance: trueBalance },
        );
      }
    }
  }

  logger.info(
    { total: accounts.length, driftCount, dryRun },
    dryRun ? "dry run complete - no writes made" : "backfill complete",
  );

  await mongoose.connection.close();
}

main().catch((err) => {
  logger.error({ err }, "backfill failed");
  process.exit(1);
});
