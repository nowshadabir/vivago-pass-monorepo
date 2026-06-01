// ============================================================
// Inject WebAuthn Bridge into Page Context (MUST RUN FIRST)
// ============================================================
// This allows navigator.credentials API to work with passkeys
(function injectWebAuthnBridge() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("webauthn-bridge.js");
  script.type = "text/javascript";
  script.onload = () => script.remove();
  (document.head || document.documentElement).prepend(script);
})();

// ============================================================
// Vivago Pass – Content Script
// Proton Pass-style field icons with dark-themed dropdown.
// ============================================================

import {
  scanAndClassifyForms,
  getFormContext,
  getFormType,
  getFormTypeLabel,
  shouldShowVivagoIcon,
  shouldSuggestGeneratedPassword,
  shouldShowVaultAutofill,
  getConfirmPasswordField,
  getDropdownTitle,
  getFieldRole,
  isVisible,
  type FormContext,
} from "./form-classifier";

let activeDropdown: HTMLDivElement | null = null;
let activeInput: HTMLInputElement | null = null;
const registeredInputs = new WeakSet<HTMLInputElement>();
const iconElements = new WeakMap<HTMLInputElement, HTMLDivElement>();
const LOGO_URL = chrome.runtime.getURL("logo.jpg");
let matchingItems: any[] = [];
let accountEmail = "";
let isAuthenticated = false;
let itemsFetched = false;
let lastSuggestedPassword = "";

function isEmailOrUsernameField(input: HTMLInputElement): boolean {
  const role = getFieldRole(input);
  if (role === "email" || role === "username") return true;
  const type = (input.type || "text").toLowerCase();
  return type === "email" || type === "username";
}

function shouldSuggestAccountEmail(input: HTMLInputElement): boolean {
  if (!accountEmail) return false;
  if (!isEmailOrUsernameField(input)) return false;
  const formType = getFormType(input);
  return formType === "login" || formType === "signup" || formType === "unknown";
}

/** Vault rows plus account email when there are no site-specific logins. */
function buildDropdownItems(input: HTMLInputElement, vaultItems: any[]): any[] {
  if (vaultItems.length > 0 || !shouldSuggestAccountEmail(input)) {
    return vaultItems;
  }
  return [
    {
      isAccountEmail: true,
      name: "Your Vivago account",
      username: accountEmail,
    },
  ];
}

function getSuggestionCount(input: HTMLInputElement): number {
  return buildDropdownItems(input, matchingItems).length;
}
let lastSuggestedFormId = "";

// ============================================================
// Utility: Safe chrome.runtime.sendMessage wrapper
// ============================================================
function safeSendMessage(msg: any): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Vivago] Extension context error:", chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(response);
        }
      });
    } catch (e) {
      console.warn("[Vivago] sendMessage error:", e);
      resolve(null);
    }
  });
}

// ============================================================
// Listen for autofill command from popup
// ============================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "autofill-exec") {
    const success = performAutofill(message.username, message.password);
    sendResponse({ success });
  }
});

// ============================================================
// Auth & Vault Item Fetching
// ============================================================
async function fetchMatchingItems(): Promise<any[]> {
  try {
    const authRes = await safeSendMessage({ type: "check-auth" });
    if (!authRes?.isAuthenticated) {
      isAuthenticated = false;
      accountEmail = "";
      return [];
    }
    isAuthenticated = true;
    accountEmail = (authRes.email || "").trim();

    const response = await safeSendMessage({
      type: "get-vault-items",
      domain: window.location.hostname,
    });

    if (response?.success && Array.isArray(response.items)) {
      matchingItems = response.items;
      itemsFetched = true;
      return response.items;
    }
  } catch (e) {
    console.warn("[Vivago] Failed to fetch vault items:", e);
  }
  return [];
}

