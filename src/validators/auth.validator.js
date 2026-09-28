const { z } = require("zod");

const registerSchema = z.object({
  body: z.object({
    email: z.string().trim().email("a valid email is required"),
    password: z.string().min(6, "password must be at least 6 characters"),
    name: z.string().trim().min(1, "name is required"),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email("a valid email is required"),
    password: z.string().min(1, "password is required"),
  }),
});

module.exports = { registerSchema, loginSchema };
