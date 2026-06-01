// ============================================================
// Form-level classification for Vivago Pass content script
// Classifies forms (login, signup, etc.) and assigns field roles
// ============================================================

export type FormType =
  | "login"
  | "signup"
  | "change-password"
  | "reset-password"
  | "identity"
  | "payment"
  | "otp"
  | "unknown";

export type FieldRole =
  | "username"
  | "email"
  | "current-password"
  | "new-password"
  | "confirm-password"
  | "password"
  | "phone"
  | "otp"
  | "name"
  | "first-name"
  | "last-name"
  | "address"
  | "organization"
  | "card-number"
  | "card-expiry"
  | "card-cvc"
  | "generic"
  | "ignored";

export interface ClassifiedField {
  input: HTMLInputElement;
  role: FieldRole;
}

export interface FormContext {
  id: string;
  root: HTMLElement;
  type: FormType;
  fields: ClassifiedField[];
  usernameField: HTMLInputElement | null;
  currentPasswordField: HTMLInputElement | null;
  newPasswordField: HTMLInputElement | null;
  confirmPasswordField: HTMLInputElement | null;
}

const inputToForm = new WeakMap<HTMLInputElement, FormContext>();
const inputToRole = new WeakMap<HTMLInputElement, FieldRole>();
const formRegistry = new Map<string, FormContext>();

let formIdCounter = 0;

const CREDENTIAL_FORM_TYPES: FormType[] = [
  "login",
  "signup",
  "change-password",
  "reset-password",
];

const VAULT_ROLES: FieldRole[] = ["username", "email", "current-password", "password"];
const GENERATOR_ROLES: FieldRole[] = ["new-password", "confirm-password"];

// ============================================================
// DOM helpers
// ============================================================

export function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    window.getComputedStyle(el).display !== "none" &&
    window.getComputedStyle(el).visibility !== "hidden"
  );
}

export function getLabelText(input: HTMLInputElement): string {
  if (input.id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label?.textContent) return label.textContent.trim();
    } catch {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label?.textContent) return label.textContent.trim();
    }
  }
  const wrapped = input.closest("label");
  if (wrapped?.textContent) return wrapped.textContent.trim();
  const prev = input.previousElementSibling;
  if (prev?.tagName === "LABEL" && prev.textContent) return prev.textContent.trim();
  return "";
}

export function getInputHints(input: HTMLInputElement): string {
  return [
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute("aria-label") || "",
    getLabelText(input),
  ]
    .join(" ")
    .toLowerCase();
}

function getContainerText(root: HTMLElement): string {
  const heading = root.querySelector("h1, h2, h3, legend, [role='heading']");
  const headingText = heading?.textContent?.trim() || "";
  const buttons = Array.from(root.querySelectorAll("button, input[type='submit']"))
    .map((el) => (el as HTMLButtonElement).textContent || (el as HTMLInputElement).value || "")
    .join(" ");
  return `${headingText} ${buttons} ${root.getAttribute("aria-label") || ""}`.toLowerCase();
}

function getPageContextText(): string {
  return `${window.location.pathname}${window.location.search}${document.title}`.toLowerCase();
}

function getVisibleInputsIn(root: ParentNode): HTMLInputElement[] {
  return Array.from(root.querySelectorAll("input")).filter((el) =>
    isVisible(el as HTMLElement)
  ) as HTMLInputElement[];
}

function isIgnoredInputType(input: HTMLInputElement): boolean {
  const type = (input.type || "text").toLowerCase();
  return [
    "hidden",
    "checkbox",
    "radio",
    "file",
    "range",
    "color",
    "submit",
    "button",
    "reset",
    "image",
  ].includes(type);
}

function isSearchField(input: HTMLInputElement): boolean {
  const type = (input.type || "text").toLowerCase();
  if (type === "search") return true;
  const hints = getInputHints(input);
  return /search|find|query|filter/.test(hints);
}

function isVivagoUiInput(input: HTMLInputElement): boolean {
  return !!input.closest(".vivago-suggestions-dropdown, .vivago-save-banner, [data-vivago]");
}