// ============================================================
// Password generation
// ============================================================
function secureRandomInt(max: number): number {
  if (max <= 0) return 0;
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

function pickRandomChar(pool: string): string {
  return pool.charAt(secureRandomInt(pool.length));
}

function shuffleChars(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

function generateStrongPassword(length = 20): string {
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const pool = lowercase + uppercase + numbers + symbols;

  const chars: string[] = [
    pickRandomChar(lowercase),
    pickRandomChar(uppercase),
    pickRandomChar(numbers),
    pickRandomChar(symbols),
  ];

  for (let i = chars.length; i < length; i++) {
    chars.push(pickRandomChar(pool));
  }

  return shuffleChars(chars).join("");
}

function setInputValue(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillGeneratedPassword(input: HTMLInputElement, password: string) {
  setInputValue(input, password);
  const confirm = getConfirmPasswordField(input);
  if (confirm && confirm !== input) {
    setInputValue(confirm, password);
  }
  lastSuggestedPassword = password;
  lastPasswordVal = password;
  removeDropdown();
}

function positionDropdown(dropdown: HTMLDivElement, input: HTMLInputElement) {
  const rect = input.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;
  const dropdownWidth = 280;

  dropdown.style.position = "absolute";
  dropdown.style.zIndex = "2147483647";
  dropdown.style.top = `${rect.bottom + scrollY + 4}px`;
  dropdown.style.left = `${Math.max(8, rect.right + scrollX - dropdownWidth)}px`;
  dropdown.style.width = `${dropdownWidth}px`;
}

function openPasswordFieldMenu(input: HTMLInputElement) {
  activeInput = input;
  removeDropdown();

  if (shouldSuggestGeneratedPassword(input)) {
    showPasswordGeneratorDropdown(input);
    return;
  }

  if (shouldShowVaultAutofill(input)) {
    if ((input.type || "").toLowerCase() === "password") {
      fetchAndShowDropdownWithPasskeys(input, matchingItems);
    } else {
      showDropdown(input, buildDropdownItems(input, matchingItems));
    }
    return;
  }

  const formType = getFormType(input);
  if (formType === "login" || formType === "signup" || formType === "unknown") {
    showDropdown(input, buildDropdownItems(input, matchingItems));
  }
}

// ============================================================
// Icon Injection System
// ============================================================
function createIcon(count: number): HTMLDivElement {
  const icon = document.createElement("div");
  icon.className = "vivago-field-icon";
  icon.setAttribute("data-vivago", "true");
  icon.style.display = "none";

  const badgeHtml = count > 0 ? `<span class="vivago-icon-count">${count}</span>` : "";
  icon.innerHTML = `<img src="${LOGO_URL}" alt="" class="vivago-field-icon-img" />${badgeHtml}`;

  return icon;
}

function updateIconBadge(icon: HTMLDivElement, count: number) {
  const existingBadge = icon.querySelector(".vivago-icon-count");
  if (count > 0) {
    if (existingBadge) {
      existingBadge.textContent = String(count);
    } else {
      const badge = document.createElement("span");
      badge.className = "vivago-icon-count";
      badge.textContent = String(count);
      icon.appendChild(badge);
    }
  } else if (existingBadge) {
    existingBadge.remove();
  }
}

function hideAllFieldIcons() {
  document.querySelectorAll(".vivago-field-icon").forEach((el) => {
    (el as HTMLElement).style.display = "none";
  });
}

function attachIconListeners(icon: HTMLDivElement, input: HTMLInputElement) {
  icon.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  icon.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (activeDropdown && activeInput === input) {
      removeDropdown();
    } else {
      openPasswordFieldMenu(input);
    }
  });
}

function showIconForInput(input: HTMLInputElement) {
  hideAllFieldIcons();

  let icon = iconElements.get(input);
  if (!icon) {
    icon = createIcon(getSuggestionCount(input));
    iconElements.set(input, icon);
    attachIconListeners(icon, input);
    document.body.appendChild(icon);
  } else {
    updateIconBadge(icon, getSuggestionCount(input));
  }

  if (document.body.contains(input) && isVisible(input)) {
    positionIcon(icon, input);
    icon.style.display = "";
  }
}

function hideIconForInput(input: HTMLInputElement) {
  const icon = iconElements.get(input);
  if (icon) icon.style.display = "none";
}

function positionIcon(icon: HTMLDivElement, input: HTMLInputElement) {
  const rect = input.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;

  const iconSize = 22;
  icon.style.top = `${rect.top + scrollY + (rect.height - iconSize) / 2}px`;
  icon.style.left = `${rect.right + scrollX - iconSize - 6}px`;
}

function registerInput(input: HTMLInputElement) {
  if (registeredInputs.has(input)) return;
  registeredInputs.add(input);

  input.addEventListener("focus", () => {
    if (!isAuthenticated) return;
    showIconForInput(input);

    const ctx = getFormContext(input);
    if (ctx && ctx.id !== lastSuggestedFormId) {
      lastSuggestedPassword = "";
      lastSuggestedFormId = ctx.id;
    }

    if (shouldSuggestGeneratedPassword(input)) {
      activeInput = input;
      showPasswordGeneratorDropdown(input);
      return;
    }
    if (
      shouldShowVaultAutofill(input) &&
      shouldSuggestAccountEmail(input) &&
      matchingItems.length === 0
    ) {
      activeInput = input;
      showDropdown(input, buildDropdownItems(input, matchingItems));
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (document.activeElement === input) return;
      if (activeDropdown && activeInput === input) return;
      hideIconForInput(input);
    }, 120);
  });

  if (document.activeElement === input) {
    showIconForInput(input);
  }
}

function updateAllIconCounts() {
  const allInputs = document.querySelectorAll("input");
  allInputs.forEach((el) => {
    const input = el as HTMLInputElement;
    const icon = iconElements.get(input);
    if (!icon) return;
    updateIconBadge(icon, getSuggestionCount(input));
  });
}

function repositionAllIcons() {
  const allInputs = document.querySelectorAll("input");
  allInputs.forEach((el) => {
    const input = el as HTMLInputElement;
    const icon = iconElements.get(input);
    if (!icon) return;

    if (icon.style.display === "none") return;

    if (document.body.contains(input) && isVisible(input)) {
      positionIcon(icon, input);
    } else {
      icon.style.display = "none";
    }
  });
}

function cleanupOrphanedIcons() {
  const allInputs = document.querySelectorAll("input");
  const liveInputs = new Set(allInputs);
  // The WeakMap handles GC automatically, but we need to remove DOM elements
  // for inputs that have been removed from the page
  document.querySelectorAll(".vivago-field-icon").forEach((iconEl) => {
    // Check if this icon's input is still in the DOM by seeing if any input maps to it
    let isOrphaned = true;
    liveInputs.forEach((input) => {
      if (iconElements.get(input as HTMLInputElement) === iconEl) {
        isOrphaned = false;
      }
    });
    if (isOrphaned) {
      iconEl.remove();
    }
  });
}

