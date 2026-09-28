const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Backend Ledger API",
    version: "1.0.0",
    description:
      "A double-entry bookkeeping bank-transaction backend: users, accounts, ledger-backed balances, and idempotent transfers.",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      cookieAuth: { type: "apiKey", in: "cookie", name: "token" },
      bearerAuth: { type: "http", scheme: "bearer" },
    },
    schemas: {
      User: {
        type: "object",
        properties: {
          _id: { type: "string" },
          email: { type: "string" },
          name: { type: "string" },
        },
      },
      Account: {
        type: "object",
        properties: {
          _id: { type: "string" },
          user: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "FROZEN", "CLOSED"] },
          currency: { type: "string" },
          balance: { type: "number" },
          role: { type: "string", enum: ["USER", "TREASURY"] },
        },
      },
      Transaction: {
        type: "object",
        properties: {
          _id: { type: "string" },
          fromAccount: { type: "string" },
          toAccount: { type: "string" },
          amount: { type: "number" },
          status: { type: "string", enum: ["PENDING", "SUCCESS", "FAILED", "REVERSED"] },
          type: { type: "string", enum: ["TRANSFER", "DEPOSIT"] },
          idempotencyKey: { type: "string" },
        },
      },
      Error: {
        type: "object",
        properties: { message: { type: "string" }, requestId: { type: "string" } },
      },
    },
  },
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  paths: {
    "/auth/register": {
      post: {
        tags: ["auth"],
        summary: "Register a new user",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password", "name"],
                properties: {
                  email: { type: "string" },
                  password: { type: "string", minLength: 6 },
                  name: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "User created" }, 409: { description: "Email already registered" } },
      },
    },
    "/auth/login": {
      post: {
        tags: ["auth"],
        summary: "Log in with email + password",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: { email: { type: "string" }, password: { type: "string" } },
              },
            },
          },
        },
        responses: { 200: { description: "Access + refresh tokens issued" }, 401: { description: "Invalid credentials" } },
      },
    },
    "/auth/refresh-token": {
      post: {
        tags: ["auth"],
        summary: "Rotate a refresh token for a new access/refresh pair",
        security: [],
        responses: { 200: { description: "New token pair issued" }, 401: { description: "Invalid, expired or reused refresh token" } },
      },
    },
    "/auth/logout": {
      post: { tags: ["auth"], summary: "Log out and revoke tokens", security: [], responses: { 200: { description: "Logged out" } } },
    },
    "/auth/me": {
      get: { tags: ["auth"], summary: "Get the current authenticated user", responses: { 200: { description: "Current user" } } },
    },
    "/accounts": {
      post: { tags: ["accounts"], summary: "Create a new account for the current user", responses: { 201: { description: "Account created" } } },
      get: { tags: ["accounts"], summary: "List the current user's accounts with balances", responses: { 200: { description: "Accounts" } } },
    },
    "/accounts/balance/{accountId}": {
      get: {
        tags: ["accounts"],
        summary: "Get the live balance of one of the current user's accounts",
        parameters: [{ name: "accountId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Balance" }, 404: { description: "Account not found" } },
      },
    },
    "/accounts/{accountId}/transactions": {
      get: {
        tags: ["accounts"],
        summary: "Statement (paginated transaction history) for an account",
        parameters: [
          { name: "accountId", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Paginated transactions" } },
      },
    },
    "/transactions": {
      post: {
        tags: ["transactions"],
        summary: "Create a peer-to-peer transfer (idempotent via idempotencyKey)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["fromAccount", "toAccount", "amount", "idempotencyKey"],
                properties: {
                  fromAccount: { type: "string" },
                  toAccount: { type: "string" },
                  amount: { type: "number" },
                  idempotencyKey: { type: "string" },
                  note: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Transaction completed" }, 200: { description: "Idempotent replay" }, 400: { description: "Validation/business rule error" } },
      },
      get: {
        tags: ["transactions"],
        summary: "List transactions across all of the current user's accounts",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { 200: { description: "Paginated transactions" } },
      },
    },
    "/transactions/deposits": {
      post: {
        tags: ["transactions"],
        summary: "System-only: deposit funds into an account (sandbox top-up)",
        responses: { 201: { description: "Deposit completed" }, 403: { description: "Not a system user" } },
      },
    },
    "/transactions/sandbox-topup": {
      post: {
        tags: ["transactions"],
        summary: "Dev/demo only: fund your own account with test money (disabled in production)",
        responses: { 201: { description: "Top-up completed" }, 403: { description: "Disabled in production" } },
      },
    },
    "/transactions/export.csv": {
      get: { tags: ["transactions"], summary: "Download a CSV statement of the current user's transactions", responses: { 200: { description: "CSV file" } } },
    },
    "/transactions/{transactionId}": {
      get: {
        tags: ["transactions"],
        summary: "Get a single transaction the current user is party to",
        parameters: [{ name: "transactionId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Transaction" }, 404: { description: "Not found" } },
      },
    },
  },
};

module.exports = openApiSpec;
