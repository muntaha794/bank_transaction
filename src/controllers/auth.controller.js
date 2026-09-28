const userModel = require("../models/user.model");
const refreshTokenModel = require("../models/refreshToken.model");
const tokenBlackListModel = require("../models/blackList.model");
const emailService = require("../services/email.service");
const catchAsync = require("../utils/catchAsync");
const ApiError = require("../utils/ApiError");
const {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  ACCESS_COOKIE_OPTIONS,
  REFRESH_COOKIE_OPTIONS,
} = require("../utils/token.util");
const crypto = require("crypto");

async function issueTokenPair(res, user, { family, req } = {}) {
  const accessToken = signAccessToken(user._id);
  const { token: refreshToken, tokenHash, expiresAt } = generateRefreshToken();

  await refreshTokenModel.create({
    user: user._id,
    tokenHash,
    family: family || crypto.randomUUID(),
    expiresAt,
    userAgent: req?.headers["user-agent"],
    ip: req?.ip,
  });

  res.cookie("token", accessToken, ACCESS_COOKIE_OPTIONS);
  res.cookie("refreshToken", refreshToken, REFRESH_COOKIE_OPTIONS);

  return { accessToken, refreshToken };
}

const userRegisterController = catchAsync(async (req, res) => {
  const { email, password, name } = req.body;

  const isExist = await userModel.findOne({ email });
  if (isExist) {
    throw new ApiError(409, "user already exists");
  }

  const user = await userModel.create({ email, password, name });
  const { accessToken, refreshToken } = await issueTokenPair(res, user, { req });

  emailService.sendRegistrationEmail(user.email, user.name).catch(() => {});

  res.status(201).json({
    user: { _id: user._id, email: user.email, name: user.name },
    accessToken,
    refreshToken,
  });
});

const userLoginController = catchAsync(async (req, res) => {
  const { email, password } = req.body;

  const user = await userModel.findOne({ email }).select("+password");

  // Same error for "no such user" and "wrong password" so the response
  // never reveals whether an email is registered.
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "email or password is invalid");
  }

  const { accessToken, refreshToken } = await issueTokenPair(res, user, { req });

  res.status(200).json({
    user: { _id: user._id, email: user.email, name: user.name },
    accessToken,
    refreshToken,
  });

  emailService.sendLoginAlertEmail(user.email, user.name).catch(() => {});
});

// Rotates a refresh token: the presented token is revoked and a brand new
// access + refresh pair is issued in the same "family". If a token that was
// already revoked (i.e. already used once) is presented again, that's a
// strong signal it was stolen, so the entire family is revoked and the
// caller is forced to log in again.
//
// The revoke-then-issue step below is a single atomic findOneAndUpdate
// (not a separate read followed by a later write) specifically to close a
// race: the old code read the token, decided it was still valid, and only
// marked it revoked *after* already issuing a new pair. If two refresh
// requests carrying the same old token arrived at the same moment, both
// could read "not revoked yet" before either had written anything, and
// both would go on to mint their own new token from the same parent -
// forking the family instead of cleanly closing the old link. Filtering
// the update on `revokedAt: null` makes MongoDB itself the arbiter: only
// one concurrent request can ever successfully flip that field, and it did
// so atomically, so there is no gap for a second request to sneak through.
const refreshTokenController = catchAsync(async (req, res) => {
  const incoming = req.cookies?.refreshToken || req.body?.refreshToken;

  if (!incoming) {
    throw new ApiError(401, "refresh token is missing");
  }

  const tokenHash = hashToken(incoming);

  // Atomically "claim" the token: this only matches and updates a document
  // that is still unrevoked, so a concurrent second attempt with the same
  // token is guaranteed to find nothing here, however close in time it runs.
  const claimed = await refreshTokenModel.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: false }, // we want the pre-update doc (family/user/expiresAt)
  );

  if (!claimed) {
    // Couldn't claim it - either it never existed, or it was already used.
    // Distinguish the two only to decide whether a family-wide revocation
    // is warranted; either way the caller is rejected the same way.
    const existing = await refreshTokenModel.findOne({ tokenHash });
    if (existing) {
      await refreshTokenModel.updateMany(
        { family: existing.family, revokedAt: null },
        { revokedAt: new Date() },
      );
      throw new ApiError(401, "refresh token reuse detected, please log in again");
    }
    throw new ApiError(401, "invalid refresh token");
  }

  if (claimed.expiresAt < new Date()) {
    throw new ApiError(401, "refresh token has expired");
  }

  const user = await userModel.findById(claimed.user);
  if (!user) {
    throw new ApiError(401, "user no longer exists");
  }

  const issued = await issueTokenPair(res, user, { family: claimed.family, req });

  // The old token is already revoked (that's what the atomic claim above
  // did) - this is just recording the audit trail of what it was replaced
  // by, not a security-relevant write, so it doesn't need to be atomic.
  await refreshTokenModel.updateOne(
    { _id: claimed._id },
    { replacedByTokenHash: hashToken(issued.refreshToken) },
  );

  res.status(200).json({ accessToken: issued.accessToken, refreshToken: issued.refreshToken });
});

const getCurrentUserController = catchAsync(async (req, res) => {
  res.status(200).json({ user: req.user });
});

const userLogoutController = catchAsync(async (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];
  const incomingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  if (token) {
    await tokenBlackListModel.create({ token }).catch(() => {
      // token already blacklisted (e.g. double logout) - not an error
    });
  }

  if (incomingRefreshToken) {
    await refreshTokenModel.updateOne(
      { tokenHash: hashToken(incomingRefreshToken) },
      { revokedAt: new Date() },
    );
  }

  res.clearCookie("token", ACCESS_COOKIE_OPTIONS);
  res.clearCookie("refreshToken", REFRESH_COOKIE_OPTIONS);

  res.status(200).json({ message: "user logged out successfully" });
});

module.exports = {
  userRegisterController,
  userLoginController,
  userLogoutController,
  refreshTokenController,
  getCurrentUserController,
};
