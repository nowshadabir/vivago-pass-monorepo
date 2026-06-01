/**
 * WebAuthn Bridge - Injected into page context
 * Allows the page to use navigator.credentials.create() for passkey registration
 * This runs in the page's own context, not the extension's isolated world
 */

(function initWebAuthnBridge() {
  "use strict";

  // Ensure WebAuthn is available
  if (!window.PublicKeyCredential) {
    console.log("[Vivago] WebAuthn not supported on this page");
    return;
  }

  // Store references to original methods
  const originalCreate = navigator.credentials.create.bind(navigator.credentials);
  const originalGet = navigator.credentials.get.bind(navigator.credentials);

  // Enhanced credential.create() - for passkey registration
  navigator.credentials.create = async function(options) {
    try {
      console.log("[Vivago Bridge] Passkey registration requested");
      
      // Log the options for debugging
      if (options?.publicKey) {
        console.log("[Vivago Bridge] Using public key credential for registration");
      }

      // Call the original create method
      const credential = await originalCreate(options);
      
      if (credential) {
        console.log("[Vivago Bridge] Passkey successfully created");
        // Notify the extension (optional)
        window.postMessage({
          type: "VIVAGO_PASSKEY_CREATED",
          credential: credential
        }, "*");
      }
      
      return credential;
    } catch (error) {
      console.error("[Vivago Bridge] Passkey creation failed:", error);
      throw error;
    }
  };

  // Enhanced credential.get() - for passkey authentication
  navigator.credentials.get = async function(options) {
    try {
      console.log("[Vivago Bridge] Passkey authentication requested");
      
      // Log the options for debugging
      if (options?.publicKey) {
        console.log("[Vivago Bridge] Using public key credential for authentication");
      }

      // Call the original get method
      const credential = await originalGet(options);
      
      if (credential) {
        console.log("[Vivago Bridge] Passkey successfully retrieved");
        // Notify the extension (optional)
        window.postMessage({
          type: "VIVAGO_PASSKEY_RETRIEVED",
          credential: credential
        }, "*");
      }
      
      return credential;
    } catch (error) {
      console.error("[Vivago Bridge] Passkey retrieval failed:", error);
      throw error;
    }
  };

  console.log("[Vivago Bridge] WebAuthn bridge initialized - passkeys should now work");
})();