// ============================================================
// Strong Password Suggestion (new-password fields)
// ============================================================
function showPasswordGeneratorDropdown(input: HTMLInputElement) {
  injectStyles();
  removeDropdown();

  if (!lastSuggestedPassword) {
    lastSuggestedPassword = generateStrongPassword(20);
  }
  const password = lastSuggestedPassword;

  const dropdown = document.createElement("div");
  dropdown.className = "vivago-suggestions-dropdown vivago-generator-dropdown";
  dropdown.setAttribute("data-vivago", "true");

  const header = document.createElement("div");
  header.className = "vivago-dropdown-header";

  const headerText = document.createElement("span");
  headerText.className = "vivago-dropdown-header-text";
  headerText.textContent = "Password";

  const headerLogo = document.createElement("div");
  headerLogo.className = "vivago-dropdown-logo";
  headerLogo.innerHTML = `<img src="${LOGO_URL}" alt="" class="vivago-dropdown-logo-img" />`;

  header.appendChild(headerText);
  header.appendChild(headerLogo);
  dropdown.appendChild(header);

  const row = document.createElement("div");
  row.className = "vivago-dropdown-row vivago-generator-row";

  const badge = document.createElement("div");
  badge.className = "vivago-row-badge vivago-generator-badge";
  badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/></svg>`;

  const info = document.createElement("div");
  info.className = "vivago-row-info";

  const label = document.createElement("div");
  label.className = "vivago-row-name";
  label.textContent = "Fill password";

  const preview = document.createElement("div");
  preview.className = "vivago-row-user vivago-generator-password";
  preview.textContent = password;

  info.appendChild(label);
  info.appendChild(preview);
  row.appendChild(badge);
  row.appendChild(info);

  row.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fillGeneratedPassword(input, password);
  });

  const regenRow = document.createElement("div");
  regenRow.className = "vivago-dropdown-row vivago-generator-regen-row";

  const regenLabel = document.createElement("span");
  regenLabel.className = "vivago-generator-regen";
  regenLabel.textContent = "↻ Generate another";
  regenRow.appendChild(regenLabel);

  regenRow.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    lastSuggestedPassword = generateStrongPassword(20);
    showPasswordGeneratorDropdown(input);
  });

  dropdown.appendChild(row);
  dropdown.appendChild(regenRow);

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
  activeInput = input;
  positionDropdown(dropdown, input);
}

// ============================================================
// Passkey-Enhanced Dropdown
// ============================================================
async function fetchAndShowDropdownWithPasskeys(input: HTMLInputElement, items: any[]) {
  try {
    // Fetch passkeys for current domain
    const response = await chrome.runtime.sendMessage({
      type: "get-passkeys",
      domain: window.location.hostname
    });

    const passkeys = response?.passkeys || [];
    const passkeyItems = passkeys.map((pk: any) => ({
      ...pk,
      isPasskey: true,
      icon: "🔑"
    }));

    // Combine vault items and passkeys
    const allItems = [...items, ...passkeyItems];
    showDropdown(input, allItems.length > 0 ? allItems : buildDropdownItems(input, items));
  } catch (err) {
    console.error("[Vivago] Error fetching passkeys:", err);
    showDropdown(input, buildDropdownItems(input, items));
  }
}

// ============================================================
// Dark-themed Dropdown (Proton Pass style)
// ============================================================
function showDropdown(input: HTMLInputElement, items: any[]) {
  injectStyles();

  const dropdown = document.createElement("div");
  dropdown.className = "vivago-suggestions-dropdown";

  // === Header ===
  const header = document.createElement("div");
  header.className = "vivago-dropdown-header";

  const headerText = document.createElement("span");
  headerText.className = "vivago-dropdown-header-text";
  const formCtx = getFormContext(input);
  headerText.textContent = getDropdownTitle(input);
  if (formCtx && formCtx.type !== "unknown") {
    headerText.title = `${getFormTypeLabel(formCtx.type)} form`;
  }

  const headerLogo = document.createElement("div");
  headerLogo.className = "vivago-dropdown-logo";
  headerLogo.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/></svg>`;

  header.appendChild(headerText);
  header.appendChild(headerLogo);
  dropdown.appendChild(header);

  const listBody = document.createElement("div");
  listBody.className = "vivago-dropdown-scroll";

  // === Items ===
  if (items.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "vivago-dropdown-row vivago-dropdown-empty";

    const badge = document.createElement("div");
    badge.className = "vivago-row-badge";
    badge.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 1.5 1.5M15.5 7.5 14 6"/></svg>`;

    const info = document.createElement("div");
    info.className = "vivago-row-info";

    const name = document.createElement("div");
    name.className = "vivago-row-name";
    name.textContent = "No logins found";

    const sub = document.createElement("div");
    sub.className = "vivago-row-user";
    sub.textContent = "for " + window.location.hostname;

    info.appendChild(name);
    info.appendChild(sub);
    emptyRow.appendChild(badge);
    emptyRow.appendChild(info);
    listBody.appendChild(emptyRow);
  } else {
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "vivago-dropdown-row";

      const badge = document.createElement("div");
      badge.className = "vivago-row-badge";
      
      if (item.isPasskey) {
        badge.textContent = "🔑";
        badge.style.fontSize = "14px";
        badge.style.display = "flex";
        badge.style.alignItems = "center";
        badge.style.justifyContent = "center";
      } else if (item.isAccountEmail) {
        badge.className = "vivago-row-badge vivago-account-badge";
        badge.textContent = (item.username || "V").charAt(0).toUpperCase();
      } else {
        badge.textContent = (item.name || "V").charAt(0).toUpperCase();
      }

      const info = document.createElement("div");
      info.className = "vivago-row-info";

      const name = document.createElement("div");
      name.className = "vivago-row-name";
      name.textContent = item.name || (item.isPasskey ? "Passkey" : "Untitled");

      const user = document.createElement("div");
      user.className = "vivago-row-user";
      user.textContent = item.isPasskey
        ? (item.domain || window.location.hostname)
        : item.isAccountEmail
          ? "Account email"
          : (item.username || "");

      info.appendChild(name);
      info.appendChild(user);
      row.appendChild(badge);
      row.appendChild(info);

      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (item.isPasskey) {
          handlePasskeyAuthentication(item, activeInput!);
        } else if (item.isAccountEmail) {
          fillAccountEmail(item.username);
        } else {
          performAutofill(item.username, item.password);
        }
        removeDropdown();
      });

      listBody.appendChild(row);
    });
  }

  dropdown.appendChild(listBody);
  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
  positionDropdown(dropdown, input);
}

