// Shared type definitions for Vivago Pass

export interface VaultItem {
  id: string;
  type: 'login' | 'note' | 'card' | 'ssh_key';
  name: string;
  notes?: string;
  lastModified: number;
  // Encrypted payloads (Base64)
  ciphertext: string;
  iv: string; // Base64 12-byte IV
  authTag: string; // Base64 authentication tag
}

export interface UserSession {
  userId: string;
  email: string;
  sessionToken: string;
  createdAt: number;
}
