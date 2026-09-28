# Bank Transaction Ledger — Backend

A double-entry bookkeeping backend: users hold one or more accounts, balances
are derived from an append-only ledger (never a stored `balance` field), and
transfers are atomic, idempotent, and auditable.

## ⚠️ Rotate your credentials first

The `.env` file in the original project had **real, live secrets** committed
to it in plain text: a MongoDB Atlas connection string with password, a JWT
signing secret, and a Google OAuth client secret. Treat all of them as
compromised and rotate them now, regardless of what you do with this project:

- MongoDB Atlas → Database Access → edit the user → reset password
- Google Cloud Console → APIs & Services → Credentials → regenerate the OAuth client secret
- Generate a fresh `JWT_SECRET` (e.g. `openssl rand -hex 32`)

This repo now uses `.env.example` (placeholders only) and a `.gitignore` that
excludes `.env`, so this shouldn't happen again as long as you keep using it.

## What was fixed

The original code had several bugs that would crash the server on boot or
silently break core functionality. The most serious:

- **Login never checked the password.** Any request with a registered email
  and *any* password succeeded.
- `authMiddleware` referenced an unimported model and read `decoded.id` from
  a JWT that was signed with `userId` — auth never actually worked.
- A model exported a variable name that didn't match what it declared (a
  `ReferenceError` on the very first `require`).
- A hardcoded ~100 second `sleep()` inside every transaction.
- The balance check read a field (`.balance`) that doesn't exist on the
  account model instead of checking `.status`.
- Several syntax errors (duplicate imports, a stray character, a missing
  brace, `function` written as `const fn(){}`) that would throw immediately.
- No refresh tokens — sessions had no way to renew without logging in again.

See the diffs for the full list; every controller, model, and middleware
file was rewritten.

## What was added

- **Access + refresh token auth**, with refresh-token **rotation and reuse
  detection**: each refresh token can be used exactly once; using an
  already-used one revokes the entire session family and forces re-login
  (the standard mitigation for a stolen refresh token).
- Request validation (`zod`), centralized error handling, rate limiting on
  auth routes, security headers (`helmet`), and NoSQL-injection sanitization.
- Idempotent transfers with correct semantics: replaying the same
  `idempotencyKey` returns the original result instead of erroring or double-spending.
- A `/api/transactions/deposits` (system-only) and `/api/transactions/sandbox-topup`
  (dev-only, any user) endpoint, so accounts can actually be funded — the
  original code had this half-built and commented out.
- Transaction history with pagination + filtering, per-account statements, and CSV export.
- Simple rule-based fraud flagging (large transfers are flagged for review, not blocked).
- Real-time updates over Socket.io (`transaction:completed` / `transaction:received`).
- Structured logging (`pino`), request IDs, graceful shutdown, a `/health` endpoint.
- Interactive API docs at `/api/docs` (OpenAPI/Swagger).
- A small static demo UI (see below).
- A `Dockerfile` for deployment.

## Do you need a UI to deploy this?

No — this is a backend API, and it works fine with zero UI: hit it with
`curl`, Postman/Insomnia, or a mobile/web client you build separately.
`/api/docs` also gives you a browsable, try-it-out UI for the API itself
with no extra code.

That said, you asked to showcase the functions you built, so `/public`
contains a small dependency-free demo frontend (plain HTML/CSS/JS, no
build step) that exercises the whole flow: register/login, silent token
refresh, create accounts, sandbox top-up, transfer money, watch the ledger
update live. It's served automatically by the same Express app at `/`.
Delete the `public/` folder and the `express.static(...)` line in `src/app.js`
any time if you'd rather ship this as an API-only service.

## Setup

```bash
npm install
cp .env.example .env   # then fill in MONGO_URI and JWT_SECRET at minimum
npm run dev             # nodemon, restarts on change
# or
npm start
```

Open `http://localhost:3000` for the demo UI, or `http://localhost:3000/api/docs` for the API docs.

## Refresh token flow (what changed)

1. `POST /api/auth/login` (or `/register`) sets two httpOnly cookies —
   `token` (access, ~15 min) and `refreshToken` (opaque random string, 30
   days, scoped to `/api/auth`) — and also returns both in the JSON body for
   non-browser clients.
2. The refresh token is never stored in plaintext: only its SHA-256 hash is
   persisted (`refreshToken` collection), alongside a `family` id.
3. `POST /api/auth/refresh-token` looks up the presented token by hash. If
   valid, it's marked revoked and a *new* pair is issued in the same family
   (rotation). If a token that was already revoked is presented again,
   that's reuse — the whole family is revoked and the client must log in
   again.
4. `POST /api/auth/logout` revokes the current refresh token and blacklists
   the current access token.

## API overview