// ============================================================
// Field role inference (pass 1 – hints & autocomplete)
// ============================================================

function inferRoleFromHints(input: HTMLInputElement): FieldRole | null {
  const type = (input.type || "text").toLowerCase();
  const ac = (input.autocomplete || "").toLowerCase();
  const hints = getInputHints(input);

  if (ac === "username") return "username";
  if (ac === "email") return "email";
  if (ac === "current-password") return "current-password";
  if (ac === "new-password") return "new-password";
  if (ac.includes("tel")) return "phone";
  if (ac.includes("one-time-code") || ac === "otp") return "otp";
  if (ac.includes("cc-number")) return "card-number";
  if (ac.includes("cc-exp")) return "card-expiry";
  if (ac.includes("cc-csc") || ac.includes("cc-cvv")) return "card-cvc";
  if (ac.includes("given-name")) return "first-name";
  if (ac.includes("family-name")) return "last-name";
  if (ac.includes("name") && !ac.includes("username")) return "name";
  if (ac.includes("organization")) return "organization";
  if (ac.includes("street-address") || ac.includes("address-line")) return "address";

  if (type === "email") return "email";
  if (type === "tel") return "phone";

  if (type === "password") {
    if (/confirm|repeat|verify|retype|again/.test(hints)) return "confirm-password";
    if (/new|create|choose|set.?up/.test(hints)) return "new-password";
    if (/current|old|existing/.test(hints)) return "current-password";
    return null;
  }

  if (/otp|one.?time|verification.?code|2fa|mfa|authenticator/.test(hints)) return "otp";
  if (/user|login|account/.test(hints) && !/name/.test(hints)) return "username";
  if (/email|e-mail/.test(hints)) return "email";
  if (/phone|mobile|tel/.test(hints)) return "phone";
  if (/first.?name|fname|given/.test(hints)) return "first-name";
  if (/last.?name|lname|surname|family/.test(hints)) return "last-name";
  if (/full.?name|^name$/.test(hints)) return "name";
  if (/address|street|city|zip|postal/.test(hints)) return "address";
  if (/company|organization|org/.test(hints)) return "organization";
  if (/card.?number|cc-num/.test(hints)) return "card-number";
  if (/expir|exp.?date|mm.?yy/.test(hints)) return "card-expiry";
  if (/cvv|cvc|security.?code/.test(hints)) return "card-cvc";

  return null;
}

function assignPasswordRolesByFormType(
  passwordFields: HTMLInputElement[],
  formType: FormType,
  roles: Map<HTMLInputElement, FieldRole>
): void {
  if (passwordFields.length === 0) return;

  const setRole = (input: HTMLInputElement, role: FieldRole) => {
    const existing = roles.get(input);
    if (
      !existing ||
      existing === "password" ||
      existing === "generic" ||
      (role === "confirm-password" && existing !== "current-password")
    ) {
      roles.set(input, role);
    }
  };

  if (formType === "login") {
    passwordFields.forEach((p) => setRole(p, "current-password"));
    return;
  }

  if (formType === "reset-password") {
    if (passwordFields.length === 1) {
      setRole(passwordFields[0], "new-password");
    } else {
      setRole(passwordFields[0], "new-password");
      setRole(passwordFields[passwordFields.length - 1], "confirm-password");
    }
    return;
  }

  if (formType === "change-password") {
    if (passwordFields.length === 1) {
      setRole(passwordFields[0], "new-password");
    } else if (passwordFields.length === 2) {
      const hasCurrent = passwordFields.some((p) => roles.get(p) === "current-password");
      if (hasCurrent) {
        passwordFields.forEach((p) => {
          if (roles.get(p) !== "current-password") setRole(p, "new-password");
        });
      } else {
        setRole(passwordFields[0], "new-password");
        setRole(passwordFields[1], "confirm-password");
      }
    } else {
      setRole(passwordFields[0], "current-password");
      setRole(passwordFields[1], "new-password");
      setRole(passwordFields[2], "confirm-password");
      for (let i = 3; i < passwordFields.length; i++) {
        setRole(passwordFields[i], "confirm-password");
      }
    }
    return;
  }

  if (formType === "signup") {
    if (passwordFields.length === 1) {
      setRole(passwordFields[0], "new-password");
    } else {
      setRole(passwordFields[0], "new-password");
      setRole(passwordFields[passwordFields.length - 1], "confirm-password");
      for (let i = 1; i < passwordFields.length - 1; i++) {
        if (roles.get(passwordFields[i]) !== "new-password") {
          setRole(passwordFields[i], "new-password");
        }
      }
    }
  }
}

