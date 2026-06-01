import { deriveKey, decryptData, encryptData, base64ToArrayBuffer } from "@vivago-pass/ts-crypto";

const API_URL = "http://localhost:3001";

// Helper to get decryption key from hex stored in session storage
async function getClientEncryptionKey(keyHex: string): Promise<CryptoKey | null> {
  try {
    const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const subtle = self.crypto.subtle;
    return await subtle.importKey(
      "raw",
      keyBytes.buffer,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (e) {
    console.error("Failed to import client encryption key:", e);
    return null;
  }
}

// Client-side decryption for VaultItem
async function decryptVaultItem(rawItem: any, key: CryptoKey): Promise<any> {
  try {
    const decryptedJson = await decryptData(rawItem.ciphertext, rawItem.iv, rawItem.authTag, key);
    const payload = JSON.parse(decryptedJson);
    
    return {
      id: rawItem.id,
      name: rawItem.name,
      type: rawItem.type,
      updatedAt: "Synced",
      ...payload
    };
  } catch (err) {
    console.error("Failed to decrypt item:", rawItem.id, err);
    return {
      id: rawItem.id,
      name: rawItem.name || "Decryption Failed",
      type: rawItem.type || "login",
      username: "Decryption Mismatch",
      noteText: "Unable to decrypt this item."
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "login") {
    handleLogin(message.email, message.password)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === "check-auth") {
    handleCheckAuth()
      .then(sendResponse);
    return true;
  }

  if (message.type === "logout") {
    handleLogout()
      .then(sendResponse);
    return true;
  }

  if (message.type === "get-vault-items") {
    handleGetVaultItems(message.domain)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "save-vault-item") {
    handleSaveVaultItem(message.item)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "save-passkey") {
    handleSavePasskey(message.passkey, message.domain)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "get-passkeys") {
    handleGetPasskeys(message.domain)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "authenticate-passkey") {
    handleAuthenticatePasskey(message.passkeyId, message.domain)
      .then(sendResponse)
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function handleLogin(email: string, masterPassword: string) {
  // 1. Derive wrapping key and auth key from master password and email
  const { encryptionKey: wrappingKey, authKey } = await deriveKey(masterPassword, email);

  // 2. Authenticate against API backend
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, authKey })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Invalid credentials");
  }

  let keyHex = "";
  if (data.encryptedMasterKey) {
    // Decrypt the random master key using the password-derived wrapping key
    keyHex = await decryptData(data.encryptedMasterKey, data.masterKeyIv, data.masterKeyAuthTag, wrappingKey);
  } else {
    // Fallback if master key not on user account
    const rawKey = await self.crypto.subtle.exportKey("raw", wrappingKey);
    keyHex = Array.from(new Uint8Array(rawKey))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Store user info and master key strictly in session storage (in-memory only)
  await chrome.storage.local.set({
    "sessionToken": data.sessionToken,
    "userId": data.userId,
    "userEmail": data.email,
    "masterKeyHex": keyHex
  });

  return { success: true, email: data.email, userId: data.userId };
}

async function handleCheckAuth() {
  const session = await chrome.storage.local.get(["sessionToken", "userEmail", "masterKeyHex"]);
  if (session.sessionToken && session.masterKeyHex) {
    return { isAuthenticated: true, email: session.userEmail };
  }
  return { isAuthenticated: false };
}

async function handleLogout() {
  await chrome.storage.local.clear();
  return { success: true };
}

async function handleGetVaultItems(domain?: string) {
  const session = await chrome.storage.local.get(["sessionToken", "userId", "masterKeyHex"]);
  if (!session.sessionToken || !session.masterKeyHex || !session.userId) {
    throw new Error("Unauthorized");
  }

  // Fetch encrypted vault items from API
  const res = await fetch(`${API_URL}/api/vault`, {
    headers: {
      "x-user-id": session.userId,
      "session-token": session.sessionToken
    }
  });

  if (!res.ok) {
    throw new Error("Failed to fetch vault items from backend");
  }

  const { items } = await res.json();
  
  const encryptionKey = await getClientEncryptionKey(session.masterKeyHex);
  if (!encryptionKey) {
    throw new Error("Master key invalid");
  }

  // Decrypt vault items
  const decryptedItems = await Promise.all(
    items.map(async (rawItem: any) => {
      return await decryptVaultItem(rawItem, encryptionKey);
    })
  );

  // Optionally filter by domain
  if (domain) {
    const cleanDomain = domain.toLowerCase().replace(/^www\./, "");
    const filtered = decryptedItems.filter((item: any) => {
      if (item.type !== "login") return false;
      const url = (item.url || "").toLowerCase();
      return url.includes(cleanDomain);
    });
    return { success: true, items: filtered };
  }

  return { success: true, items: decryptedItems };
}

async function handleSaveVaultItem(item: any) {
  const session = await chrome.storage.local.get(["sessionToken", "userId", "masterKeyHex"]);
  if (!session.sessionToken || !session.masterKeyHex || !session.userId) {
    throw new Error("Unauthorized");
  }

  const encryptionKey = await getClientEncryptionKey(session.masterKeyHex);
  if (!encryptionKey) {
    throw new Error("Master key invalid");
  }

  // Encrypt item payload
  const payload = {
    url: item.url || "",
    username: item.username || "",
    password: item.password || "",
    totp: item.totp || "",
    noteText: item.noteText || item.notes || "",
    cardholderName: item.cardholderName || "",
    cardNumber: item.cardNumber || "",
    expirationDate: item.expirationDate || "",
    cvv: item.cvv || "",
    pin: item.pin || "",
    aliasEmail: item.aliasEmail || "",
    forwardTo: item.forwardTo || "",
    identityFirstName: item.identityFirstName || "",
    identityLastName: item.identityLastName || "",
    identityEmail: item.identityEmail || "",
    identityPhone: item.identityPhone || "",
    vaultID: item.vaultID || "vlt_personal"
  };

  const encrypted = await encryptData(JSON.stringify(payload), encryptionKey);

  const res = await fetch(`${API_URL}/api/vault`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": session.userId,
      "session-token": session.sessionToken
    },
    body: JSON.stringify({
      id: item.id,
      type: item.type || "login",
      name: item.name,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      lastModified: Date.now()
    })
  });

  if (!res.ok) {
    throw new Error("Failed to save item to API");
  }

  return { success: true };
}

// ============================================================
// Passkey Operations
// ============================================================

async function handleSavePasskey(passkey: any, domain: string) {
  const session = await chrome.storage.local.get(["sessionToken", "userId", "masterKeyHex"]);
  if (!session.sessionToken || !session.masterKeyHex || !session.userId) {
    throw new Error("Unauthorized");
  }

  // Store passkey locally with domain association
  const passkeyData = {
    id: passkey.id || passkey.rawId,
    credentialId: passkey.id || passkey.rawId,
    domain: domain,
    name: passkey.name || `Passkey for ${domain}`,
    publicKey: passkey.response?.transports || [],
    createdAt: Date.now(),
    credentialJson: JSON.stringify({
      type: passkey.type,
      id: passkey.id,
      response: {
        clientDataJSON: passkey.response?.clientDataJSON,
        attestationObject: passkey.response?.attestationObject,
        transports: passkey.response?.transports
      }
    })
  };

  // Store in chrome.storage
  const storageKey = `passkey_${domain}_${passkeyData.credentialId.slice(0, 8)}`;
  await chrome.storage.local.set({
    [storageKey]: passkeyData
  });

  // Also save to vault as a passkey item for persistence
  const encryptionKey = await getClientEncryptionKey(session.masterKeyHex);
  if (!encryptionKey) {
    throw new Error("Master key invalid");
  }

  const payload = {
    credentialId: passkeyData.credentialId,
    domain: domain,
    credentialJson: passkeyData.credentialJson,
    createdAt: passkeyData.createdAt
  };

  const encrypted = await encryptData(JSON.stringify(payload), encryptionKey);

  const res = await fetch(`${API_URL}/api/vault`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": session.userId,
      "session-token": session.sessionToken
    },
    body: JSON.stringify({
      type: "passkey",
      name: passkeyData.name,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      lastModified: Date.now()
    })
  });

  if (!res.ok) {
    console.warn("Failed to save passkey to API (will still be stored locally):", await res.text());
  }

  return { success: true, message: "Passkey saved successfully" };
}

