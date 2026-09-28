# Bank Transaction Ledger

A production-oriented banking backend built on **double-entry bookkeeping**. Users hold multiple accounts, money moves between them through atomic and idempotent transfers, and every movement is recorded in an append-only ledger. The project ships with JWT authentication (access + rotating refresh tokens), real-time notifications, interactive API documentation, and a lightweight demo console.

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Installation Guide](#installation-guide)
- [Environment Variables Setup](#environment-variables-setup)
- [API Documentation](#api-documentation)
- [Security Notes](#security-notes)
- [Deployment](#deployment)

---

## Features

**Accounts & Ledger**
- Multiple accounts per user, each with its own status (`ACTIVE`, `FROZEN`, `CLOSED`) and currency
- Double-entry ledger: every transfer writes a matching `DEBIT` and `CREDIT` entry
- Append-only ledger entries (update and delete operations are blocked at the model level)
- Cached account balances updated atomically, with a reconciliation utility that recomputes balances from the ledger

**Transfers**
- Atomic peer-to-peer transfers using MongoDB multi-document transactions
- Concurrency-safe balance checks (check-and-debit performed as a single atomic operation)
- Idempotent requests via `idempotencyKey`, scoped per user, with request-payload validation
- System deposits and a development-only sandbox top-up
- Rule-based flagging of unusually large transfers for review
- Paginated transaction history, per-account statements, and CSV export

**Authentication**
- Email/password registration and login
- Short-lived access tokens with long-lived, **rotating refresh tokens**
- Refresh-token reuse detection that revokes the entire session family
- Logout with refresh-token revocation and access-token blacklisting
- Optional email notifications (welcome, sign-in alert, transaction receipts)

**Platform**
- Real-time events over Socket.IO (`transaction:completed`, `transaction:received`)
- Interactive OpenAPI (Swagger) documentation
- Request validation, centralized error handling, and request-ID tracing
- Structured JSON logging, health endpoint, and graceful shutdown
- Dockerfile for containerized deployment
- Built-in demo console (plain HTML/CSS/JS) that exercises the full flow

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 18+ |
| Framework | Express 5 |
| Database | MongoDB with Mongoose (replica set required for transactions) |
| Authentication | JSON Web Tokens, bcryptjs, HTTP-only cookies |
| Validation | Zod |
| Real-time | Socket.IO |
| Security | Helmet, CORS, express-rate-limit, input sanitization |
| Logging | Pino, pino-http |
| API Docs | OpenAPI 3 via swagger-ui-express |
| Email | Nodemailer (Gmail OAuth2) |
| Tooling | Nodemon, Docker |
| Demo UI | Vanilla HTML, CSS, JavaScript |

---

## Project Structure

```
.
├── server.js                 # Entry point: DB connection, HTTP + Socket.IO, graceful shutdown
├── src/
│   ├── app.js                # Express app, middleware stack, route mounting
│   ├── config/               # Database connection, OpenAPI specification
│   ├── controllers/          # auth, account, transaction handlers
│   ├── middleware/           # auth, validation, sanitization, error handling
│   ├── models/               # user, account, transaction, ledger, refreshToken, blackList
│   ├── realtime/             # Socket.IO setup and event emitters
│   ├── routes/               # auth, account, transaction routers
│   ├── services/             # email, treasury account bootstrap
│   ├── utils/                # logger, token helpers, ApiError, retry helper
│   └── validators/           # Zod schemas
├── public/                   # Demo console (served at /)
├── scripts/                  # Maintenance utilities
├── Dockerfile
└── .env.example
```

---

## Installation Guide

### Prerequisites

- **Node.js** 18 or newer
- **MongoDB** running as a **replica set** (MongoDB Atlas works out of the box)

> MongoDB multi-document transactions are only available on replica sets. A standalone `mongod` will not work for transfers.

### 1. Clone and install

```bash
git clone https://github.com/<your-username>/bank-transaction.git
cd bank-transaction
npm install
```

### 2. Provide a database

**Option A — MongoDB Atlas (recommended):** create a free cluster and copy its connection string.

**Option B — Local single-node replica set with Docker:**

```bash
docker run -d --name ledger-mongo -p 27017:27017 mongo:7 --replSet rs0
docker exec ledger-mongo mongosh --eval "rs.initiate()"
```

Use this connection string:

```
mongodb://127.0.0.1:27017/ledger?directConnection=true
```

### 3. Configure the environment

```bash
cp .env.example .env
```

Fill in at least `MONGO_URI` and `JWT_SECRET` (see [Environment Variables Setup](#environment-variables-setup)).

### 4. Run

```bash
npm run dev     # development (auto-restart on change)
npm start       # production
```

| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Demo console |
| `http://localhost:3000/api/docs` | Interactive API documentation |
| `http://localhost:3000/health` | Health check |

### Balance reconciliation utility

Recomputes every account balance from the immutable ledger and reports any drift from the cached value.

```bash
node scripts/backfill-account-balances.js --dry-run   # report only
node scripts/backfill-account-balances.js             # report and correct
```

---

## Environment Variables Setup

Copy `.env.example` to `.env` and set the values below. The `.env` file is git-ignored and must never be committed.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGO_URI` | MongoDB connection string | `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/ledger` |
| `JWT_SECRET` | Secret used to sign access tokens. Use a long random value. | `openssl rand -hex 32` |

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Set to `production` in deployment. Enables secure cookies and disables the sandbox top-up endpoint. |
| `CORS_ORIGIN` | reflects request origin | Allowed origin for cross-origin clients and Socket.IO |
| `LOG_LEVEL` | `info` | Pino log level |

### Tokens

| Variable | Default | Description |
|----------|---------|-------------|
| `ACCESS_TOKEN_EXPIRY` | `15m` | Access token lifetime |
| `REFRESH_TOKEN_EXPIRY_DAYS` | `30` | Refresh token lifetime in days |

### Email (optional)

Email delivery is disabled automatically when these are not all set.

| Variable | Description |
|----------|-------------|
| `EMAIL_USER` | Gmail address used as the sender |
| `CLIENT_ID` | Google OAuth2 client ID |
| `CLIENT_SECRET` | Google OAuth2 client secret |
| `REFRESH_TOKEN` | Google OAuth2 refresh token for the sender account (unrelated to the API's own session refresh tokens) |

### Business rules

| Variable | Default | Description |
|----------|---------|-------------|
| `FRAUD_FLAG_THRESHOLD` | `100000` | Transfers at or above this amount are flagged for review (not blocked) |

---

## API Documentation

Interactive documentation with a "Try it out" console is available at **`/api/docs`**, and the raw specification at **`/api/openapi.json`**.

### Conventions

- **Base path:** `/api`
- **Content type:** `application/json`
- **Authentication:** send the access token as `Authorization: Bearer <accessToken>`, or rely on the `token` HTTP-only cookie set at login.
- **Errors** share a single shape:

```json
{
  "message": "insufficient balance, current balance is 40",
  "details": [{ "field": "amount", "message": "amount must be greater than 0" }],
  "requestId": "b4c1a2e0-5f3d-4c0e-9a51-0d6e0b7f2c11"
}
```

`details` appears only for validation errors. Every response carries an `x-request-id` header for tracing.

| Status | Meaning |
|--------|---------|
| `400` | Business rule violation (insufficient funds, inactive account, self-transfer) |
| `401` | Missing, invalid, or expired credentials |
| `403` | Authenticated but not permitted |
| `404` | Resource not found |
| `409` | Conflict (duplicate email, idempotency key reused with different parameters) |
| `422` | Request validation failed |
| `429` | Rate limit exceeded |
| `500` | Unexpected server error |

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/register` | — | Create a user and start a session |
| `POST` | `/auth/login` | — | Log in with email and password |
| `POST` | `/auth/refresh-token` | refresh token | Rotate the refresh token and issue a new access token |
| `POST` | `/auth/logout` | — | Revoke the session |
| `GET` | `/auth/me` | required | Current user profile |

Register, login, and refresh are limited to 20 requests per 15 minutes per client.

**Register**

```http
POST /api/auth/register
```
```json
{ "name": "Ayesha Rahman", "email": "ayesha@example.com", "password": "s3cret-pass" }
```

`201 Created`
```json
{
  "user": { "_id": "665f1c...", "email": "ayesha@example.com", "name": "Ayesha Rahman" },
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "9f2b7c..."
}
```

Both tokens are also set as HTTP-only cookies (`token`, `refreshToken`). The refresh cookie is scoped to `/api/auth`.

**Login** accepts `{ "email", "password" }` and returns the same response with `200 OK`.

**Refresh token**

Send the `refreshToken` cookie, or provide it in the body:

```json
{ "refreshToken": "9f2b7c..." }
```

`200 OK`
```json
{ "accessToken": "eyJhbGciOi...", "refreshToken": "new-token..." }
```

Each refresh token is single-use. Presenting a token that was already used revokes the whole session family and returns `401`.

### Accounts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/accounts` | Create an account (optional body `{ "currency": "BDT" }`) |
| `GET` | `/accounts` | List your accounts with live balances |
| `GET` | `/accounts/balance/:accountId` | Balance of one account |
| `GET` | `/accounts/:accountId/transactions` | Paginated statement. Query: `page`, `limit` (max 100), `status` |

`GET /accounts` → `200 OK`
```json
{
  "accounts": [
    {
      "_id": "665f2a...",
      "user": "665f1c...",
      "status": "ACTIVE",
      "currency": "BDT",
      "balance": 2500,
      "createdAt": "2026-09-25T09:41:12.000Z"
    }
  ]
}
```

### Transactions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/transactions` | user | Transfer between accounts |
| `GET` | `/transactions` | user | History across all your accounts. Query: `page`, `limit`, `status` |
| `GET` | `/transactions/:transactionId` | user | A single transaction you are party to |
| `GET` | `/transactions/export.csv` | user | Download your statement as CSV (latest 1000) |
| `POST` | `/transactions/deposits` | system user | Credit an account from the treasury |
| `POST` | `/transactions/sandbox-topup` | user | Fund your own account with test money. **Disabled when `NODE_ENV=production`.** |

**Create a transfer**

```http
POST /api/transactions
```
```json
{
  "fromAccount": "665f2a1b3c4d5e6f7a8b9c0d",
  "toAccount": "665f2b9e1a2b3c4d5e6f7a8b",
  "amount": 500,
  "idempotencyKey": "3f6d9e42-8c1a-4b7e-a0d5-2e91c7b4f6a8",
  "note": "October rent"
}
```

`201 Created`
```json
{
  "message": "transaction completed",
  "transaction": {
    "_id": "665f3c...",
    "fromAccount": "665f2a1b3c4d5e6f7a8b9c0d",
    "toAccount": "665f2b9e1a2b3c4d5e6f7a8b",
    "amount": 500,
    "status": "SUCCESS",
    "type": "TRANSFER",
    "flagged": false,
    "idempotencyKey": "3f6d9e42-8c1a-4b7e-a0d5-2e91c7b4f6a8"
  }
}
```

**Idempotency rules**

- Generate a unique `idempotencyKey` (for example a UUID) for each *logical* transfer and reuse it when retrying.
- Retrying with identical parameters returns `200 OK` with the original transaction and moves no money.
- Reusing a key with a different amount, account, or type returns `409 Conflict`.
- Keys are scoped to the authenticated user.

**Validation:** `fromAccount` and `toAccount` must be valid account IDs, `amount` must be greater than 0, `note` is optional (max 280 characters), and you must own `fromAccount`.

**Deposits and sandbox top-up** share the body `{ "toAccount", "amount", "idempotencyKey", "note" }`. Deposits require a user provisioned as a system user in the database. For development, use the sandbox top-up instead.

### Real-time events

Connect with Socket.IO using your access token. Each user is placed in a private room.

```js
const socket = io({ auth: { token: accessToken } });

socket.on("transaction:completed", ({ transaction }) => { /* you sent money */ });
socket.on("transaction:received",  ({ transaction }) => { /* you received money */ });
```

### Operational endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Liveness check: `{ "status": "ok", "uptime": 123.4 }` |
| `GET` | `/api/docs` | Swagger UI |
| `GET` | `/api/openapi.json` | OpenAPI specification |

---

## Security Notes

**Authentication & sessions**
- Passwords are hashed with bcrypt and are never returned by the API. Login returns the same error for an unknown email and a wrong password to prevent account enumeration.
- Access tokens are short-lived. Refresh tokens are random opaque strings, and only their SHA-256 hash is stored, so a database leak does not expose usable tokens.
- Refresh tokens rotate on every use. The revoke-and-claim step is a single atomic database operation, so two simultaneous refreshes with the same token cannot both succeed. Replaying a used token revokes the whole session family.
- Cookies are `httpOnly` and `sameSite=lax`, and `secure` when `NODE_ENV=production`. The refresh cookie is restricted to `/api/auth`.
- Logged-out access tokens are blacklisted until they age out.

**Financial integrity**
- Transfers run inside MongoDB transactions, so debit, credit, ledger entries, and the transaction record commit together or not at all.
- The balance check and debit are one atomic conditional update, which prevents overdrafts under concurrent requests. Transient write conflicts are retried automatically.
- Idempotency keys are scoped per user and bound to the original request parameters. Concurrent duplicate requests resolve to a single transfer.
- Ledger entries are append-only, and cached balances can be audited against the ledger at any time.
- The treasury account is guaranteed unique by a partial unique index, independent of how many server instances are running.

**Request handling**
- All request bodies are validated with Zod; unknown operators and dotted keys are stripped to block NoSQL injection.
- Security headers via Helmet, configurable CORS, request body size limit of 100 KB, and rate limiting on authentication endpoints.
- CSV exports neutralize spreadsheet formula injection by prefixing values that begin with `=`, `+`, `-`, `@`, tab, or carriage return, and quote every field.
- Error responses never expose stack traces; unexpected errors return a generic message with a `requestId` for log correlation.

**Operations**
- Never commit `.env`. It is git-ignored; only `.env.example` belongs in version control.
- Use a long random `JWT_SECRET` and rotate any credential that has been shared or committed by mistake.
- In production, set `NODE_ENV=production`, serve the app over HTTPS (secure cookies require it), and terminate TLS at a reverse proxy or your hosting platform. The app trusts one proxy hop for client IP detection.
- Store secrets in your platform's secret manager or environment settings rather than in files.
- The sandbox top-up endpoint is automatically disabled in production.
- Transfers at or above `FRAUD_FLAG_THRESHOLD` are flagged for review. This is a simple rule, not a substitute for a dedicated fraud-detection system.

---

## Deployment

**Docker**

```bash
docker build -t bank-transaction .
docker run -p 3000:3000 --env-file .env bank-transaction
```

The image runs as `NODE_ENV=production` and includes a container health check against `/health`.

**Platforms (Render, Railway, Fly.io, etc.)**

1. Provision a MongoDB Atlas cluster and allow your host's outbound IPs.
2. Set `MONGO_URI`, `JWT_SECRET`, and `NODE_ENV=production` in the platform's environment settings, plus `CORS_ORIGIN` if a separate frontend consumes the API.
3. Deploy with start command `npm start`.

To ship as an API-only service, delete the `public/` directory and the `express.static(...)` line in `src/app.js`.

---

## License

ISC