function refineFieldRoles(
  inputs: HTMLInputElement[],
  formType: FormType
): Map<HTMLInputElement, FieldRole> {
  const roles = new Map<HTMLInputElement, FieldRole>();

  for (const input of inputs) {
    if (isIgnoredInputType(input) || isSearchField(input) || isVivagoUiInput(input)) {
      roles.set(input, "ignored");
      continue;
    }
    roles.set(input, inferRoleFromHints(input) || "generic");
  }

  const passwordFields = inputs.filter((i) => (i.type || "").toLowerCase() === "password");
  assignPasswordRolesByFormType(passwordFields, formType, roles);

  return roles;
}

// ============================================================
// Form type classification
// ============================================================

function classifyFormType(
  root: HTMLElement,
  inputs: HTMLInputElement[],
  roles: Map<HTMLInputElement, FieldRole>
): FormType {
  const passwordFields = inputs.filter((i) => (i.type || "").toLowerCase() === "password");
  const roleList = [...roles.values()];
  const containerText = getContainerText(root);
  const pageText = getPageContextText();
  const combined = `${containerText} ${pageText}`;

  const hasCurrent = roleList.includes("current-password");
  const hasNew = roleList.includes("new-password");
  const hasConfirm = roleList.includes("confirm-password");
  const hasUsername = roleList.some((r) => r === "username" || r === "email");
  const hasPayment = roleList.some((r) =>
    ["card-number", "card-expiry", "card-cvc"].includes(r)
  );
  const hasOtp = roleList.includes("otp");
  const hasIdentity = roleList.some((r) =>
    ["name", "first-name", "last-name", "phone", "address", "organization"].includes(r)
  );

  if (hasPayment || /checkout|payment|billing|card.?number/.test(combined)) {
    return "payment";
  }

  if (hasOtp && passwordFields.length === 0) {
    return "otp";
  }

  if (passwordFields.length === 0) {
    return hasIdentity ? "identity" : "unknown";
  }

  if (hasCurrent && (hasNew || hasConfirm || passwordFields.length >= 2)) {
    return "change-password";
  }

  if (/reset|forgot.?password|recover/.test(combined) && !hasCurrent) {
    return "reset-password";
  }

  if (
    /signup|sign.?up|register|create.?account|join|get.?started/.test(combined) &&
    passwordFields.length >= 1
  ) {
    return "signup";
  }

  if (hasNew && hasConfirm) {
    return /reset|forgot/.test(combined) ? "reset-password" : "signup";
  }

  if (passwordFields.length >= 2 && !hasCurrent) {
    return /signup|register|create|join/.test(combined) ? "signup" : "reset-password";
  }

  if (passwordFields.length === 1 && (hasUsername || /login|sign.?in|log.?in/.test(combined))) {
    return "login";
  }

  if (passwordFields.length === 1 && /signup|register/.test(combined)) {
    return "signup";
  }

  if (passwordFields.length >= 3) {
    return "change-password";
  }

  if (passwordFields.length >= 2) {
    return "signup";
  }

  return "unknown";
}

// ============================================================
// Container discovery
// ============================================================

function hasInterestingInputs(inputs: HTMLInputElement[]): boolean {
  return inputs.some((input) => {
    if (isIgnoredInputType(input) || isSearchField(input) || isVivagoUiInput(input)) {
      return false;
    }
    const type = (input.type || "text").toLowerCase();
    if (type === "password") return true;
    const role = inferRoleFromHints(input);
    if (role && role !== "generic" && role !== "ignored") return true;
    const hints = getInputHints(input);
    return /user|email|login|pass|phone|tel|account|otp|card|name|address/.test(hints);
  });
}