| Method | Path                                     | Notes                                    |
|--------|-------------------------------------------|-------------------------------------------|
| POST   | `/api/auth/register`                      |                                            |
| POST   | `/api/auth/login`                         |                                            |
| POST   | `/api/auth/refresh-token`                 | rotates the refresh token                 |
| POST   | `/api/auth/logout`                        |                                            |
| GET    | `/api/auth/me`                            | requires auth                             |
| POST   | `/api/accounts`                           | requires auth                             |
| GET    | `/api/accounts`                           | requires auth, includes live balances     |
| GET    | `/api/accounts/balance/:accountId`        | requires auth                             |
| GET    | `/api/accounts/:accountId/transactions`   | paginated statement                       |
| POST   | `/api/transactions`                       | idempotent transfer                       |
| POST   | `/api/transactions/deposits`              | system users only                         |
| POST   | `/api/transactions/sandbox-topup`         | any user, **disabled in production**      |
| GET    | `/api/transactions`                       | paginated history across your accounts    |
| GET    | `/api/transactions/:transactionId`        |                                            |
| GET    | `/api/transactions/export.csv`            | CSV statement                             |
| GET    | `/health`                                 | liveness check                            |

Full request/response shapes: `/api/docs`.

## Concurrency & hardening fixes (round 2)

A follow-up review caught five more issues, all now fixed:

1. **Balance check race condition** - the balance check used to run as a
   separate read *before* the transfer's database transaction started, so
   two simultaneous transfers from the same account could both read the
   same starting balance and both pass. Fixed by making the check-and-debit
   one atomic `findOneAndUpdate` (`balance: { $gte: amount }` + `$inc`),
   which MongoDB guarantees is indivisible at the document level. This also
   required adding a cached `balance` field to the Account model (see
   `scripts/backfill-account-balances.js` for migrating existing data) and
   a retry loop for the transient write conflicts MongoDB transactions
   correctly raise when two of these atomic updates land on the same
   document at once (`src/utils/withTransactionRetry.js`).
2. **Refresh token rotation wasn't atomic** - the old token was marked
   revoked *after* the new one was already issued, leaving a window where
   two simultaneous refreshes of the same token could both succeed and fork
   the token family. Fixed by making the revoke step itself the atomic
   claim: `findOneAndUpdate({ tokenHash, revokedAt: null }, ...)` can only
   succeed once, however close together two requests arrive.
3. **Idempotency key didn't validate the payload** - replaying a key
   returned the original transaction unconditionally, even if the amount or
   accounts in the new request were different. Now the replayed request's
   parameters are checked against the original; a mismatch returns `409`
   instead of silently returning stale data. Keys are also now scoped to
   `(initiatedBy, idempotencyKey)` instead of being globally unique, and a
   genuine concurrent duplicate (two identical requests racing before
   either has committed) is now handled by catching the resulting
   duplicate-key error and returning the winner's result, instead of that
   second request failing.
4. **CSV export formula injection** - a transaction `note` starting with
   `=`, `+`, `-`, or `@` could be interpreted as a live formula by
   Excel/Sheets when the exported statement was opened (e.g.
   `=HYPERLINK(...)`), a known CSV/spreadsheet injection class. Every
   exported field is now formula-guarded (prefixed with `'` when it starts
   with a formula-triggering character) and properly quoted.
5. **Treasury account creation wasn't race-safe** - two concurrent requests
   before the treasury account existed could both try to create the system
   user/account; the user creation would crash with an uncaught duplicate-key
   error, and the account had no uniqueness guarantee at all (risking two
   separate treasury accounts with split balances). Fixed with atomic
   upserts, a partial unique index (`role: "TREASURY"`) that makes a second
   one impossible at the database level regardless of how many server
   processes are running, an in-process promise guard so concurrent callers
   in the same process share one initialization attempt, and a startup
   warm-up call so the race window is essentially closed before real
   traffic ever arrives.

## বাংলায় ব্যাখ্যা (Explanation in Bangla)

নিচে দুই রাউন্ডেই যেসব পরিবর্তন করা হয়েছে, তার বিস্তারিত ব্যাখ্যা বাংলায় দেওয়া হলো — কোথায় পরিবর্তন হয়েছে এবং কেন দরকার ছিল।

### প্রথম রাউন্ড — মূল বাগ ফিক্স

**লগইনে পাসওয়ার্ড চেক হতো না** — `auth.controller.js`-এ `userLoginController` শুধু ইমেইল দিয়ে ইউজার খুঁজে টোকেন ইস্যু করে দিত, `comparePassword()` কখনো কল হতো না। মানে যেকোনো পাসওয়ার্ড দিয়ে যেকোনো রেজিস্টার্ড ইমেইল দিয়ে লগইন করা যেত — এটা সবচেয়ে বড় নিরাপত্তা ত্রুটি ছিল। এখন `user.comparePassword(password)` চেক করে, ভুল হলে ৪০১ এরর দেয়।

