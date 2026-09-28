const mongoose = require("mongoose");
const logger = require("../utils/logger");

async function connectToDB() {
    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not set in the environment");
    }

    mongoose.connection.on("disconnected", () => {
        logger.warn("mongodb disconnected");
    });

    await mongoose.connect(process.env.MONGO_URI);
    logger.info("db connected");
}

module.exports = connectToDB;