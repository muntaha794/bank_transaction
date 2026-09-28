const userModel = require("../models/user.model");
const tokenBlackListModel = require("../models/blackList.model");
const jwt = require("jsonwebtoken");
const catchAsync = require("../utils/catchAsync");
const ApiError = require("../utils/ApiError");

const authMiddleware = catchAsync(async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

  if (!token) {
    throw new ApiError(401, "unauthorized access, token is missing");
  }

  const isBlackListed = await tokenBlackListModel.findOne({ token });
  if (isBlackListed) {
    throw new ApiError(401, "unauthorized token, it's invalid");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw new ApiError(401, "unauthorized access, token is invalid");
  }

  const user = await userModel.findById(decoded.userId);
  if (!user) {
    throw new ApiError(401, "unauthorized access, user no longer exists");
  }

  req.user = user;
  next();
});

const authSystemMiddleware = catchAsync(async (req, res, next) => {
  const token = req.cookies?.token || req.headers.authorization?.split(" ")[1];

  if (!token) {
    throw new ApiError(401, "unauthorized access, token is missing");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw new ApiError(401, "forbidden access, token is invalid");
  }

  const user = await userModel.findById(decoded.userId).select("+systemUser");
  if (!user || !user.systemUser) {
    throw new ApiError(403, "forbidden access, not a system user");
  }

  req.user = user;
  next();
});

module.exports = { authMiddleware, authSystemMiddleware };