**`authMiddleware`-এ ভুল ফিল্ড আর মিসিং ইম্পোর্ট** — টোকেন সাইন হতো `{ userId: ... }` দিয়ে, কিন্তু মিডলওয়্যার পড়তো `decoded.id` — কখনো মিলতো না। সাথে `tokenBlackListModel` ইম্পোর্টই করা ছিল না, তাই ব্যবহার করামাত্র ক্র্যাশ করতো। এখন `decoded.userId` ঠিকভাবে পড়া হয় এবং মডেল ইম্পোর্ট করা আছে।

**মডেলের ভ্যারিয়েবল নাম মিসম্যাচ** — `blackList.model.js`-এ ডিক্লেয়ার করা হয়েছিল `tokenBlackListModel` কিন্তু এক্সপোর্ট করার সময় লেখা ছিল `tokenBlacklistModel` (case ভিন্ন) — `ReferenceError` দিয়ে সার্ভার বুট হওয়ার আগেই ক্র্যাশ করতো।

**ট্রানজেকশনের ভেতরে হার্ডকোডেড ১০০ সেকেন্ডের sleep** — প্রতিটা ট্রানজ্যাকশন রিকোয়েস্টে প্রায় দুই মিনিট আটকে থাকতো, এটা ছিল স্পষ্টত ডিবাগিং কোড যা রয়ে গিয়েছিল। সম্পূর্ণ সরিয়ে ফেলা হয়েছে।

**ব্যালান্স চেক ভুল ফিল্ডে হতো** — `fromUserAccount.balance` চেক করা হতো, কিন্তু account মডেলে `balance` নামে কোনো ফিল্ডই ছিল না (undefined-এর সাথে তুলনা)। `.status === "ACTIVE"` চেক করার কথা ছিল।

**একাধিক সিনট্যাক্স এরর** — ডুপ্লিকেট ইম্পোর্ট, ব্র্যাকেট মিসিং, `function` এর বদলে `const fn(){}` লেখা, স্ট্রে ক্যারেক্টার — এগুলোর প্রতিটাই সার্ভার বুট হওয়ার আগেই ক্র্যাশ করাতো।

**রিফ্রেশ টোকেন সিস্টেম একদমই ছিল না** — অ্যাক্সেস টোকেন এক্সপায়ার হলে ইউজারকে আবার লগইন করতে হতো, কোনো সাইলেন্ট রিনিউয়াল ছিল না। এই রাউন্ডে যোগ করা হয়েছিল rotation + reuse detection সহ।

### দ্বিতীয় রাউন্ড — কনকারেন্সি ও সিকিউরিটি হার্ডেনিং (এই মেসেজে)

**১. ব্যালান্স চেকের রেস কন্ডিশন** — সমস্যা ছিল: ব্যালান্স "পড়া" (read) হতো MongoDB ট্রানজ্যাকশন শুরুর *আগে*। দুইটা ট্রান্সফার রিকোয়েস্ট যদি একই মুহূর্তে আসে, দুটোই একই (পুরনো) ব্যালান্স দেখে "যথেষ্ট টাকা আছে" ভেবে এগিয়ে যেতে পারতো, ফলে অ্যাকাউন্ট নেগেটিভ ব্যালান্সে চলে যেতে পারতো। এটা fix করা হয়েছে `account.model.js`-এ একটি cached `balance` ফিল্ড যোগ করে, আর `transaction.controller.js`-এর `performTransfer`-এ চেক-এবং-ডেবিট একটাই atomic অপারেশন (`findOneAndUpdate` with `$gte` filter) দিয়ে করে — MongoDB নিশ্চয়তা দেয় যে একটা ডকুমেন্টে করা একক অপারেশন সবসময় atomic (অবিভাজ্য) হয়, তাই দুটো রিকোয়েস্টের মাঝে "ফাঁকা সময়" (race window) আর থাকে না। যেহেতু এটা একটা নতুন ফিল্ড, তাই পুরনো ডেটার জন্য `scripts/backfill-account-balances.js` মাইগ্রেশন স্ক্রিপ্টও দেওয়া হয়েছে।

**২. রিফ্রেশ টোকেন রোটেশন সম্পূর্ণ atomic ছিল না** — আগে পুরনো টোকেনকে revoke করা হতো নতুন টোকেন ইস্যু করার *পরে* — মাঝে একটা ফাঁক (gap) থেকে যেত যেখানে দুটো concurrent রিফ্রেশ রিকোয়েস্ট একই পুরনো টোকেন ব্যবহার করে দুটোই সফল হয়ে যেতে পারতো, যা টোকেন family-কে দুই ভাগে split করে দিত (reuse-detection এর নিরাপত্তা গ্যারান্টি দুর্বল করে)। এখন `auth.controller.js`-এ revoke করাটাই atomic claim হিসেবে কাজ করে — `findOneAndUpdate({tokenHash, revokedAt: null}, ...)` — এটা একবারই সফল হতে পারে, যত কাছাকাছি সময়েই দুটো রিকোয়েস্ট আসুক না কেন।