function findInputGroupRoot(input: HTMLInputElement): HTMLElement {
  const dialog = input.closest(
    '[role="dialog"], dialog, [class*="modal" i], [class*="dialog" i], [id*="modal" i], [data-testid*="modal" i]'
  );
  if (dialog && isVisible(dialog as HTMLElement)) {
    return dialog as HTMLElement;
  }

  let el: HTMLElement | null = input.parentElement;
  let best: HTMLElement = input.parentElement || document.body;
  let depth = 0;

  while (el && el !== document.body && depth < 10) {
    const inputs = getVisibleInputsIn(el);
    if (hasInterestingInputs(inputs)) {
      best = el;
    }
    el = el.parentElement;
    depth++;
  }

  return best;
}

function findFormContainers(): HTMLElement[] {
  const containers: HTMLElement[] = [];
  const claimedInputs = new Set<HTMLInputElement>();
  const seenRoots = new Set<HTMLElement>();

  document.querySelectorAll("form").forEach((formEl) => {
    const form = formEl as HTMLElement;
    if (!isVisible(form)) return;
    const inputs = getVisibleInputsIn(form);
    if (!hasInterestingInputs(inputs)) return;
    if (!seenRoots.has(form)) {
      containers.push(form);
      seenRoots.add(form);
      inputs.forEach((i) => claimedInputs.add(i));
    }
  });

  const unclaimed = Array.from(document.querySelectorAll("input")).filter((inp) => {
    const input = inp as HTMLInputElement;
    return (
      isVisible(input) &&
      !claimedInputs.has(input) &&
      !isVivagoUiInput(input) &&
      !isIgnoredInputType(input) &&
      !isSearchField(input)
    );
  });

  const groups = new Map<HTMLElement, HTMLInputElement[]>();
  for (const input of unclaimed) {
    if (!hasInterestingInputs([input])) continue;
    const root = findInputGroupRoot(input);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(input);
    if (root.tagName === "FORM" && !seenRoots.has(root)) {
      seenRoots.add(root);
    }
  }

  groups.forEach((inputs, root) => {
    if (inputs.length === 0) return;
    if (seenRoots.has(root)) return;
    seenRoots.add(root);
    containers.push(root);
    inputs.forEach((i) => claimedInputs.add(i));
  });

  return containers;
}

function buildFormContext(root: HTMLElement): FormContext {
  const inputs = getVisibleInputsIn(root).filter(
    (i) => !isIgnoredInputType(i) && !isSearchField(i) && !isVivagoUiInput(i)
  );

  const preliminaryType = classifyFormType(
    root,
    inputs,
    refineFieldRoles(inputs, "unknown")
  );
  const roles = refineFieldRoles(inputs, preliminaryType);
  const formType = classifyFormType(root, inputs, roles);

  const finalRoles =
    formType !== preliminaryType ? refineFieldRoles(inputs, formType) : roles;

  const fields: ClassifiedField[] = inputs.map((input) => ({
    input,
    role: finalRoles.get(input) || "generic",
  }));

  const findByRole = (role: FieldRole) =>
    fields.find((f) => f.role === role)?.input ?? null;

  const id = `vivago-form-${++formIdCounter}`;

  return {
    id,
    root,
    type: formType,
    fields,
    usernameField:
      findByRole("username") || findByRole("email"),
    currentPasswordField: findByRole("current-password"),
    newPasswordField: findByRole("new-password"),
    confirmPasswordField: findByRole("confirm-password"),
  };
}

// ============================================================
// Public API
// ============================================================

