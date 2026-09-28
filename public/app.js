(() => {
  "use strict";

  function uuid() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  const state = {
    user: null,
    accessToken: null,
    accessTokenExp: null,
    accounts: [],
    page: 1,
    statusFilter: "",
  };

  let refreshInFlight = null;

  async function api(path, options = {}) {
    const doFetch = () =>
      fetch(path, {
        ...options,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(state.accessToken
            ? { Authorization: `Bearer ${state.accessToken}` }
            : {}),
          ...(options.headers || {}),
        },
      });

    let res = await doFetch();

    if (res.status === 401 && path !== "/api/auth/refresh-token") {
      if (!refreshInFlight)
        refreshInFlight = silentRefresh().finally(
          () => (refreshInFlight = null),
        );
      const refreshed = await refreshInFlight;
      if (refreshed) res = await doFetch();
    }

    return res;
  }

  async function silentRefresh() {
    try {
      const res = await fetch("/api/auth/refresh-token", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("refresh failed");
      const data = await res.json();
      setAccessToken(data.accessToken);
      return true;
    } catch {
      clearSession();
      return false;
    }
  }

  function setAccessToken(token) {
    state.accessToken = token;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      state.accessTokenExp = payload.exp * 1000;
    } catch {
      state.accessTokenExp = null;
    }
    renderSessionPanel();
  }

  function clearSession() {
    state.user = null;
    state.accessToken = null;
    state.accessTokenExp = null;
    disconnectSocket();
    showAuthView();
  }

  // ---------------------------------------------------------------------
  // toasts
  // ---------------------------------------------------------------------
  function toast(message, kind = "info") {
    const root = document.getElementById("toastRoot");
    const el = document.createElement("div");
    el.className = `toast${kind !== "info" ? ` toast-${kind}` : ""}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ---------------------------------------------------------------------
  // auth screen
  // ---------------------------------------------------------------------
  function showAuthView() {
    document.getElementById("authView").classList.remove("hidden");
    document.getElementById("appView").classList.add("hidden");
    document.getElementById("userChip").classList.add("hidden");
    document.getElementById("logoutBtn").classList.add("hidden");
  }

  function showAppView() {
    document.getElementById("authView").classList.add("hidden");
    document.getElementById("appView").classList.remove("hidden");
    const chip = document.getElementById("userChip");
    chip.textContent = `${state.user.name} · ${state.user.email}`;
    chip.classList.remove("hidden");
    document.getElementById("logoutBtn").classList.remove("hidden");
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.remove("active"));
      document
        .querySelectorAll(".tab-panel")
        .forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(`${tab.dataset.tab}Form`).classList.add("active");
    });
  });

  function formError(formId, message) {
    document.querySelector(`.form-error[data-for="${formId}"]`).textContent =
      message || "";
  }

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    formError("loginForm", "");
    const body = Object.fromEntries(new FormData(e.target));
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return formError("loginForm", data.message || "login failed");
    onAuthenticated(data);
  });

  document
    .getElementById("registerForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      formError("registerForm", "");
      const body = Object.fromEntries(new FormData(e.target));
      const res = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok)
        return formError("registerForm", data.message || "registration failed");
      onAuthenticated(data);
    });

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    clearSession();
    toast("Logged out", "info");
  });

  document.getElementById("refreshBtn").addEventListener("click", async () => {
    formError("refreshBtn", "");
    const ok = await silentRefresh();
    if (ok) toast("Access token rotated", "success");
    else formError("refreshBtn", "refresh failed - please log in again");
  });

  async function onAuthenticated(data) {
    state.user = data.user;
    setAccessToken(data.accessToken);
    showAppView();
    connectSocket();
    await Promise.all([loadAccounts(), loadTransactions()]);
  }

  // Try to resume a session on load using the refresh-token cookie, so a
  // page refresh doesn't force a fresh login every time.
  (async function bootstrap() {
    const ok = await silentRefresh();
    if (!ok) return showAuthView();
    const res = await api("/api/auth/me");
    if (!res.ok) return showAuthView();
    const data = await res.json();
    await onAuthenticated({ user: data.user, accessToken: state.accessToken });
  })();

  // ---------------------------------------------------------------------
  // session panel
  // ---------------------------------------------------------------------
  function renderSessionPanel() {
    const preview = document.getElementById("accessTokenPreview");
    const expiry = document.getElementById("accessTokenExpiry");
    if (!state.accessToken) {
      preview.textContent = "—";
      expiry.textContent = "—";
      return;
    }
    preview.textContent = `${state.accessToken.slice(0, 24)}…`;
    preview.title = state.accessToken;
    expiry.textContent = state.accessTokenExp
      ? new Date(state.accessTokenExp).toLocaleTimeString()
      : "—";
  }

  // ---------------------------------------------------------------------
  // accounts
  // ---------------------------------------------------------------------
  async function loadAccounts() {
    const res = await api("/api/accounts");
    const data = await res.json();
    if (!res.ok)
      return toast(data.message || "could not load accounts", "error");
    state.accounts = data.accounts;
    renderAccounts();
  }

  function renderAccounts() {
    const list = document.getElementById("accountsList");
    const select = document.getElementById("fromAccountSelect");

    list.innerHTML = "";
    select.innerHTML = "";

    if (state.accounts.length === 0) {
      list.innerHTML = `<p class="fine-print">No accounts yet — create one to get started.</p>`;
    }

    for (const acc of state.accounts) {
      const card = document.createElement("div");
      card.className = "account-card";
      card.innerHTML = `
        <div>
          <div class="account-balance">${formatMoney(acc.balance, acc.currency)}</div>
          <div class="account-id">${acc._id}</div>
          <div class="account-status">${acc.status}</div>
        </div>
        <div class="account-actions">
          <button class="btn btn-small" data-topup="${acc._id}">+ Top up</button>
        </div>`;
      list.appendChild(card);

      const opt = document.createElement("option");
      opt.value = acc._id;
      opt.textContent = `${acc._id.slice(-6)} · ${formatMoney(acc.balance, acc.currency)}`;
      select.appendChild(opt);
    }

    list.querySelectorAll("[data-topup]").forEach((btn) => {
      btn.addEventListener("click", () => topUp(btn.dataset.topup));
    });
  }

  document
    .getElementById("newAccountBtn")
    .addEventListener("click", async () => {
      const res = await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok)
        return toast(data.message || "could not create account", "error");
      toast("Account created", "success");
      await loadAccounts();
    });

  async function topUp(accountId) {
    const amount = window.prompt(
      "Sandbox top-up amount (dev/demo only):",
      "100",
    );
    if (!amount) return;
    const res = await api("/api/transactions/sandbox-topup", {
      method: "POST",
      body: JSON.stringify({
        toAccount: accountId,
        amount: Number(amount),
        idempotencyKey: uuid(),
      }),
    });
    const data = await res.json();
    if (!res.ok) return toast(data.message || "top-up failed", "error");
    toast("Top-up completed", "success");
    await Promise.all([loadAccounts(), loadTransactions()]);
  }

  // ---------------------------------------------------------------------
  // transfer
  // ---------------------------------------------------------------------
  document
    .getElementById("transferForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      formError("transferForm", "");
      document.querySelector(
        '.form-success[data-for="transferForm"]',
      ).textContent = "";

      const form = new FormData(e.target);
      const body = {
        fromAccount: form.get("fromAccount"),
        toAccount: form.get("toAccount").trim(),
        amount: Number(form.get("amount")),
        note: form.get("note") || undefined,
        idempotencyKey: uuid(),
      };

      const res = await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok)
        return formError("transferForm", data.message || "transfer failed");

      document.querySelector(
        '.form-success[data-for="transferForm"]',
      ).textContent = "Transfer completed.";
      e.target.reset();
      await Promise.all([loadAccounts(), loadTransactions()]);
    });

  // ---------------------------------------------------------------------
  // transactions table
  // ---------------------------------------------------------------------
  document.getElementById("statusFilter").addEventListener("change", (e) => {
    state.statusFilter = e.target.value;
    state.page = 1;
    loadTransactions();
  });

  async function loadTransactions() {
    const params = new URLSearchParams({ page: state.page, limit: 10 });
    if (state.statusFilter) params.set("status", state.statusFilter);
    const res = await api(`/api/transactions?${params}`);
    const data = await res.json();
    if (!res.ok)
      return toast(data.message || "could not load transactions", "error");
    renderTransactions(data.transactions, data.pagination);
  }

  function renderTransactions(transactions, pagination) {
    const myAccountIds = new Set(state.accounts.map((a) => a._id));
    const tbody = document.getElementById("transactionsBody");
    tbody.innerHTML = "";

    if (transactions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="fine-print">No transactions yet.</td></tr>`;
    }

    for (const t of transactions) {
      const isOutgoing = myAccountIds.has(t.fromAccount);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${new Date(t.createdAt).toLocaleString()}</td>
        <td>${t.type}</td>
        <td class="mono truncate" title="${t.fromAccount}">${t.fromAccount.slice(-8)}</td>
        <td class="mono truncate" title="${t.toAccount}">${t.toAccount.slice(-8)}</td>
        <td class="mono ${isOutgoing ? "amount-out" : "amount-in"}">${isOutgoing ? "-" : "+"}${t.amount}</td>
        <td><span class="badge badge-${t.status}">${t.status}${t.flagged ? " ⚑" : ""}</span></td>`;
      tbody.appendChild(tr);
    }

    const pager = document.getElementById("pagination");
    pager.innerHTML = "";
    if (pagination && pagination.pages > 1) {
      const prev = document.createElement("button");
      prev.className = "btn btn-small";
      prev.textContent = "← Prev";
      prev.disabled = pagination.page <= 1;
      prev.addEventListener("click", () => {
        state.page--;
        loadTransactions();
      });

      const next = document.createElement("button");
      next.className = "btn btn-small";
      next.textContent = "Next →";
      next.disabled = pagination.page >= pagination.pages;
      next.addEventListener("click", () => {
        state.page++;
        loadTransactions();
      });

      const label = document.createElement("span");
      label.className = "fine-print";
      label.style.alignSelf = "center";
      label.textContent = `page ${pagination.page} of ${pagination.pages}`;

      pager.append(prev, label, next);
    }
  }

  // ---------------------------------------------------------------------
  // realtime
  // ---------------------------------------------------------------------
  let socket = null;

  function connectSocket() {
    if (typeof io === "undefined" || !state.accessToken) return;
    socket = io({ auth: { token: state.accessToken } });

    socket.on("connect", () => setSocketStatus(true));
    socket.on("disconnect", () => setSocketStatus(false));
    socket.on("connect_error", () => setSocketStatus(false));

    socket.on("transaction:completed", () => {
      toast("Transaction completed", "success");
      loadAccounts();
      loadTransactions();
    });
    socket.on("transaction:received", () => {
      toast("Funds received", "success");
      loadAccounts();
      loadTransactions();
    });
  }

  function disconnectSocket() {
    if (socket) socket.disconnect();
    socket = null;
    setSocketStatus(false);
  }

  function setSocketStatus(on) {
    const pill = document.getElementById("socketStatus");
    pill.textContent = on ? "live: on" : "live: off";
    pill.classList.toggle("status-on", on);
    pill.classList.toggle("status-off", !on);
  }

  // ---------------------------------------------------------------------
  // utils
  // ---------------------------------------------------------------------
  function formatMoney(amount, currency) {
    return `${Number(amount).toFixed(2)} ${currency || ""}`.trim();
  }
})();
