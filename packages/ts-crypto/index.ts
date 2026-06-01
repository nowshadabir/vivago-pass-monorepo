// Shared Cryptographic library using Web Crypto API

const globalPepper = "VIVAGO_PASS_PEPPER_KEY";

const getSubtleCrypto = async (): Promise<SubtleCrypto> => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  if (typeof self !== "undefined" && self.crypto?.subtle) {
    return self.crypto.subtle;
  }
  try {
    const { webcrypto } = await import("crypto");
    if (webcrypto?.subtle) return webcrypto.subtle as unknown as SubtleCrypto;
  } catch (e) {
    // ignore
  }
  throw new Error("Cryptography module not available in this environment");
};

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa !== "undefined") {
    return btoa(binary);
  } else if (typeof window !== "undefined") {
    return window.btoa(binary);
  }
  return Buffer.from(binary, "binary").toString("base64");
}

export function base64ToArrayBuffer(base64: any): ArrayBuffer {
  if (base64 instanceof ArrayBuffer) {
    return base64;
  }
  if (base64 && ArrayBuffer.isView(base64)) {
    return base64.buffer.slice(base64.byteOffset, base64.byteOffset + base64.byteLength) as ArrayBuffer;
  }
  if (typeof base64 !== "string") {
    return new ArrayBuffer(0);
  }

  // Convert base64url to standard base64
  let normalized = base64.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) {
    normalized += "=";
  }

  let binary: string;
  if (typeof atob !== "undefined") {
    binary = atob(normalized);
  } else if (typeof window !== "undefined") {
    binary = window.atob(normalized);
  } else {
    binary = Buffer.from(normalized, "base64").toString("binary");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function deriveKey(password: string, email: string): Promise<{ encryptionKey: CryptoKey; authKey: string }> {
  const subtle = await getSubtleCrypto();
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  
  // Deterministic salt: email + global pepper
  const salt = encoder.encode(email.trim().toLowerCase() + globalPepper);
  
  const baseKey = await subtle.importKey(
    "raw",
    passwordBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  
  const derivedBits = await subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 600000,
      hash: "SHA-256"
    },
    baseKey,
    512 // 512 bits output
  );
  
  // Split 512 bits (64 bytes) into 256 bits (32 bytes) for Encryption Key and 256 bits (32 bytes) for Auth Key
  const encryptionKeyBytes = derivedBits.slice(0, 32);
  const authKeyBytes = derivedBits.slice(32, 64);
  
  // Convert Encryption Key bytes to CryptoKey object (AES-GCM)
  const encryptionKey = await subtle.importKey(
    "raw",
    encryptionKeyBytes,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  
  // Convert Auth Key bytes to hex string for server transmission
  const authKey = Array.from(new Uint8Array(authKeyBytes))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
    
  return { encryptionKey, authKey };
}

export async function encryptData(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const subtle = await getSubtleCrypto();
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  
  // Generate random 12-byte IV
  const iv = new Uint8Array(12);
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(iv);
  } else if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(iv);
  } else if (typeof self !== "undefined" && self.crypto?.getRandomValues) {
    self.crypto.getRandomValues(iv);
  } else {
    const cryptoNode = require("crypto");
    cryptoNode.randomFillSync(iv);
  }
  
  const encrypted = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: 128
    },
    key,
    data
  );
  
  // In WebCrypto Subtle, the ciphertext contains the authTag appended at the end of the array buffer.
  // We need to separate ciphertext and authTag (last 16 bytes for tagLength 128)
  const totalLength = encrypted.byteLength;
  const ciphertextBytes = encrypted.slice(0, totalLength - 16);
  const authTagBytes = encrypted.slice(totalLength - 16, totalLength);
  
  return {
    ciphertext: arrayBufferToBase64(ciphertextBytes),
    iv: arrayBufferToBase64(iv.buffer),
    authTag: arrayBufferToBase64(authTagBytes)
  };
}

export async function decryptData(ciphertext: string, iv: string, authTag: string, key: CryptoKey): Promise<string> {
  const subtle = await getSubtleCrypto();
  
  const ciphertextBytes = new Uint8Array(base64ToArrayBuffer(ciphertext));
  const ivBytes = new Uint8Array(base64ToArrayBuffer(iv));
  const authTagBytes = new Uint8Array(base64ToArrayBuffer(authTag));
  
  // Combine ciphertext and authTag back together
  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTagBytes, ciphertextBytes.length);
  
  const decrypted = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
      tagLength: 128
    },
    key,
    combined.buffer
  );
  
  return new TextDecoder().decode(decrypted);
}

export async function encryptBinary(data: ArrayBuffer, key: CryptoKey): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const subtle = await getSubtleCrypto();
  
  // Generate random 12-byte IV
  const iv = new Uint8Array(12);
  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(iv);
  } else if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(iv);
  } else if (typeof self !== "undefined" && self.crypto?.getRandomValues) {
    self.crypto.getRandomValues(iv);
  } else {
    const cryptoNode = require("crypto");
    cryptoNode.randomFillSync(iv);
  }
  
  const encrypted = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
      tagLength: 128
    },
    key,
    data
  );
  
  const totalLength = encrypted.byteLength;
  const ciphertextBytes = encrypted.slice(0, totalLength - 16);
  const authTagBytes = encrypted.slice(totalLength - 16, totalLength);
  
  return {
    ciphertext: arrayBufferToBase64(ciphertextBytes),
    iv: arrayBufferToBase64(iv.buffer),
    authTag: arrayBufferToBase64(authTagBytes)
  };
}

