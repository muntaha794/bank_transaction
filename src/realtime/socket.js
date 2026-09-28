const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const logger = require("../utils/logger");

let io = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGIN || "*" },
  });


  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1];

      if (!token) return next(new Error("authentication required"));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error("invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.userId}`);
    logger.debug({ userId: socket.userId }, "socket connected");

    socket.on("disconnect", () => {
      logger.debug({ userId: socket.userId }, "socket disconnected");
    });
  });

  return io;
}

// Notify a specific user's connected clients (dashboard tab, mobile app,
// demo UI, etc.) about a real-time event. Safe no-op if sockets aren't
// initialized (e.g. in tests).
function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId.toString()}`).emit(event, payload);
}

module.exports = { initSocket, emitToUser };
