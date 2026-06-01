import { generateTOTP, totpSecondsRemaining } from "./totp";

const WEB_APP_URL = "http://localhost:3000";

type VaultItem = {
  id: string;
  name?: string;
  type?: string;
  url?: string;
  username?: string;
  password?: string;
  totp?: string;
  noteText?: string;
  notes?: string;
  cardholderName?: string;
  cardNumber?: string;
  expirationDate?: string;
  cvv?: string;
  pin?: string;
  aliasEmail?: string;
  forwardTo?: string;
  identityFirstName?: string;
  identityLastName?: string;
  identityEmail?: string;
  identityPhone?: string;
};

type Category = "all" | "login" | "card" | "note" | "identity" | "alias" | "passkey";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "login", label: "Logins" },
  { id: "card", label: "Cards" },
  { id: "note", label: "Notes" },
  { id: "identity", label: "Identity" },
  { id: "alias", label: "Aliases" },
  { id: "passkey", label: "Passkeys" },
];

const TYPE_ICONS: Record<string, string> = {
  login: "🔑",
  card: "💳",
  note: "📝",
  identity: "👤",
  alias: "✉️",
  passkey: "🛡️",
};

const COPY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
const EYE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_OFF_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>`;

function cleanHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/** Primary keyword for site filter (github.com → github). */
function getSiteSearchToken(hostname: string): string {
  const clean = cleanHostname(hostname);
  if (!clean) return "";
  const parts = clean.split(".").filter(Boolean);
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return parts[0] || "";
}

function isFilterablePageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function itemMatchesSite(item: VaultItem, hostname: string): boolean {
  const domain = cleanHostname(hostname);
  const token = getSiteSearchToken(hostname);
  const url = (item.url || "").toLowerCase();
  const name = (item.name || "").toLowerCase();
  if (url.includes(domain)) return true;
  if (token && (url.includes(token) || name.includes(token))) return true;
  return false;
}

function itemMatchesQuery(item: VaultItem, query: string, hostname: string): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;

  const name = (item.name || "").toLowerCase();
  const user = (item.username || "").toLowerCase();
  const url = (item.url || "").toLowerCase();
  const note = (item.noteText || "").toLowerCase();

  if (name.includes(q) || user.includes(q) || url.includes(q) || note.includes(q)) {
    return true;
  }

  if (hostname) {
    const domain = cleanHostname(hostname);
    const siteToken = getSiteSearchToken(hostname);
    if (q === siteToken || q === domain) {
      return itemMatchesSite(item, hostname);
    }
  }

  return false;
}

document.addEventListener("DOMContentLoaded", async () => {
  const loginScreen = document.getElementById("login-screen")!;
  const vaultScreen = document.getElementById("vault-screen")!;
  const loginForm = document.getElementById("login-form") as HTMLFormElement;
  const emailInput = document.getElementById("email") as HTMLInputElement;
  const passwordInput = document.getElementById("password") as HTMLInputElement;
  const loginBtn = document.getElementById("login-btn") as HTMLButtonElement;
  const logoutBtn = document.getElementById("logout-btn")!;
  const openDashboardBtn = document.getElementById("open-dashboard-btn")!;
  const loginError = document.getElementById("login-error")!;
  const userEmailPill = document.getElementById("user-email-pill")!;
  const searchInput = document.getElementById("search") as HTMLInputElement;
  const searchWrap = document.getElementById("search-wrap")!;
  const searchClearBtn = document.getElementById("search-clear") as HTMLButtonElement;
  const itemsList = document.getElementById("items-list")!;
  const categoryTabs = document.getElementById("category-tabs")!;
  const detailPlaceholder = document.getElementById("detail-placeholder")!;
  const detailPane = document.getElementById("detail-pane")!;
  const detailTitle = document.getElementById("detail-title")!;
  const detailBadge = document.getElementById("detail-badge")!;
  const detailViewFields = document.getElementById("detail-view-fields")!;
  const detailEditFields = document.getElementById("detail-edit-fields")!;
  const editBtn = document.getElementById("edit-btn") as HTMLButtonElement;
  const editName = document.getElementById("edit-name") as HTMLInputElement;
  const editTypeFields = document.getElementById("edit-type-fields")!;
  const editNote = document.getElementById("edit-note") as HTMLTextAreaElement;
  const saveEditBtn = document.getElementById("save-edit-btn") as HTMLButtonElement;
  const cancelEditBtn = document.getElementById("cancel-edit-btn") as HTMLButtonElement;
  const detailAutofillBtn = document.getElementById("detail-autofill-btn") as HTMLButtonElement;
  const vaultLoading = document.getElementById("vault-loading")!;
  const toastEl = document.getElementById("toast")!;

  let allItems: VaultItem[] = [];
  let activeTabDomain = "";
  let activeTabUrl = "";
  let siteFilterActive = false;
  let currentDetailItem: VaultItem | null = null;
  let activeCategory: Category = "all";
  let sessionEmail = "";
  let totpInterval: ReturnType<typeof setInterval> | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  const passwordVisible = new Map<string, boolean>();

  function showToast(message: string, type: "success" | "error" | "default" = "default") {
    toastEl.textContent = message;
    toastEl.className = `toast${type === "success" ? " toast-success" : type === "error" ? " toast-error" : ""}`;
    toastEl.classList.remove("hidden");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2200);
  }

  function setVaultLoading(loading: boolean) {
    vaultLoading.classList.toggle("hidden", !loading);
    itemsList.classList.toggle("hidden", loading);
  }

  function countForCategory(cat: Category): number {
    if (cat === "all") return allItems.length;
    return allItems.filter((i) => (i.type || "login") === cat).length;
  }

  function updateCategoryTabCounts() {
    categoryTabs.querySelectorAll<HTMLButtonElement>(".tab").forEach((btn) => {
      const cat = btn.dataset.category as Category;
      const meta = CATEGORIES.find((c) => c.id === cat);
      const count = countForCategory(cat);
      btn.innerHTML = `${meta?.label || cat}<span class="tab-count">${count}</span>`;
    });
  }

  CATEGORIES.forEach((cat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `tab${cat.id === "all" ? " active" : ""}`;
    btn.dataset.category = cat.id;
    btn.setAttribute("role", "tab");
    btn.innerHTML = `${cat.label}<span class="tab-count">0</span>`;
    btn.addEventListener("click", () => {
      activeCategory = cat.id;
      categoryTabs.querySelectorAll(".tab").forEach((el) => el.classList.remove("active"));
      btn.classList.add("active");
      applyFilters();
    });
    categoryTabs.appendChild(btn);
  });

  openDashboardBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: `${WEB_APP_URL}/dashboard` });
  });

  const authResponse = await chrome.runtime.sendMessage({ type: "check-auth" });
  if (authResponse?.isAuthenticated) {
    sessionEmail = authResponse.email || "";
    showVaultScreen();
  } else {
    showLoginScreen();
  }

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.classList.add("hidden");
    loginError.textContent = "";
    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";

    try {
      const response = await chrome.runtime.sendMessage({
        type: "login",
        email: emailInput.value.trim(),
        password: passwordInput.value,
      });
      if (response?.success) {
        const authCheck = await chrome.runtime.sendMessage({ type: "check-auth" });
        sessionEmail = authCheck?.email || emailInput.value.trim();
        showVaultScreen();
      } else {
        loginError.textContent = response?.error || "Login failed.";
        loginError.classList.remove("hidden");
      }
    } catch (err: unknown) {
      loginError.textContent = err instanceof Error ? err.message : "Connection error.";
      loginError.classList.remove("hidden");
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign in";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "logout" });
    sessionEmail = "";
    showLoginScreen();
  });

  function updateSearchClearButton() {
    const hasQuery = !!searchInput.value.trim();
    searchClearBtn.classList.toggle("hidden", !hasQuery);
  }

  function clearSearch(showAll = true) {
    searchInput.value = "";
    siteFilterActive = false;
    searchWrap.classList.remove("site-filter-active");
    updateSearchClearButton();
    if (showAll) {
      applyFilters();
      if (allItems.length) selectItem(allItems[0]);
    }
  }

  function applySiteContextFilter(): boolean {
    if (!activeTabDomain || !isFilterablePageUrl(activeTabUrl)) {
      return false;
    }

    const token = getSiteSearchToken(activeTabDomain);
    if (!token) return false;

    searchInput.value = token;
    siteFilterActive = true;
    searchWrap.classList.add("site-filter-active");
    updateSearchClearButton();
    return true;
  }

  searchClearBtn.addEventListener("click", () => clearSearch(true));

  searchInput.addEventListener("input", () => {
    if (!searchInput.value.trim()) {
      siteFilterActive = false;
      searchWrap.classList.remove("site-filter-active");
    } else if (
      activeTabDomain &&
      searchInput.value.trim().toLowerCase() === getSiteSearchToken(activeTabDomain)
    ) {
      siteFilterActive = true;
      searchWrap.classList.add("site-filter-active");
    } else {
      siteFilterActive = false;
      searchWrap.classList.remove("site-filter-active");
    }
    updateSearchClearButton();
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyFilters, 140);
  });

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearSearch(true);
      searchInput.blur();
    }
  });

  itemsList.addEventListener("keydown", (e) => {
    const rows = Array.from(itemsList.querySelectorAll<HTMLElement>(".vault-row"));
    if (!rows.length) return;
    const visible = getFilteredItems();
    const idx = rows.findIndex((r) => r.classList.contains("active"));
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = rows[Math.min(idx + 1, rows.length - 1)] || rows[0];
      const item = visible.find((i) => i.id === next.dataset.id);
      if (item) selectItem(item);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = rows[Math.max(idx - 1, 0)] || rows[rows.length - 1];
      const item = visible.find((i) => i.id === prev.dataset.id);
      if (item) selectItem(item);
    } else if (e.key === "Enter" && currentDetailItem?.type === "login") {
      triggerAutofill(currentDetailItem);
    }
  });

  editBtn.addEventListener("click", showEditMode);
  cancelEditBtn.addEventListener("click", showDisplayMode);
  saveEditBtn.addEventListener("click", saveEdit);

  detailAutofillBtn.addEventListener("click", () => {
    if (currentDetailItem) triggerAutofill(currentDetailItem);
  });

  function showLoginScreen() {
    loginScreen.classList.remove("hidden");
    vaultScreen.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    openDashboardBtn.classList.add("hidden");
    userEmailPill.classList.add("hidden");
    loginForm.reset();
    stopTotpTimer();
  }

  async function showVaultScreen() {
    loginScreen.classList.add("hidden");
    vaultScreen.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    openDashboardBtn.classList.remove("hidden");
    if (sessionEmail) {
      userEmailPill.textContent = sessionEmail;
      userEmailPill.classList.remove("hidden");
    }
    clearDetailSelection();

    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabUrl = tabs[0]?.url || "";
      if (activeTabUrl && isFilterablePageUrl(activeTabUrl)) {
        activeTabDomain = new URL(activeTabUrl).hostname;
      } else {
        activeTabDomain = "";
      }
    } catch {
      activeTabUrl = "";
      activeTabDomain = "";
    }

    searchInput.value = "";
    siteFilterActive = false;
    searchWrap.classList.remove("site-filter-active");
    await loadVault();
  }

  async function loadVault(selectId?: string) {
    setVaultLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: "get-vault-items" });
      if (!response?.success) {
        showToast(response?.error || "Could not load vault", "error");
        return;
      }
      allItems = response.items || [];
      updateCategoryTabCounts();

      if (selectId) {
        const item = allItems.find((i) => i.id === selectId);
        searchInput.value = "";
        siteFilterActive = false;
        searchWrap.classList.remove("site-filter-active");
        applyFilters();
        if (item) {
          selectItem(item);
          updateSearchClearButton();
          return;
        }
      }

      const hadSiteFilter = applySiteContextFilter();
      applyFilters();

      const visible = getFilteredItems();
      if (visible[0]) {
        selectItem(visible[0]);
      } else if (!hadSiteFilter && allItems[0]) {
        selectItem(allItems[0]);
      }
      updateSearchClearButton();
    } catch (err) {
      console.error("Vault load failed:", err);
      showToast("Vault load failed", "error");
    } finally {
      setVaultLoading(false);
    }
  }

  function getFilteredItems(): VaultItem[] {
    const q = searchInput.value.trim();
    let items = allItems;
    if (activeCategory !== "all") {
      items = items.filter((i) => (i.type || "login") === activeCategory);
    }
    if (q) {
      items = items.filter((i) => itemMatchesQuery(i, q, activeTabDomain));
    }
    return items;
  }

  function applyFilters() {
    const items = getFilteredItems();
    renderItemsList(items);
    updateSearchClearButton();
    if (items.length && currentDetailItem && !items.find((i) => i.id === currentDetailItem!.id)) {
      selectItem(items[0]);
    } else if (!items.length) {
      clearDetailSelection();
    }
  }

  function clearDetailSelection() {
    currentDetailItem = null;
    detailPlaceholder.classList.remove("hidden");
    detailPane.classList.add("hidden");
    itemsList.querySelectorAll(".vault-row").forEach((el) => el.classList.remove("active"));
    stopTotpTimer();
  }

  function selectItem(item: VaultItem) {
    currentDetailItem = item;
    detailPlaceholder.classList.add("hidden");
    detailPane.classList.remove("hidden");
    showDisplayMode();

    detailTitle.textContent = item.name || "Untitled";
    detailBadge.textContent = item.type || "login";

    renderDetailFields(item);
    updateAutofillButton(item);

    itemsList.querySelectorAll(".vault-row").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-id") === item.id);
    });

    const activeRow = itemsList.querySelector(`[data-id="${item.id}"]`);
    activeRow?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function updateAutofillButton(item: VaultItem) {
    const clean = activeTabDomain.toLowerCase().replace(/^www\./, "");
    const canAutofill =
      item.type === "login" &&
      !!clean &&
      (item.url || "").toLowerCase().includes(clean);
    detailAutofillBtn.classList.toggle("hidden", !canAutofill);
  }

  function renderDetailFields(item: VaultItem) {
    stopTotpTimer();
    detailViewFields.innerHTML = "";
    const type = item.type || "login";

    if (type === "login") {
      appendField(detailViewFields, "Username", item.username || "—", true);
      appendSecretField(detailViewFields, "Password", item.password || "", item.id);
      if (item.url) appendField(detailViewFields, "Website", item.url, true, true);
      if (item.totp) appendTotpField(detailViewFields, item.totp);
      if (item.noteText || item.notes) {
        appendField(detailViewFields, "Note", item.noteText || item.notes || "", false);
      }
    } else if (type === "card") {
      appendField(detailViewFields, "Cardholder", item.cardholderName || "—", true);
      appendField(detailViewFields, "Number", item.cardNumber || "—", true);
      appendField(detailViewFields, "Expiry", item.expirationDate || "—", true);
      appendSecretField(detailViewFields, "CVV", item.cvv || "", `${item.id}-cvv`);
      if (item.pin) appendSecretField(detailViewFields, "PIN", item.pin, `${item.id}-pin`);
    } else if (type === "alias") {
      appendField(detailViewFields, "Alias email", item.aliasEmail || item.username || "—", true);
      appendField(detailViewFields, "Forwards to", item.forwardTo || "—", true);
    } else if (type === "identity") {
      appendField(
        detailViewFields,
        "Name",
        [item.identityFirstName, item.identityLastName].filter(Boolean).join(" ") || "—",
        true
      );
      appendField(detailViewFields, "Email", item.identityEmail || "—", true);
      appendField(detailViewFields, "Phone", item.identityPhone || "—", true);
    } else if (type === "note") {
      appendField(detailViewFields, "Note", item.noteText || item.notes || "—", false);
    } else if (type === "passkey") {
      appendField(detailViewFields, "Relying party", item.url || "—", false);
      appendField(detailViewFields, "Username", item.username || "—", true);
    } else {
      appendField(detailViewFields, "Username", item.username || "—", true);
      if (item.password) appendSecretField(detailViewFields, "Password", item.password, item.id);
    }
  }

  function appendField(
    parent: HTMLElement,
    label: string,
    value: string,
    copyable: boolean,
    isLink = false
  ) {
    const wrap = document.createElement("div");
    wrap.className = "detail-field";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    const row = document.createElement("div");
    row.className = "value-row";
    const span = document.createElement("span");
    if (isLink && value !== "—") {
      const a = document.createElement("a");
      a.href = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "link-btn";
      a.textContent = value;
      span.appendChild(a);
    } else {
      span.textContent = value;
    }
    row.appendChild(span);
    if (copyable && value && value !== "—") {
      row.appendChild(makeCopyButton(value));
    }
    wrap.appendChild(lbl);
    wrap.appendChild(row);
    parent.appendChild(wrap);
  }

  function appendSecretField(parent: HTMLElement, label: string, value: string, key: string) {
    const wrap = document.createElement("div");
    wrap.className = "detail-field";
    const lbl = document.createElement("label");
    lbl.textContent = label;
    const row = document.createElement("div");
    row.className = "value-row";
    const span = document.createElement("span");
    const visible = passwordVisible.get(key) || false;
    span.textContent = visible ? value || "—" : value ? "••••••••••••" : "—";
    if (!visible && value) span.classList.add("masked");
    row.appendChild(span);

    if (value) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "icon-btn";
      toggle.title = "Show/hide";
      toggle.innerHTML = visible ? EYE_OFF_SVG : EYE_SVG;
      toggle.addEventListener("click", () => {
        passwordVisible.set(key, !passwordVisible.get(key));
        renderDetailFields(currentDetailItem!);
      });
      row.appendChild(toggle);
      row.appendChild(makeCopyButton(value));
    }

    wrap.appendChild(lbl);
    wrap.appendChild(row);
    parent.appendChild(wrap);
  }

  function appendTotpField(parent: HTMLElement, secret: string) {
    const wrap = document.createElement("div");
    wrap.className = "detail-field totp-row";
    const lbl = document.createElement("label");
    lbl.textContent = "Authenticator";
    const row = document.createElement("div");
    row.className = "value-row";
    const codeEl = document.createElement("span");
    codeEl.className = "totp-code";
    const timerEl = document.createElement("span");
    timerEl.className = "totp-timer";
    row.appendChild(codeEl);
    row.appendChild(timerEl);
    row.appendChild(makeCopyButton(""));

    const refresh = async () => {
      const code = await generateTOTP(secret);
      codeEl.textContent = code;
      timerEl.textContent = `${totpSecondsRemaining()}s`;
      const copyBtn = row.querySelector(".icon-btn:last-child") as HTMLButtonElement;
      if (copyBtn) {
        copyBtn.onclick = () => {
          navigator.clipboard.writeText(code);
          showToast("Code copied", "success");
        };
      }
    };

    refresh();
    stopTotpTimer();
    totpInterval = setInterval(refresh, 1000);

    wrap.appendChild(lbl);
    wrap.appendChild(row);
    parent.appendChild(wrap);
  }

  function makeCopyButton(text: string) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn";
    btn.title = "Copy";
    btn.innerHTML = COPY_SVG;
    btn.addEventListener("click", () => {
      if (!text) return;
      navigator.clipboard.writeText(text);
      flashCopy(btn);
      showToast("Copied to clipboard", "success");
    });
    return btn;
  }

  function flashCopy(btn: HTMLButtonElement) {
    const prev = btn.innerHTML;
    btn.innerHTML = `<span style="font-size:10px;color:#4ade80">✓</span>`;
    setTimeout(() => {
      btn.innerHTML = prev;
    }, 1200);
  }

  function stopTotpTimer() {
    if (totpInterval) {
      clearInterval(totpInterval);
      totpInterval = null;
    }
  }

  function showDisplayMode() {
    detailViewFields.classList.remove("hidden");
    detailEditFields.classList.add("hidden");
    editBtn.classList.remove("hidden");
  }

  function showEditMode() {
    if (!currentDetailItem) return;
    detailViewFields.classList.add("hidden");
    detailEditFields.classList.remove("hidden");
    editBtn.classList.add("hidden");
    editName.value = currentDetailItem.name || "";
    editNote.value = currentDetailItem.noteText || currentDetailItem.notes || "";
    renderEditTypeFields(currentDetailItem);
  }

  function renderEditTypeFields(item: VaultItem) {
    editTypeFields.innerHTML = "";
    const type = item.type || "login";

    const addInput = (label: string, id: string, value: string, typeAttr = "text") => {
      const labelEl = document.createElement("label");
      labelEl.className = "field";
      labelEl.innerHTML = `<span>${label}</span>`;
      const input = document.createElement("input");
      input.type = typeAttr;
      input.id = id;
      input.value = value;
      labelEl.appendChild(input);
      editTypeFields.appendChild(labelEl);
    };

    if (type === "login") {
      addInput("Username", "edit-username", item.username || "");
      addInput("Password", "edit-password", item.password || "", "password");
      addInput("Website", "edit-website", item.url || "");
      addInput("TOTP secret", "edit-totp", item.totp || "");
    } else if (type === "card") {
      addInput("Cardholder", "edit-cardholder", item.cardholderName || "");
      addInput("Card number", "edit-cardnumber", item.cardNumber || "");
      addInput("Expiry", "edit-expiry", item.expirationDate || "");
      addInput("CVV", "edit-cvv", item.cvv || "");
    } else if (type === "note") {
      /* note in edit-note */
    } else {
      addInput("Username", "edit-username", item.username || "");
      addInput("Password", "edit-password", item.password || "", "password");
      addInput("Website", "edit-website", item.url || "");
    }
  }

  async function saveEdit() {
    if (!currentDetailItem || !editName.value.trim()) {
      alert("Title is required");
      return;
    }

    saveEditBtn.disabled = true;
    saveEditBtn.textContent = "Saving…";

    const updated: VaultItem = {
      ...currentDetailItem,
      name: editName.value.trim(),
      noteText: editNote.value,
    };

    const type = currentDetailItem.type || "login";
    const get = (id: string) =>
      (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

    if (type === "login") {
      updated.username = get("edit-username");
      updated.password = get("edit-password");
      updated.url = get("edit-website");
      updated.totp = get("edit-totp");
    } else if (type === "card") {
      updated.cardholderName = get("edit-cardholder");
      updated.cardNumber = get("edit-cardnumber");
      updated.expirationDate = get("edit-expiry");
      updated.cvv = get("edit-cvv");
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "save-vault-item",
        item: updated,
      });
      if (response?.success) {
        showDisplayMode();
        showToast("Saved", "success");
        await loadVault(updated.id!);
      } else {
        showToast("Failed to save: " + (response?.error || "Unknown error"), "error");
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Save failed");
    } finally {
      saveEditBtn.disabled = false;
      saveEditBtn.textContent = "Save";
    }
  }

  function renderItemsList(items: VaultItem[]) {
    itemsList.innerHTML = "";
    if (!items.length) {
      const q = searchInput.value.trim();
      const hint = q
        ? siteFilterActive
          ? `No items for this site. <button type="button" class="empty-clear-link" id="empty-clear-search">Clear search</button> to see all ${allItems.length} items.`
          : `No results for “${q}”. <button type="button" class="empty-clear-link" id="empty-clear-search">Clear search</button>`
        : activeCategory === "all"
          ? `No items yet. <a href="#" id="empty-open-vault">Open full vault</a> to add some.`
          : "No items in this category.";
      itemsList.innerHTML = `<div class="empty-list">${hint}</div>`;
      const link = document.getElementById("empty-open-vault");
      link?.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: `${WEB_APP_URL}/dashboard` });
      });
      document.getElementById("empty-clear-search")?.addEventListener("click", () => clearSearch(true));
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "vault-row";
      row.setAttribute("role", "option");
      row.tabIndex = 0;
      if (currentDetailItem?.id === item.id) row.classList.add("active");
      row.dataset.id = item.id;

      const icon = document.createElement("div");
      icon.className = "row-icon";
      icon.textContent = TYPE_ICONS[item.type || "login"] || "📦";

      const meta = document.createElement("div");
      meta.className = "row-meta";
      const title = document.createElement("div");
      title.className = "row-title";
      title.textContent = item.name || "Untitled";
      const sub = document.createElement("div");
      sub.className = "row-sub";
      sub.textContent = subtitleForItem(item);

      meta.appendChild(title);
      meta.appendChild(sub);
      row.appendChild(icon);
      row.appendChild(meta);
      row.addEventListener("click", () => selectItem(item));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectItem(item);
        }
      });
      itemsList.appendChild(row);
    });
  }

  function subtitleForItem(item: VaultItem): string {
    const type = item.type || "login";
    if (type === "card") return item.cardNumber ? `•••• ${item.cardNumber.slice(-4)}` : "Card";
    if (type === "note") return "Secure note";
    if (type === "identity") {
      return [item.identityFirstName, item.identityLastName].filter(Boolean).join(" ") || "Identity";
    }
    if (type === "alias") return item.aliasEmail || item.username || "Alias";
    return item.username || item.url || "";
  }

  async function triggerAutofill(item: VaultItem) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]?.id) {
        showToast("No active tab", "error");
        return;
      }
      await chrome.tabs.sendMessage(tabs[0].id, {
        type: "autofill-exec",
        username: item.username,
        password: item.password,
      });
      showToast("Autofill sent to page", "success");
      window.close();
    } catch {
      showToast("Autofill failed — reload the page and try again", "error");
    }
  }
});