async function handleGetPasskeys(domain: string) {
  const session = await chrome.storage.local.get(["sessionToken", "userId", "masterKeyHex"]);
  if (!session.sessionToken || !session.masterKeyHex || !session.userId) {
    throw new Error("Unauthorized");
  }

  // Get all stored data
  const allStorage = await chrome.storage.local.get(null);
  
  // Filter passkeys for the domain
  const passkeysForDomain: any[] = [];
  for (const [key, value] of Object.entries(allStorage)) {
    if (key.startsWith("passkey_") && (value as any).domain === domain) {
      passkeysForDomain.push(value);
    }
  }

  // Also try to fetch from vault
  try {
    const vaultResponse = await fetch(`${API_URL}/api/vault`, {
      headers: {
        "x-user-id": session.userId,
        "session-token": session.sessionToken
      }
    });

    if (vaultResponse.ok) {
      const { items } = await vaultResponse.json();
      const encryptionKey = await getClientEncryptionKey(session.masterKeyHex);
      
      if (encryptionKey) {
        const passkeyItems = items.filter((item: any) => item.type === "passkey");
        for (const item of passkeyItems) {
          try {
            const decryptedJson = await decryptData(item.ciphertext, item.iv, item.authTag, encryptionKey);
            const payload = JSON.parse(decryptedJson);
            if (payload.domain === domain) {
              passkeysForDomain.push({
                id: payload.credentialId,
                credentialId: payload.credentialId,
                domain: payload.domain,
                name: item.name,
                createdAt: payload.createdAt
              });
            }
          } catch (e) {
            console.warn("Failed to decrypt passkey item:", e);
          }
        }
      }
    }
  } catch (e) {
    console.warn("Failed to fetch passkeys from API:", e);
  }

  return { success: true, passkeys: passkeysForDomain };
}

async function handleAuthenticatePasskey(passkeyId: string, domain: string) {
  // This is called after WebAuthn successfully authenticates
  // Return success if the passkey was recognized
  const session = await chrome.storage.local.get(["sessionToken", "userId"]);
  if (!session.sessionToken || !session.userId) {
    throw new Error("Unauthorized");
  }

  return { success: true, authenticated: true, domain };
}
