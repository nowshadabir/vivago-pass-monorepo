/**
 * Example: How to use the Passkey Modal in your extension
 * 
 * This shows how to integrate the PasskeyModal component into your extension's popup or content script
 */

import { PasskeyModal, initializePasskeyModal } from "./passkey-modal";

// Example 1: Basic Usage in Popup
export function setupPasskeySignIn() {
  const modal = initializePasskeyModal();

  // Setup callbacks
  modal.onSelect((passkey) => {
    console.log("User selected passkey:", passkey.label);
    // TODO: Send passkey selection to background script
    // chrome.runtime.sendMessage({
    //   type: "passkey-selected",
    //   passkeyId: passkey.id
    // });
  });

  modal.onClose(() => {
    console.log("Passkey modal closed");
  });

  // Show modal with sample passkeys
  const samplePasskeys = [
    {
      id: "pk-1",
      label: "localhost",
      email: "knabir.official@gmail.com",
      icon: "👤"
    },
    {
      id: "pk-2",
      label: "localhost",
      email: "knabir.official@gmail.com",
      icon: "👤"
    },
    {
      id: "pk-3",
      label: "localhost",
      email: "knabir.official@gmail.com",
      icon: "👤"
    }
  ];

  // Open the modal
  modal.show(samplePasskeys);
}

// Example 2: Trigger from button in your extension
export function setupPasskeyButton() {
  const modal = initializePasskeyModal();

  const passkeyBtn = document.querySelector("#trigger-passkey-btn") as HTMLButtonElement;
  if (!passkeyBtn) return;

  passkeyBtn.addEventListener("click", async () => {
    // Show loading state
    modal.showLoading();
    modal.show([]);

    try {
      // Fetch passkeys from backend
      const response = await chrome.runtime.sendMessage({ type: "fetch-passkeys" });

      if (response.success) {
        modal.show(response.passkeys);
      } else {
        modal.showError(response.error || "Failed to load passkeys");
      }
    } catch (err) {
      modal.showError("Error loading passkeys");
    }
  });

  modal.onSelect((passkey) => {
    // Handle selection
    console.log("Selected:", passkey);
    // TODO: Process the selected passkey
  });
}

// Example 3: Direct integration with your login flow
export async function handlePasskeySignIn() {
  const modal = initializePasskeyModal();

  try {
    // Fetch available passkeys
    const response = await chrome.runtime.sendMessage({
      type: "get-available-passkeys",
      domain: "localhost"
    });

    if (response.passkeys && response.passkeys.length > 0) {
      // Show modal to user
      modal.show(response.passkeys);

      // Wait for selection
      modal.onSelect(async (selected) => {
        // Send authentication request
        const authResponse = await chrome.runtime.sendMessage({
          type: "authenticate-with-passkey",
          passkeyId: selected.id
        });

        if (authResponse.success) {
          console.log("Authentication successful");
          // TODO: Redirect to vault or main screen
        } else {
          modal.showError("Authentication failed");
        }
      });
    } else {
      modal.showError("No passkeys available");
    }
  } catch (err) {
    modal.showError("Error fetching passkeys");
  }
}