function removeDropdown() {
  if (activeDropdown) {
    const dd = activeDropdown;
    activeDropdown = null;
    dd.style.animation = "vivago-dropdown-out 0.15s cubic-bezier(0.4, 0, 1, 1) forwards";
    dd.addEventListener("animationend", () => dd.remove(), { once: true });
    // Fallback removal in case animationend doesn't fire
    setTimeout(() => { if (dd.parentNode) dd.remove(); }, 200);
  }
}

// ============================================================
// Autofill Logic
// ============================================================
function findAutofillFormContext(): FormContext | null {
  if (activeInput) {
    const activeCtx = getFormContext(activeInput);
    if (activeCtx) return activeCtx;
  }
  scanAndClassifyForms();
  for (const el of document.querySelectorAll('input[type="password"]')) {
    const input = el as HTMLInputElement;
    if (!isVisible(input)) continue;
    const ctx = getFormContext(input);
    if (ctx && (ctx.type === "login" || ctx.type === "unknown")) return ctx;
  }
  return null;
}

function fillAccountEmail(email: string): boolean {
  if (activeInput && isEmailOrUsernameField(activeInput)) {
    setInputValue(activeInput, email);
    return true;
  }

  const ctx = findAutofillFormContext();
  if (ctx?.usernameField) {
    setInputValue(ctx.usernameField, email);
    return true;
  }

  const inputs = Array.from(document.querySelectorAll("input")).filter(isVisible) as HTMLInputElement[];
  const emailInput = inputs.find((inp) => isEmailOrUsernameField(inp));
  if (emailInput) {
    setInputValue(emailInput, email);
    return true;
  }

  return false;
}

function performAutofill(username: string, password: string): boolean {
  let filled = false;
  const ctx = findAutofillFormContext();

  if (ctx) {
    if (ctx.usernameField) {
      setInputValue(ctx.usernameField, username);
      filled = true;
    }
    const pwTarget =
      ctx.currentPasswordField ||
      ctx.fields.find((f) => f.role === "password")?.input ||
      ctx.fields.find((f) => (f.input.type || "").toLowerCase() === "password")?.input;
    if (pwTarget) {
      setInputValue(pwTarget, password);
      pwTarget.dispatchEvent(new Event("blur", { bubbles: true }));
      filled = true;
    }
  } else {
    const inputs = Array.from(document.querySelectorAll("input"));
    const passwordInputs = inputs.filter(
      (input) => input.type === "password" && isVisible(input)
    );

    if (passwordInputs.length > 0) {
      for (const passwordInput of passwordInputs) {
        setInputValue(passwordInput, password);
        passwordInput.dispatchEvent(new Event("blur", { bubbles: true }));
        filled = true;

        const precedingInputs = inputs.slice(0, inputs.indexOf(passwordInput)).reverse();
        const usernameInput = precedingInputs.find(
          (inp) =>
            (inp.type === "text" || inp.type === "email" || inp.type === "username") &&
            isVisible(inp)
        );

        if (usernameInput) {
          setInputValue(usernameInput, username);
        } else if (activeInput && activeInput.type !== "password") {
          setInputValue(activeInput, username);
        }
      }
    } else if (activeInput && activeInput.type !== "password") {
      setInputValue(activeInput, username);
      filled = true;
    }
  }

  return filled;
}

