const mongoose = require("mongoose")

const transactionSchema = new mongoose.Schema({
    fromAccount: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "account",
        required: [ true, "transaction must be associated from an account"],
        index: true
    },
    toAccount: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "account",
        required: [ true, "transaction must be associated to an account"],
        index: true
    },
    status: {
        type: String,
        enum:{
            values: ["PENDING", "SUCCESS", "FAILED", "REVERSED"],
            message: "status can be either PENDING, SUCCESS, FAILED or REVERSED",
        },
        default: "PENDING"
    },
    amount: {
        type: Number,
        required: [ true, "amount is required for creating a transaction"],
        min: [ 0, "transaction amount cannot be negative"]
    },
    idempotencyKey: {
        type: String,
        required: [ true, "idempotency key is required for creating a transaction"],
        index: true
    },
    initiatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        index: true
    },
    type: {
        type: String,
        enum: ["TRANSFER", "DEPOSIT"],
        default: "TRANSFER"
    },
    note: {
        type: String,
        trim: true,
        maxlength: 280
    },
    failureReason: {
        type: String
    },
    // simple rule-based fraud/anomaly flag (see transaction.controller.js)
    flagged: {
        type: Boolean,
        default: false
    },
    flagReason: {
        type: String
    }
}, {
    timestamps: true
})

transactionSchema.index({ fromAccount: 1, createdAt: -1 })
transactionSchema.index({ toAccount: 1, createdAt: -1 })
transactionSchema.index({ initiatedBy: 1, idempotencyKey: 1 }, { unique: true })

const transactionModel = mongoose.model("transaction", transactionSchema)

module.exports = transactionModel