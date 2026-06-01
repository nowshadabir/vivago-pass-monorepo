/**
 * Passkey Modal UI Component
 * Handles display and interaction with passkey sign-in modal
 */

interface PasskeyOption {
  id: string;
  label: string;
  email: string;
  icon?: string;
}

export class PasskeyModal {
  private modal: HTMLElement | null = null;
  private modalContent: HTMLElement | null = null;
  private passkeyList: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onSelectCallback: ((passkey: PasskeyOption) => void) | null = null;
  private onCloseCallback: (() => void) | null = null;

  constructor() {
    this.initializeElements();
  }

  /**
   * Initialize modal elements from the DOM
   */
  private initializeElements() {
    this.modal = document.getElementById("passkey-modal");
    this.passkeyList = document.querySelector(".passkey-list");
    this.closeBtn = document.getElementById("passkey-close-btn");

    if (!this.modal) {
      console.warn("Passkey modal not found in DOM");
      return;
    }

    // Setup close button
    if (this.closeBtn) {
      this.closeBtn.addEventListener("click", () => this.close());
    }

    // Setup backdrop click
    const backdrop = this.modal.querySelector(".passkey-modal-backdrop");
    if (backdrop) {
      backdrop.addEventListener("click", () => this.close());
    }

    // Prevent closing when clicking inside content
    const content = this.modal.querySelector(".passkey-modal-content");
    if (content) {
      content.addEventListener("click", (e) => e.stopPropagation());
    }

    // Setup ESC key to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen()) {
        this.close();
      }
    });
  }

  /**
   * Set the callback when a passkey is selected
   */
  onSelect(callback: (passkey: PasskeyOption) => void) {
    this.onSelectCallback = callback;
  }

  /**
   * Set the callback when modal is closed
   */
  onClose(callback: () => void) {
    this.onCloseCallback = callback;
  }

  /**
   * Show the modal with passkey options
   */
  public show(passkeys: PasskeyOption[]) {
    if (!this.modal) return;

    this.renderPasskeys(passkeys);
    this.modal.classList.remove("hidden");

    // Prevent body scroll
    document.body.style.overflow = "hidden";
  }

  /**
   * Close the modal
   */
  public close() {
    if (!this.modal) return;

    this.modal.classList.add("hidden");
    document.body.style.overflow = "";

    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  /**
   * Check if modal is currently open
   */
  public isOpen(): boolean {
    return this.modal ? !this.modal.classList.contains("hidden") : false;
  }

  /**
   * Render passkeys list
   */
  private renderPasskeys(passkeys: PasskeyOption[]) {
    if (!this.passkeyList) return;

    this.passkeyList.innerHTML = "";

    if (passkeys.length === 0) {
      this.renderEmptyState();
      return;
    }

    passkeys.forEach((passkey) => {
      const element = this.createPasskeyElement(passkey);
      this.passkeyList!.appendChild(element);
    });
  }

  /**
   * Create a passkey item element
   */
  private createPasskeyElement(passkey: PasskeyOption): HTMLElement {
    const div = document.createElement("div");
    div.className = "passkey-item";
    div.setAttribute("role", "button");
    div.setAttribute("tabindex", "0");

    const icon = document.createElement("div");
    icon.className = "passkey-item-icon";
    icon.innerHTML = passkey.icon || "👤";

    const content = document.createElement("div");
    content.className = "passkey-item-content";

    const label = document.createElement("div");
    label.className = "passkey-item-label";
    label.textContent = passkey.label;

    const email = document.createElement("div");
    email.className = "passkey-item-email";
    email.textContent = passkey.email;

    content.appendChild(label);
    content.appendChild(email);

    div.appendChild(icon);
    div.appendChild(content);

    // Click handler
    div.addEventListener("click", () => this.selectPasskey(passkey));

    // Keyboard handler
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.selectPasskey(passkey);
      }
    });

    return div;
  }

  /**
   * Handle passkey selection
   */
  private selectPasskey(passkey: PasskeyOption) {
    if (this.onSelectCallback) {
      this.onSelectCallback(passkey);
    }
    this.close();
  }

  /**
   * Render empty state when no passkeys available
   */
  private renderEmptyState() {
    if (!this.passkeyList) return;

    const empty = document.createElement("div");
    empty.className = "passkey-empty-state";

    const icon = document.createElement("div");
    icon.className = "passkey-empty-icon";
    icon.textContent = "🔐";

    const text = document.createElement("p");
    text.className = "passkey-empty-text";
    text.textContent = "No passkeys found. Please set up a passkey first.";

    empty.appendChild(icon);
    empty.appendChild(text);
    this.passkeyList.appendChild(empty);
  }

  /**
   * Show loading state
   */
  public showLoading() {
    if (!this.passkeyList) return;

    this.passkeyList.innerHTML = `
      <div class="passkey-loading">
        <div class="passkey-spinner"></div>
        <span>Loading passkeys...</span>
      </div>
    `;
  }

  /**
   * Show error state
   */
  public showError(message: string) {
    if (!this.passkeyList) return;

    this.passkeyList.innerHTML = `
      <div class="passkey-empty-state">
        <div class="passkey-empty-icon">⚠️</div>
        <p class="passkey-empty-text">${message}</p>
      </div>
    `;
  }
}

/**
 * Helper function to initialize passkey modal in extension context
 */
export function initializePasskeyModal(): PasskeyModal {
  const modal = new PasskeyModal();
  return modal;
}
