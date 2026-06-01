let inMemoryMasterKeyHex: string | null = null;

export function getStorage(): Storage {
  if (typeof window !== "undefined") {
    const isRemembered = window.localStorage.getItem("remember_me") === "true";
    return isRemembered ? window.localStorage : window.sessionStorage;
  }
  // Safe mock fallback for SSR
  return {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0
  } as unknown as Storage;
}

export function setMasterKeyHex(keyHex: string | null) {
  inMemoryMasterKeyHex = keyHex;
  if (typeof window !== "undefined") {
    const storage = getStorage();
    if (keyHex) {
      storage.setItem("master_key_hex", keyHex);
    } else {
      window.localStorage.removeItem("master_key_hex");
      window.sessionStorage.removeItem("master_key_hex");
    }
  }
}

export function getMasterKeyHex(): string | null {
  if (inMemoryMasterKeyHex) return inMemoryMasterKeyHex;
  if (typeof window !== "undefined") {
    const storage = getStorage();
    const stored = storage.getItem("master_key_hex");
    if (stored) {
      inMemoryMasterKeyHex = stored;
      return stored;
    }
  }
  return null;
}

export function clearSession() {
  inMemoryMasterKeyHex = null;
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("x-user-id");
    window.localStorage.removeItem("user-email");
    window.localStorage.removeItem("session-token");
    window.localStorage.removeItem("master_key_hex");
    window.localStorage.removeItem("remember_me");

    window.sessionStorage.removeItem("x-user-id");
    window.sessionStorage.removeItem("user-email");
    window.sessionStorage.removeItem("session-token");
    window.sessionStorage.removeItem("master_key_hex");
    window.sessionStorage.removeItem("remember_me");
  }
}

export const CONFIG = {
  API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
};