// ============================================================
// Style Injection
// ============================================================
function injectStyles() {
  const id = "vivago-injected-styles";
  if (document.getElementById(id)) return;

  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    /* ========== Field Icon ========== */
    .vivago-field-icon {
      position: absolute !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      background: #fff !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      z-index: 2147483646 !important;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.18) !important;
      transition: transform 0.15s ease, box-shadow 0.15s ease !important;
      pointer-events: auto !important;
      box-sizing: border-box !important;
      padding: 0 !important;
      margin: 0 !important;
      line-height: 1 !important;
      overflow: hidden !important;
    }

    .vivago-field-icon:hover {
      transform: scale(1.12) !important;
      box-shadow: 0 3px 12px rgba(15, 23, 42, 0.28) !important;
    }

    .vivago-field-icon-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      display: block !important;
      border-radius: 50% !important;
      flex-shrink: 0 !important;
    }

    .vivago-icon-count {
      position: absolute !important;
      top: -5px !important;
      right: -5px !important;
      background: linear-gradient(135deg, #22c55e, #16a34a) !important;
      color: #fff !important;
      font-size: 8px !important;
      font-weight: 800 !important;
      width: 14px !important;
      height: 14px !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25) !important;
      line-height: 1 !important;
      border: 1.5px solid #fff !important;
      box-sizing: border-box !important;
    }

    /* ========== Dark Dropdown ========== */
    .vivago-suggestions-dropdown {
      background: #1a1a2e !important;
      border: 1px solid rgba(255, 255, 255, 0.07) !important;
      border-radius: 12px !important;
      box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.5),
                  0 0 0 1px rgba(255, 255, 255, 0.04),
                  0 0 30px -8px rgba(99, 102, 241, 0.12) !important;
      padding: 0 !important;
      display: flex !important;
      flex-direction: column !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      box-sizing: border-box !important;
      overflow: hidden !important;
      animation: vivago-dropdown-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
      transform-origin: top right !important;
    }

    .vivago-dropdown-scroll {
      max-height: 260px !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      overscroll-behavior: contain !important;
      scrollbar-width: thin !important;
      scrollbar-color: rgba(165, 180, 252, 0.45) transparent !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar {
      width: 6px !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar-track {
      background: transparent !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar-thumb {
      background: rgba(165, 180, 252, 0.4) !important;
      border-radius: 999px !important;
    }

    .vivago-dropdown-scroll::-webkit-scrollbar-thumb:hover {
      background: rgba(199, 210, 254, 0.55) !important;
    }

    @keyframes vivago-dropdown-in {
      from { opacity: 0; transform: translateY(-6px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes vivago-dropdown-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to { opacity: 0; transform: translateY(-4px) scale(0.97); }
    }

    .vivago-dropdown-header {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      padding: 10px 12px 8px 12px !important;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
    }

    .vivago-dropdown-header-text {
      font-size: 12px !important;
      font-weight: 700 !important;
      color: rgba(255, 255, 255, 0.8) !important;
      letter-spacing: 0.1px !important;
    }

    .vivago-dropdown-logo {
      width: 22px !important;
      height: 22px !important;
      background: #fff !important;
      border-radius: 6px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 2px 6px rgba(15, 23, 42, 0.15) !important;
      overflow: hidden !important;
    }

    .vivago-dropdown-logo-img {
      width: 100% !important;
      height: 100% !important;
      object-fit: cover !important;
      display: block !important;
    }

    .vivago-generator-row {
      padding: 10px 12px !important;
    }

    .vivago-generator-badge {
      color: #a78bfa !important;
    }

    .vivago-generator-password {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
      font-size: 11px !important;
      color: #c4b5fd !important;
      letter-spacing: 0.02em !important;
      word-break: break-all !important;
      white-space: normal !important;
      line-height: 1.35 !important;
    }

    .vivago-generator-regen-row {
      border-top: 1px solid rgba(255, 255, 255, 0.06) !important;
      justify-content: center !important;
      padding: 7px 12px !important;
    }

    .vivago-generator-regen-row:hover {
      background-color: rgba(255, 255, 255, 0.04) !important;
    }

    .vivago-generator-regen {
      font-size: 11px !important;
      font-weight: 600 !important;
      color: #94a3b8 !important;
      cursor: pointer !important;
    }

    .vivago-generator-regen-row:hover .vivago-generator-regen {
      color: #c4b5fd !important;
    }

    .vivago-dropdown-row {
      display: flex !important;
      align-items: center !important;
      gap: 9px !important;
      padding: 8px 12px !important;
      cursor: pointer !important;
      transition: background-color 0.15s ease, transform 0.1s ease !important;
    }

    .vivago-dropdown-row:hover {
      background-color: rgba(255, 255, 255, 0.05) !important;
    }

    .vivago-dropdown-row:active {
      background-color: rgba(255, 255, 255, 0.08) !important;
    }

    .vivago-dropdown-row:last-child {
      border-radius: 0 0 12px 12px !important;
    }

    .vivago-dropdown-empty {
      cursor: default !important;
      opacity: 0.55 !important;
    }

    .vivago-dropdown-empty:hover {
      background-color: transparent !important;
    }

    .vivago-row-badge {
      background: rgba(139, 92, 246, 0.15) !important;
      color: #a78bfa !important;
      border-radius: 8px !important;
      width: 30px !important;
      height: 30px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-weight: 800 !important;
      font-size: 12px !important;
      flex-shrink: 0 !important;
      border: 1px solid rgba(139, 92, 246, 0.1) !important;
    }

    .vivago-row-info {
      display: flex !important;
      flex-direction: column !important;
      gap: 2px !important;
      overflow: hidden !important;
      flex: 1 !important;
    }

    .vivago-row-name {
      font-size: 12px !important;
      font-weight: 600 !important;
      color: #e2e8f0 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .vivago-account-badge {
      background: rgba(99, 102, 241, 0.2) !important;
      color: #c7d2fe !important;
      border-color: rgba(99, 102, 241, 0.25) !important;
    }

    .vivago-row-user {
      font-size: 10.5px !important;
      color: #94a3b8 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    /* ========== Save/Update Banner (light theme) ========== */
    .vivago-save-banner {
      position: fixed !important;
      top: 16px !important;
      right: 16px !important;
      z-index: 2147483647 !important;
      background-color: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 20px 40px -8px rgba(0, 0, 0, 0.12), 0 8px 16px -4px rgba(0, 0, 0, 0.06) !important;
      border-radius: 16px !important;
      width: 360px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      overflow: hidden !important;
      animation: vivago-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }

    @keyframes vivago-slide-in {
      from { opacity: 0; transform: translateY(-12px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .vivago-banner-header {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      padding: 14px 16px 10px 16px !important;
      border-bottom: 1px solid #f1f5f9 !important;
    }

    .vivago-banner-logo {
      background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
      border-radius: 8px !important;
      width: 28px !important;
      height: 28px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-size: 14px !important;
      flex-shrink: 0 !important;
      box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3) !important;
    }

    .vivago-banner-title {
      font-size: 14px !important;
      font-weight: 700 !important;
      color: #1e293b !important;
      flex: 1 !important;
    }

    .vivago-banner-close {
      background: none !important;
      border: none !important;
      width: 28px !important;
      height: 28px !important;
      border-radius: 8px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      color: #94a3b8 !important;
      font-size: 16px !important;
      transition: all 0.15s ease !important;
      flex-shrink: 0 !important;
    }

    .vivago-banner-close:hover {
      background-color: #f1f5f9 !important;
      color: #475569 !important;
    }

    .vivago-banner-body {
      padding: 12px 16px !important;
    }

    .vivago-banner-credential {
      display: flex !important;
      align-items: center !important;
      gap: 12px !important;
      padding: 10px 12px !important;
      background-color: #f8fafc !important;
      border: 1px solid #f1f5f9 !important;
      border-radius: 12px !important;
    }

    .vivago-banner-avatar {
      width: 36px !important;
      height: 36px !important;
      border-radius: 50% !important;
      background: linear-gradient(135deg, #e0e7ff, #c7d2fe) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      flex-shrink: 0 !important;
      color: #6366f1 !important;
      font-weight: 800 !important;
      font-size: 14px !important;
    }

    .vivago-banner-cred-info {
      display: flex !important;
      flex-direction: column !important;
      gap: 1px !important;
      overflow: hidden !important;
      flex: 1 !important;
    }

    .vivago-banner-hostname {
      font-size: 13px !important;
      font-weight: 700 !important;
      color: #1e293b !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .vivago-banner-email {
      font-size: 11.5px !important;
      color: #64748b !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    .vivago-banner-actions {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-end !important;
      gap: 6px !important;
      padding: 10px 16px 14px 16px !important;
    }

    .vivago-banner-btn-primary {
      background: linear-gradient(135deg, #6366f1, #7c3aed) !important;
      color: #ffffff !important;
      border: none !important;
      border-radius: 10px !important;
      padding: 9px 18px !important;
      font-size: 12.5px !important;
      font-weight: 700 !important;
      cursor: pointer !important;
      transition: all 0.2s ease !important;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25) !important;
    }

    .vivago-banner-btn-primary:hover {
      background: linear-gradient(135deg, #4f46e5, #6d28d9) !important;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35) !important;
      transform: translateY(-1px) !important;
    }

    .vivago-banner-btn-primary:disabled {
      opacity: 0.7 !important;
      cursor: not-allowed !important;
      transform: none !important;
    }

    .vivago-banner-btn-secondary {
      background: transparent !important;
      color: #6366f1 !important;
      border: none !important;
      border-radius: 10px !important;
      padding: 9px 14px !important;
      font-size: 12.5px !important;
      font-weight: 600 !important;
      cursor: pointer !important;
      transition: all 0.15s ease !important;
    }

    .vivago-banner-btn-secondary:hover {
      background-color: #f1f5f9 !important;
      color: #4f46e5 !important;
    }

    /* Success state */
    .vivago-banner-success .vivago-banner-credential {
      background-color: #f0fdf4 !important;
      border-color: #bbf7d0 !important;
    }

    .vivago-banner-success .vivago-banner-avatar {
      background: linear-gradient(135deg, #dcfce7, #bbf7d0) !important;
      color: #16a34a !important;
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// Scan & Initialize
// ============================================================
function scanInputs() {
  if (!isAuthenticated) return;

  scanAndClassifyForms();

  const allInputs = document.querySelectorAll("input");
  allInputs.forEach((el) => {
    const input = el as HTMLInputElement;
    if (registeredInputs.has(input)) return;
    if (!isVisible(input)) return;
    if (!shouldShowVivagoIcon(input)) return;
    registerInput(input);
  });
}

async function initialize() {
  injectStyles();

  // Fetch auth state + matching items
  await fetchMatchingItems();

  if (!isAuthenticated) return;

  // Scan for inputs
  scanInputs();

  // Watch for new inputs (SPAs, dynamic pages)
  const observer = new MutationObserver(() => {
    requestAnimationFrame(() => {
      scanAndClassifyForms();
      scanInputs();
      cleanupOrphanedIcons();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

// ============================================================
// Global Event Handlers
// ============================================================

// Reposition icons on scroll/resize, close dropdown
window.addEventListener("scroll", () => {
  repositionAllIcons();
  removeDropdown();
}, true);

window.addEventListener("resize", () => {
  repositionAllIcons();
  removeDropdown();
});

// Close dropdown when clicking outside
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (
    activeDropdown &&
    !activeDropdown.contains(target) &&
    !target.closest(".vivago-field-icon") &&
    !(activeInput && activeInput.contains(target))
  ) {
    removeDropdown();
  }
});

// Start initialization
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, 300));
} else {
  setTimeout(initialize, 300);
}

// ============================================================
// Form Capture & Save Banner
// ============================================================

// Track input changes to capture values before submission
let lastUsernameVal = "";
let lastPasswordVal = "";

document.addEventListener("input", (e) => {
  const target = e.target as HTMLInputElement;
  if (target instanceof HTMLInputElement) {
    if (target.type === "password") {
      lastPasswordVal = target.value;
    } else if (target.type === "text" || target.type === "email" || target.type === "username") {
      lastUsernameVal = target.value;
    }
  }
});

// Capture Form submission
document.addEventListener("submit", (e) => {
  captureAndProcessForm();
});

// Capture Submit button click as fallback for AJAX forms
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  const isSubmitBtn = target.closest("button[type='submit'], input[type='submit']") || 
                      (target.closest("button") && /sign|log|next|submit|enter/i.test(target.textContent || ""));
  if (isSubmitBtn) {
    // Delay slightly to let input listeners update value
    setTimeout(captureAndProcessForm, 50);
  }
});

async function captureAndProcessForm() {
  if (!lastUsernameVal || !lastPasswordVal) return;

  const username = lastUsernameVal.trim();
  const password = lastPasswordVal;
  const hostname = window.location.hostname;
  const url = window.location.href;

  try {
    // Verify auth status using safe wrapper
    const authRes = await safeSendMessage({ type: "check-auth" });
    if (!authRes?.isAuthenticated) return;

    // Fetch existing vault items for this domain
    const response = await safeSendMessage({
      type: "get-vault-items",
      domain: hostname
    });

    let existingItemId: string | null = null;
    let isUpdate = false;

    if (response?.success && response.items && response.items.length > 0) {
      // Check if this exact credential (same username + same password) already exists
      const exactMatch = response.items.find(
        (item: any) =>
          item.type === "login" &&
          (item.username || "").toLowerCase() === username.toLowerCase() &&
          item.password === password
      );
      if (exactMatch) return; // Already saved, no need to prompt

      // Check if same username exists but with a different password (update case)
      const sameUserMatch = response.items.find(
        (item: any) =>
          item.type === "login" &&
          (item.username || "").toLowerCase() === username.toLowerCase()
      );
      if (sameUserMatch) {
        existingItemId = sameUserMatch.id;
        isUpdate = true;
      }
    }

    showSavePromptBanner(hostname, url, username, password, isUpdate, existingItemId);
  } catch (err) {
    console.error("Failed to process form credentials:", err);
  }
}

function showSavePromptBanner(
  hostname: string,
  url: string,
  username: string,
  password: string,
  isUpdate: boolean = false,
  existingItemId: string | null = null
) {
  const bannerId = "vivago-save-password-banner";
  if (document.getElementById(bannerId)) return;

  injectStyles();

  const banner = document.createElement("div");
  banner.id = bannerId;
  banner.className = "vivago-save-banner";

  // === Header ===
  const header = document.createElement("div");
  header.className = "vivago-banner-header";

  const logoBadge = document.createElement("div");
  logoBadge.className = "vivago-banner-logo";
  logoBadge.textContent = "🔑";

  const title = document.createElement("div");
  title.className = "vivago-banner-title";
  title.textContent = isUpdate ? "Update login" : "Save login";

  const closeBtn = document.createElement("button");
  closeBtn.className = "vivago-banner-close";
  closeBtn.innerHTML = "✕";
  closeBtn.addEventListener("click", () => banner.remove());

  header.appendChild(logoBadge);
  header.appendChild(title);
  header.appendChild(closeBtn);

  // === Body (credential row) ===
  const body = document.createElement("div");
  body.className = "vivago-banner-body";

  const credRow = document.createElement("div");
  credRow.className = "vivago-banner-credential";

  const avatar = document.createElement("div");
  avatar.className = "vivago-banner-avatar";
  avatar.textContent = (username || "U").charAt(0).toUpperCase();

  const credInfo = document.createElement("div");
  credInfo.className = "vivago-banner-cred-info";

  const hostnameEl = document.createElement("div");
  hostnameEl.className = "vivago-banner-hostname";
  hostnameEl.textContent = hostname;

  const emailEl = document.createElement("div");
  emailEl.className = "vivago-banner-email";
  emailEl.textContent = username;

  credInfo.appendChild(hostnameEl);
  credInfo.appendChild(emailEl);
  credRow.appendChild(avatar);
  credRow.appendChild(credInfo);
  body.appendChild(credRow);

  // === Footer (actions) ===
  const actions = document.createElement("div");
  actions.className = "vivago-banner-actions";

  const secondaryBtn = document.createElement("button");
  secondaryBtn.className = "vivago-banner-btn-secondary";
  secondaryBtn.textContent = isUpdate ? "Create new login" : "Never";
  secondaryBtn.addEventListener("click", () => {
    if (isUpdate) {
      // Create as new item instead of updating
      performSave(banner, title, hostnameEl, emailEl, actions, hostname, url, username, password, false, null);
    } else {
      banner.remove();
    }
  });

  const primaryBtn = document.createElement("button");
  primaryBtn.className = "vivago-banner-btn-primary";
  primaryBtn.textContent = isUpdate ? "Update this login" : "Save";
  primaryBtn.addEventListener("click", () => {
    performSave(banner, title, hostnameEl, emailEl, actions, hostname, url, username, password, isUpdate, existingItemId);
  });

  actions.appendChild(secondaryBtn);
  actions.appendChild(primaryBtn);

  // Assemble
  banner.appendChild(header);
  banner.appendChild(body);
  banner.appendChild(actions);
  document.body.appendChild(banner);
}

async function performSave(
  banner: HTMLElement,
  titleEl: HTMLElement,
  hostnameEl: HTMLElement,
  emailEl: HTMLElement,
  actionsEl: HTMLElement,
  hostname: string,
  url: string,
  username: string,
  password: string,
  isUpdate: boolean,
  existingItemId: string | null
) {
  const primaryBtn = actionsEl.querySelector(".vivago-banner-btn-primary") as HTMLButtonElement;
  if (primaryBtn) {
    primaryBtn.disabled = true;
    primaryBtn.textContent = isUpdate ? "Updating..." : "Saving...";
  }

  const itemToSave = {
    id: isUpdate && existingItemId ? existingItemId : "itm_" + Math.random().toString(36).substr(2, 9),
    name: hostname,
    type: "login",
    username: username,
    password: password,
    url: url,
    notes: isUpdate
      ? "Password updated by Vivago Pass browser extension"
      : "Auto-saved by Vivago Pass browser extension"
  };

  try {
    const response = await safeSendMessage({
      type: "save-vault-item",
      item: itemToSave
    });

    if (response?.success) {
      banner.classList.add("vivago-banner-success");
      titleEl.textContent = isUpdate ? "Password updated!" : "Saved successfully!";
      hostnameEl.textContent = "Credentials are secure in your vault.";
      emailEl.textContent = "";
      actionsEl.style.display = "none";
      setTimeout(() => banner.remove(), 2500);
    } else {
      alert("Failed to save to vault: " + (response?.error || "Unknown error"));
      if (primaryBtn) {
        primaryBtn.disabled = false;
        primaryBtn.textContent = isUpdate ? "Update this login" : "Save";
      }
    }
  } catch (err: any) {
    alert("Error: " + err.message);
    if (primaryBtn) {
      primaryBtn.disabled = false;
      primaryBtn.textContent = isUpdate ? "Update this login" : "Save";
    }
  }
}

// ============================================================
// WebAuthn Passkey Detection & Handling
// ============================================================

// Listen for passkey creation/authentication events from the bridge
window.addEventListener("message", async (event) => {
  // Only accept messages from our own origin
  if (event.source !== window) return;

  if (event.data.type === "VIVAGO_PASSKEY_CREATED") {
    console.log("[Vivago] Passkey created - saving to vault");
    try {
      const credential = event.data.credential;
      const domain = window.location.hostname;
      
      // Send to background to save
      const response = await chrome.runtime.sendMessage({
        type: "save-passkey",
        passkey: credential,
        domain: domain
      });

      if (response?.success) {
        console.log("[Vivago] Passkey saved successfully:", response.message);
      } else {
        console.error("[Vivago] Failed to save passkey:", response?.error);
      }
    } catch (err: any) {
      console.error("[Vivago] Error saving passkey:", err.message);
    }
  }

  if (event.data.type === "VIVAGO_PASSKEY_RETRIEVED") {
    console.log("[Vivago] Passkey retrieved - authentication successful");
  }
});

// Handle passkey authentication when user clicks on a passkey in the dropdown
async function handlePasskeyAuthentication(passkey: any, passwordInput: HTMLInputElement) {
  try {
    console.log("[Vivago] Initiating passkey authentication");
    
    // For now, just show a message that passkey auth is being initiated
    // The actual WebAuthn flow will be handled by the page's navigator.credentials.get()
    alert(`Passkey authentication initiated for: ${passkey.name}\n\nBrowser will prompt you to authenticate.`);
    
    // Notify background that authentication was initiated
    await chrome.runtime.sendMessage({
      type: "authenticate-passkey",
      passkeyId: passkey.id || passkey.credentialId,
      domain: window.location.hostname
    });
  } catch (err: any) {
    console.error("[Vivago] Passkey authentication error:", err.message);
  }
}

// Add passkey login support to icon dropdown
function enhanceDropdownWithPasskey(input: HTMLInputElement) {
  if (input.type !== "password") return;

  // When dropdown is shown for password field, add passkey option
  const originalShowDropdown = showDropdown;
  
  // We'll handle this in the icon click handler
}
