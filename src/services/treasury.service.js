const crypto = require("crypto");
const userModel = require("../models/user.model");
const accountModel = require("../models/account.model");

const SYSTEM_EMAIL = "system@ledger.internal";

let cachedAccountId = null;
let initPromise = null;

// Deposits still need to obey double-entry bookkeeping (every DEBIT needs a
// matching CREDIT), so instead of allowing a transaction with no fromAccount
// we route deposits through a dedicated system/treasury account. Created
// lazily on first use so a fresh install doesn't need a manual seed step.
//
// This used to do a plain find-then-create for both the system user and its
// account, with no coordination between concurrent callers. Two requests
// landing at the same moment (very plausible on the very first deposit
// after a deploy, or across multiple server instances behind a load
// balancer) could both decide "doesn't exist yet" and both try to create
// it - the user's unique email index would reject the loser with an
// uncaught E11000 (a 500 for a legitimate request), and the account had no
// uniqueness guarantee at all, so two separate treasury accounts could
// silently end up holding split, inconsistent balances.
//
// Fixed with two layers:
//   1. In this process, every caller before the first successful
//      initialization awaits the SAME promise instead of each independently
//      racing MongoDB (`initPromise` below).
//   2. Across processes (multiple server instances), the actual
//      correctness guarantee is the database: both the user creation and
//      the account creation use an atomic upsert, and the account has a
//      partial unique index on `role: "TREASURY"` (see account.model.js) -
//      so even if two instances reach MongoDB at the same instant, only one
//      document can ever be created, and the loser's write is either a
//      harmless no-op (upsert) or a duplicate-key error we explicitly catch
//      and recover from by just reading what the winner created.
async function getOrCreateTreasuryAccount() {
  if (cachedAccountId) return cachedAccountId;

  if (!initPromise) {
    initPromise = initializeTreasury().catch((err) => {
      initPromise = null; 
      throw err;
    });
  }

  return initPromise;
}

async function initializeTreasury() {
  const systemUser = await upsertSystemUser();
  const treasuryAccount = await upsertTreasuryAccount(systemUser._id);
  cachedAccountId = treasuryAccount._id;
  return cachedAccountId;
}

async function upsertSystemUser() {
  try {
    return await userModel.findOneAndUpdate(
      { email: SYSTEM_EMAIL },
      {
        $setOnInsert: {
          email: SYSTEM_EMAIL,
          name: "System Treasury",
          password: crypto.randomBytes(32).toString("hex"),
          systemUser: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).select("+systemUser");
  } catch (error) {
    if (error.code === 11000) {
      const existing = await userModel.findOne({ email: SYSTEM_EMAIL }).select("+systemUser");
      if (existing) return existing;
    }
    throw error;
  }
}

async function upsertTreasuryAccount(systemUserId) {
  try {
    return await accountModel.findOneAndUpdate(
      { role: "TREASURY" },
      { $setOnInsert: { user: systemUserId, currency: "BDT", role: "TREASURY" } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (error) {
    if (error.code === 11000) {
      const existing = await accountModel.findOne({ role: "TREASURY" });
      if (existing) return existing;
    }
    throw error;
  }
}

module.exports = { getOrCreateTreasuryAccount };