**৩. একই Idempotency Key দিয়ে ভিন্ন রিকোয়েস্ট পাঠানোর ঝুঁকি** — আগে একই key মিললেই পুরনো ট্রানজ্যাকশন রিটার্ন হয়ে যেত, তার প্যারামিটার (amount, accounts) নতুন রিকোয়েস্টের সাথে মিলছে কিনা তা চেক হতো না। এখন `performTransfer`-এ `assertIdempotentReplayMatches()` ফাংশন দিয়ে যাচাই করা হয় — না মিললে ৪০৯ এরর রিটার্ন হয়। সাথে `transaction.model.js`-এ ইনডেক্স পরিবর্তন করে key-কে `(initiatedBy, idempotencyKey)` এর কম্পোজিট ইউনিক করা হয়েছে (আগে গ্লোবালি ইউনিক ছিল, যা ভিন্ন ইউজারদের মধ্যে অহেতুক কনফ্লিক্ট তৈরি করতে পারতো)।

**৪. CSV Export-এ Formula Injection ঝুঁকি** — `note` ফিল্ডে ইউজার নিজে টেক্সট লিখতে পারে। যদি কেউ `=HYPERLINK(...)` বা `=cmd|...` এর মতো টেক্সট নোট হিসেবে লেখে, আর সেই CSV ফাইল কেউ Excel/Google Sheets-এ খোলে, তাহলে সেটা টেক্সট হিসেবে না দেখিয়ে ফর্মুলা হিসেবে *execute* হয়ে যেতে পারে (একে বলে CSV/Spreadsheet Injection, OWASP-এর পরিচিত একটা ঝুঁকি)। এখন `transaction.controller.js`-এ `csvField()` হেল্পার যোগ করা হয়েছে যা `=`, `+`, `-`, `@` দিয়ে শুরু হওয়া যেকোনো ফিল্ডের আগে একটা সিঙ্গেল-কোট (`'`) বসিয়ে দেয়, যাতে স্প্রেডশিট সফটওয়্যার সেটাকে প্লেইন টেক্সট হিসেবেই দেখায়, ফর্মুলা হিসেবে না।

**৫. সিস্টেম ট্রেজারি অ্যাকাউন্ট তৈরির রেস কন্ডিশন** — `treasury.service.js`-এ আগে সিস্টেম ইউজার/অ্যাকাউন্ট "খুঁজে না পেলে তৈরি করো" এই লজিক আলাদা আলাদা `findOne` + `create` দিয়ে করা হতো, কোনো কো-অর্ডিনেশন ছাড়া। দুটো রিকোয়েস্ট একসাথে এলে (যেমন ডিপ্লয়ের পর প্রথম ডিপোজিট রিকোয়েস্ট) দুটোই "নেই" দেখে দুটোই তৈরি করতে চেষ্টা করতো — ইউজারের ক্ষেত্রে unique email index-এ ধাক্কা খেয়ে uncaught error-এ পুরো রিকোয়েস্টই ক্র্যাশ করতো, আর অ্যাকাউন্টের ক্ষেত্রে কোনো unique constraint না থাকায় দুটো আলাদা ট্রেজারি অ্যাকাউন্ট তৈরি হয়ে যেতে পারতো (ব্যালান্স ভাগ হয়ে গিয়ে হিসাব গুলিয়ে যেত)। এখন তিন স্তরে ফিক্স করা হয়েছে: (ক) `findOneAndUpdate` দিয়ে atomic upsert, (খ) `account.model.js`-এ `role: "TREASURY"` এর উপর partial unique index — যেটা ডাটাবেজ লেভেলেই নিশ্চিত করে যে দ্বিতীয় ট্রেজারি অ্যাকাউন্ট কখনোই তৈরি হতে পারবে না, (গ) একই প্রসেসের মধ্যে একাধিক কল হলে সবাই একই `initPromise` শেয়ার করে, এবং (ঘ) `server.js`-এ স্টার্টআপেই একবার warm-up কল করে রাখা হয়েছে যাতে বাস্তব ট্র্যাফিক আসার আগেই এটা তৈরি হয়ে থাকে।



## Deployment

```bash
docker run -p 3000:3000 --env-file .env bank-transaction
```

Set `NODE_ENV=production` (this also disables `/api/transactions/sandbox-topup`
and turns on cookie `secure` flags, so you'll need HTTPS in front of it — a
reverse proxy like Caddy, Nginx, or your platform's built-in TLS termination).