export function scanAndClassifyForms(): void {
  formRegistry.clear();

  const containers = findFormContainers();

  for (const root of containers) {
    const ctx = buildFormContext(root);
    formRegistry.set(ctx.id, ctx);

    for (const { input, role } of ctx.fields) {
      inputToForm.set(input, ctx);
      inputToRole.set(input, role);
    }
  }

  // Clear stale entries for removed inputs
  // (WeakMaps auto-GC inputs; registry is rebuilt each scan)
}

export function getFormContext(input: HTMLInputElement): FormContext | null {
  return inputToForm.get(input) ?? null;
}

export function getFieldRole(input: HTMLInputElement): FieldRole {
  return inputToRole.get(input) ?? "generic";
}

export function getFormType(input: HTMLInputElement): FormType {
  return getFormContext(input)?.type ?? "unknown";
}

export function shouldShowVivagoIcon(input: HTMLInputElement): boolean {
  if (isIgnoredInputType(input) || isSearchField(input) || isVivagoUiInput(input)) {
    return false;
  }

  const role = getFieldRole(input);
  if (role === "ignored") return false;

  const ctx = getFormContext(input);
  const formType = ctx?.type ?? "unknown";

  if (CREDENTIAL_FORM_TYPES.includes(formType)) {
    return (
      VAULT_ROLES.includes(role) ||
      GENERATOR_ROLES.includes(role) ||
      role === "password"
    );
  }

  if (formType === "identity") {
    return ["username", "email", "phone", "name", "first-name", "last-name"].includes(role);
  }

  if (formType === "otp") {
    return role === "otp";
  }

  // Fallback for unclassified credential-like fields
  if (!ctx) {
    const type = (input.type || "text").toLowerCase();
    if (type === "password") return true;
    const hints = getInputHints(input);
    return /user|email|login|pass|phone|account/.test(hints);
  }

  return false;
}

export function shouldSuggestGeneratedPassword(input: HTMLInputElement): boolean {
  const role = getFieldRole(input);
  if (GENERATOR_ROLES.includes(role)) return true;

  const ctx = getFormContext(input);
  if (!ctx) return false;

  if (ctx.type === "signup" || ctx.type === "reset-password" || ctx.type === "change-password") {
    if (role === "new-password" || role === "confirm-password") return true;
    if (
      (input.type || "").toLowerCase() === "password" &&
      input === ctx.newPasswordField
    ) {
      return true;
    }
    if (
      (input.type || "").toLowerCase() === "password" &&
      input === ctx.confirmPasswordField
    ) {
      return true;
    }
  }

  return false;
}

export function shouldShowVaultAutofill(input: HTMLInputElement): boolean {
  const role = getFieldRole(input);
  const ctx = getFormContext(input);
  const formType = ctx?.type ?? "unknown";

  if (role === "current-password" || (role === "password" && formType === "login")) {
    return true;
  }
  if (role === "username" || role === "email") {
    return CREDENTIAL_FORM_TYPES.includes(formType) || formType === "unknown";
  }
  return false;
}

export function getConfirmPasswordField(input: HTMLInputElement): HTMLInputElement | null {
  const ctx = getFormContext(input);
  if (ctx?.confirmPasswordField && ctx.confirmPasswordField !== input) {
    return ctx.confirmPasswordField;
  }

  const role = getFieldRole(input);
  if (role === "new-password" && ctx) {
    return ctx.confirmPasswordField;
  }

  return null;
}

export function getDropdownTitle(input: HTMLInputElement): string {
  if (shouldSuggestGeneratedPassword(input)) return "Password";

  const ctx = getFormContext(input);
  const formType = ctx?.type ?? "unknown";

  switch (formType) {
    case "signup":
      return "Sign up with...";
    case "change-password":
      return "Update password";
    case "reset-password":
      return "Reset password";
    case "login":
    default:
      return "Log in as...";
  }
}

export function getFormTypeLabel(type: FormType): string {
  switch (type) {
    case "login":
      return "Login";
    case "signup":
      return "Sign up";
    case "change-password":
      return "Change password";
    case "reset-password":
      return "Reset password";
    case "identity":
      return "Personal info";
    case "payment":
      return "Payment";
    case "otp":
      return "Verification";
    default:
      return "Form";
  }
}
