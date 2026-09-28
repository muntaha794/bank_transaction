const { z } = require("zod");

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "must be a valid account id");

const createTransactionSchema = z.object({
  body: z.object({
    fromAccount: objectId,
    toAccount: objectId,
    amount: z.number().positive("amount must be greater than 0"),
    idempotencyKey: z.string().min(1, "idempotencyKey is required"),
    note: z.string().max(280).optional(),
  }),
});

const depositSchema = z.object({
  body: z.object({
    toAccount: objectId,
    amount: z.number().positive("amount must be greater than 0"),
    idempotencyKey: z.string().min(1, "idempotencyKey is required"),
    note: z.string().max(280).optional(),
  }),
});

module.exports = { createTransactionSchema, depositSchema };