export async function decryptBinary(ciphertext: string, iv: string, authTag: string, key: CryptoKey): Promise<ArrayBuffer> {
  const subtle = await getSubtleCrypto();
  
  const ciphertextBytes = new Uint8Array(base64ToArrayBuffer(ciphertext));
  const ivBytes = new Uint8Array(base64ToArrayBuffer(iv));
  const authTagBytes = new Uint8Array(base64ToArrayBuffer(authTag));
  
  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTagBytes, ciphertextBytes.length);
  
  return await subtle.decrypt(
    {
      name: "AES-GCM",
      iv: ivBytes,
      tagLength: 128
    },
    key,
    combined.buffer
  );
}

export async function deriveKeyFromBackupCode(code: string, email: string): Promise<CryptoKey> {
  const subtle = await getSubtleCrypto();
  const encoder = new TextEncoder();
  const codeBuffer = encoder.encode(code.trim().replace(/\s+/g, ""));
  const salt = encoder.encode(email.trim().toLowerCase() + "BACKUP_CODE_SALT_PEPPER");
  
  const baseKey = await subtle.importKey(
    "raw",
    codeBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  
  return await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function wrapMasterKey(masterKey: CryptoKey, wrappingKey: CryptoKey): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const subtle = await getSubtleCrypto();
  const rawKey = await subtle.exportKey("raw", masterKey);
  const keyBytes = new Uint8Array(rawKey);
  const hexString = Array.from(keyBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return await encryptData(hexString, wrappingKey);
}

export async function unwrapMasterKey(ciphertext: string, iv: string, authTag: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const subtle = await getSubtleCrypto();
  const decryptedHex = await decryptData(ciphertext, iv, authTag, wrappingKey);
  const bytes = new Uint8Array(decryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  
  return await subtle.importKey(
    "raw",
    bytes.buffer,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function deriveKeyFromPrf(prfValue: ArrayBuffer): Promise<CryptoKey> {
  const subtle = await getSubtleCrypto();
  return await subtle.importKey(
    "raw",
    prfValue,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function generateSharingKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const subtle = await getSubtleCrypto();
  const keyPair = await subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["encrypt", "decrypt"]
  );

  const publicKeyBuffer = await subtle.exportKey("spki", keyPair.publicKey);
  const publicKeyBase64 = arrayBufferToBase64(publicKeyBuffer);

  const privateKeyJwk = await subtle.exportKey("jwk", keyPair.privateKey);
  const privateKeyString = JSON.stringify(privateKeyJwk);

  return {
    publicKey: publicKeyBase64,
    privateKey: privateKeyString
  };
}

export async function encryptSharedData(
  plaintext: string, 
  recipientPublicKeySpkiBase64: string
): Promise<{ ciphertext: string; iv: string; authTag: string; encryptedKey: string }> {
  const subtle = await getSubtleCrypto();
  
  // Generate random AES-GCM key
  const aesKey = await subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );

  // Encrypt plaintext with AES-GCM
  const { ciphertext, iv, authTag } = await encryptData(plaintext, aesKey);

  // Export AES key to raw bytes
  const rawAesKey = await subtle.exportKey("raw", aesKey);

  // Import recipient's RSA public key
  const publicKeyBuffer = base64ToArrayBuffer(recipientPublicKeySpkiBase64);
  const recipientPublicKey = await subtle.importKey(
    "spki",
    publicKeyBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256"
    },
    false,
    ["encrypt"]
  );

  // Encrypt the AES key bytes with RSA
  const encryptedKeyBuffer = await subtle.encrypt(
    {
      name: "RSA-OAEP"
    },
    recipientPublicKey,
    rawAesKey
  );

  return {
    ciphertext,
    iv,
    authTag,
    encryptedKey: arrayBufferToBase64(encryptedKeyBuffer)
  };
}

export async function decryptSharedData(
  ciphertext: string, 
  iv: string, 
  authTag: string, 
  encryptedKeyBase64: string, 
  recipientPrivateKeyJwkString: string
): Promise<string> {
  const subtle = await getSubtleCrypto();
  
  // Import recipient's RSA private key
  const privateKeyJwk = JSON.parse(recipientPrivateKeyJwkString);
  const recipientPrivateKey = await subtle.importKey(
    "jwk",
    privateKeyJwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256"
    },
    false,
    ["decrypt"]
  );

  // Decrypt the AES key bytes using RSA
  const encryptedKeyBuffer = base64ToArrayBuffer(encryptedKeyBase64);
  const decryptedKeyBuffer = await subtle.decrypt(
    {
      name: "RSA-OAEP"
    },
    recipientPrivateKey,
    encryptedKeyBuffer
  );

  // Import decrypted AES key bytes
  const aesKey = await subtle.importKey(
    "raw",
    decryptedKeyBuffer,
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["decrypt"]
  );

  // Decrypt plaintext with AES-GCM
  return await decryptData(ciphertext, iv, authTag, aesKey);
}

