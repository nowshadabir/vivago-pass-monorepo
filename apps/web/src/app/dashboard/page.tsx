"use client";

import React, { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { encryptData, decryptData, generateSharingKeyPair, encryptSharedData, decryptSharedData } from "@vivago-pass/ts-crypto";
import { getMasterKeyHex, setMasterKeyHex, getStorage, clearSession, CONFIG } from "@/lib/sessionStore";
import Preferences from "../../components/preferences";
import ProfileView from "../../components/profile-view";
import DocumentsView from "../../components/documents-view";
import Sidebar from "../../components/sidebar";
import { 
  fetchAttachmentsList, 
  downloadAttachmentFile, 
  deleteAttachmentFile, 
  uploadAttachmentFile,
  type Attachment 
} from "../../lib/attachmentService";
import { useToast } from "../../context/toast-context";

import { 
  Shield, Key, User, Settings, LogOut, Search, Plus, 
  ExternalLink, RefreshCw, HelpCircle, AlertTriangle, CheckCircle, 
  Copy, Folder, Trash2, Layers, Lock, Sparkles, FolderPlus, 
  PanelLeft, Sliders, ShieldCheck, ChevronsUpDown, Clock, 
  Share2, MoreVertical, Calendar, ChevronDown, ChevronUp, 
  Hash, Globe, FileText, LockKeyhole, Info, X, CreditCard, Paperclip, Glasses, Mail, CornerUpRight, MapPin, Phone,
  Edit2,
  Eye, EyeOff, Download,
  CheckSquare, Square
} from "lucide-react";

interface VaultItem {
  id: string;
  name: string;
  url: string;
  urls?: string[];
  username: string;
  password?: string;
  strength: "weak" | "fair" | "strong";
  updatedAt: string;
  timeGroup: "Last week" | "Last 2 weeks" | "Older";
  totp?: string;
  created: string;
  modified: string;
  lastAutofill: string;
  itemID: string;
  shareID: string;
  vaultID: string;
  isReceivedShare?: boolean;
  isSentShare?: boolean;
  sharedBy?: string;
  receiverEmail?: string;

  
  // Card-specific fields (Optional)
  type?: "login" | "card" | "alias" | "note" | "identity" | "generator" | "passkey";
  cardholderName?: string;
  cardNumber?: string;
  expirationDate?: string;
  cvv?: string;
  pin?: string;
  noteText?: string;

  // Alias-specific fields (Optional)
  aliasEmail?: string;
  forwardTo?: string;

  // Identity-specific fields (Optional)
  identityFirstName?: string;
  identityLastName?: string;
  identityGender?: string;
  identityBirthDate?: string;
  identityPhone?: string;
  identityEmail?: string;
  identityAddress?: string;
  identityCity?: string;
  identityState?: string;
  identityZip?: string;
  identityCountry?: string;
  identitySsn?: string;
  identityPassport?: string;

  // Passkey-specific fields (Optional)
  passkeyRelyingParty?: string;
  passkeyUserName?: string;
  passkeyCredentialId?: string;
  passkeyPublicKey?: string;
  passkeyPrivateKey?: string;
}

// Helper to retrieve and import the client-side ZKA encryption key from sessionStorage
async function getClientEncryptionKey(): Promise<CryptoKey | null> {
  if (typeof window === "undefined") return null;
  const keyHex = getMasterKeyHex();
  if (!keyHex) return null;
  try {
    const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const subtle = window.crypto.subtle;
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

// Decodes a Base32 string to Uint8Array for TOTP key generation
function base32ToBytes(base32: string): Uint8Array {
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.replace(/[\s-]/g, "").toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  
  for (let i = 0; i < clean.length; i++) {
    const idx = base32chars.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

// Generates a 6-digit TOTP code from a Base32 secret key using Web Crypto API
async function generateTOTP(secret: string): Promise<string> {
  try {
    const keyBytes = base32ToBytes(secret);
    if (keyBytes.length === 0) return "000000";
    
    const epoch = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epoch / 30);
    
    // Counter needs to be 8-byte big-endian integer
    const counterBytes = new Uint8Array(8);
    let tmp = counter;
    for (let i = 7; i >= 0; i--) {
      counterBytes[i] = tmp & 0xff;
      tmp = tmp >> 8;
    }
    
    const subtle = window.crypto.subtle;
    const key = await subtle.importKey(
      "raw",
      keyBytes as any,
      { name: "HMAC", hash: { name: "SHA-1" } },
      false,
      ["sign"]
    );
    
    const hmac = await subtle.sign("HMAC", key, counterBytes);
    const hmacBytes = new Uint8Array(hmac);
    
    // Dynamic truncation
    const offset = hmacBytes[hmacBytes.length - 1] & 0xf;
    const code =
      ((hmacBytes[offset] & 0x7f) << 24) |
      ((hmacBytes[offset + 1] & 0xff) << 16) |
      ((hmacBytes[offset + 2] & 0xff) << 8) |
      (hmacBytes[offset + 3] & 0xff);
      
    const otp = code % 1000000;
    return otp.toString().padStart(6, "0");
  } catch (err) {
    console.error("TOTP generation error:", err);
    return "000000";
  }
}

// Generates a mock/real WebAuthn keypair and credential ID for third-party passkey storage
async function generatePasskeyCredentialPair(): Promise<{ credentialId: string; publicKey: string; privateKey: string }> {
  try {
    const subtle = window.crypto.subtle;
    const keyPair = await subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256"
      },
      true,
      ["sign", "verify"]
    );
    const pubJwk = await subtle.exportKey("jwk", keyPair.publicKey);
    const privJwk = await subtle.exportKey("jwk", keyPair.privateKey);

    const credentialId = "cred_" + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    return {
      credentialId,
      publicKey: JSON.stringify(pubJwk, null, 2),
      privateKey: JSON.stringify(privJwk, null, 2)
    };
  } catch (err) {
    console.error("Failed to generate passkey pair:", err);
    return {
      credentialId: "cred_" + Math.random().toString(36).substring(2, 15),
      publicKey: "mock-public-key-data",
      privateKey: "mock-private-key-data"
    };
  }
}


// Deterministic Vault ID generator for category-based vault assignment
function getVaultId(category: string): string {
  const map: Record<string, string> = {
    "all": "vlt_all_items",
    "personal": "vlt_personal",
    "trash": "vlt_trash",
  };
  if (map[category]) return map[category];
  // Custom vaults: sanitize name
  const clean = category.toLowerCase().replace(/[^a-z0-9]/g, "_");
  return `vlt_${clean}`;
}

// Client-side encryption for VaultItem
async function encryptVaultItem(item: VaultItem, key: CryptoKey): Promise<{ ciphertext: string; iv: string; authTag: string }> {
  const payload = {
    url: item.url || "",
    username: item.username || "",
    password: item.password || "",
    totp: item.totp || "",
    cardholderName: item.cardholderName || "",
    cardNumber: item.cardNumber || "",
    expirationDate: item.expirationDate || "",
    cvv: item.cvv || "",
    pin: item.pin || "",
    noteText: item.noteText || "",
    aliasEmail: item.aliasEmail || "",
    forwardTo: item.forwardTo || "",
    identityFirstName: item.identityFirstName || "",
    identityLastName: item.identityLastName || "",
    identityGender: item.identityGender || "",
    identityBirthDate: item.identityBirthDate || "",
    identityPhone: item.identityPhone || "",
    identityEmail: item.identityEmail || "",
    identityAddress: item.identityAddress || "",
    identityCity: item.identityCity || "",
    identityState: item.identityState || "",
    identityZip: item.identityZip || "",
    identityCountry: item.identityCountry || "",
    identitySsn: item.identitySsn || "",
    identityPassport: item.identityPassport || "",
    urls: (item as any).urls || [],
    itemID: item.itemID || item.id,
    shareID: item.shareID || "shr_" + item.id,
    vaultID: item.vaultID || "vlt_personal",
    passkeyRelyingParty: item.passkeyRelyingParty || "",
    passkeyUserName: item.passkeyUserName || "",
    passkeyCredentialId: item.passkeyCredentialId || "",
    passkeyPublicKey: item.passkeyPublicKey || "",
    passkeyPrivateKey: item.passkeyPrivateKey || ""
  };
  return await encryptData(JSON.stringify(payload), key);
}

// Client-side decryption for VaultItem
async function decryptVaultItem(rawItem: any, key: CryptoKey): Promise<VaultItem> {
  try {
    const decryptedJson = await decryptData(rawItem.ciphertext, rawItem.iv, rawItem.authTag, key);
    const payload = JSON.parse(decryptedJson);
    
    return {
      id: rawItem.id,
      name: rawItem.name,
      type: rawItem.type,
      strength: "strong",
      updatedAt: "Synced",
      timeGroup: "Last week",
      created: "Synced",
      modified: "Synced",
      lastAutofill: "Never",
      itemID: rawItem.id,
      shareID: "shr_" + rawItem.id,
      vaultID: payload.vaultID || "vlt_personal",
      ...payload
    };
  } catch (err) {
    console.error("Failed to decrypt item:", rawItem.id, err);
    return {
      id: rawItem.id,
      name: rawItem.name || "Decryption Failed",
      type: rawItem.type || "login",
      url: "",
      username: "Decryption Mismatch",
      strength: "weak",
      updatedAt: "Error",
      timeGroup: "Older",
      created: "",
      modified: "",
      lastAutofill: "Never",
      itemID: rawItem.id,
      shareID: "shr_" + rawItem.id,
      vaultID: "vlt_personal",
      noteText: "Unable to decrypt this item. It was encrypted with a different master password or key."
    };
  }
}

const TRASH_VAULT_ID = "vlt_trash";

async function syncVaultItemToBackend(item: VaultItem): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const userId = getStorage().getItem("x-user-id");
  if (!userId) return false;

  const key = await getClientEncryptionKey();
  if (!key) return false;

  try {
    const encrypted = await encryptVaultItem(item, key);
    const res = await fetch(`${CONFIG.API_URL}/api/vault`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-id": userId,
        "session-token": getStorage().getItem("session-token") || ""
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
    return res.ok;
  } catch (err) {
    console.error("[syncVaultItemToBackend] error:", err);
    return false;
  }
}

async function decryptSharedItem(rawItem: any, privateKeyString: string): Promise<VaultItem> {
  try {
    const decryptedJson = await decryptSharedData(
      rawItem.ciphertext,
      rawItem.iv,
      rawItem.authTag,
      rawItem.encryptedKey,
      privateKeyString
    );
    const payload = JSON.parse(decryptedJson);
    return {
      id: rawItem.id,
      name: rawItem.name,
      type: rawItem.type,
      strength: "strong",
      updatedAt: `Shared by ${rawItem.senderEmail}`,
      timeGroup: "Last week",
      created: "Synced",
      modified: "Synced",
      lastAutofill: "Never",
      itemID: rawItem.id,
      shareID: "shr_" + rawItem.id,
      vaultID: "vlt_shared",
      sharedBy: rawItem.senderEmail,
      isReceivedShare: true,
      ...payload
    };
  } catch (err) {
    console.error("Failed to decrypt shared item:", rawItem.id, err);
    return {
      id: rawItem.id,
      name: rawItem.name || "Decryption Failed",
      type: rawItem.type || "login",
      url: "",
      username: "Decryption Mismatch",
      strength: "weak",
      updatedAt: "Error",
      timeGroup: "Older",
      created: "",
      modified: "",
      lastAutofill: "Never",
      itemID: rawItem.id,
      shareID: "shr_" + rawItem.id,
      vaultID: "vlt_shared",
      noteText: "Unable to decrypt this shared item."
    };
  }
}


function DashboardPageContent() {
  const { toast, confirm } = useToast();
  const localStorage = getStorage();
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isVaultLoading, setIsVaultLoading] = useState(false);
  const [authStep, setAuthStep] = useState<"checking" | "loading-pass" | "signing-in" | "decrypting" | "ready" | "unauthorized">("checking");

  const [profileName, setProfileName] = useState<string>("User");
  const [profileEmail, setProfileEmail] = useState<string>(() => (typeof window !== "undefined" ? getStorage().getItem("user-email") || "" : ""));
  const [profilePlan, setProfilePlan] = useState<string>("starter");

  const getInitials = (name: string) => {
    if (!name || name.trim() === "") return "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  useEffect(() => {
    async function loadVault() {
      if (typeof window === "undefined") return;
      const storage = getStorage();
      const userId = storage.getItem("x-user-id");
      const sessionToken = storage.getItem("session-token");
      const keyHex = getMasterKeyHex();
      
      if (!userId || userId === "undefined" || !sessionToken || !keyHex) {
        setAuthStep("unauthorized");
        router.push("/login");
        return;
      }

      // Set to loading state immediately while fetching vault
      setAuthStep("loading-pass");

      setIsVaultLoading(true);
      try {
        const res = await fetch(`${CONFIG.API_URL}/api/vault`, {
          headers: {
            "x-user-id": userId,
            "session-token": sessionToken || ""
          }
        });
        if (!res.ok) {
          throw new Error("Failed to fetch vault items");
        }
        const data = await res.json();
        
        const encryptionKey = await getClientEncryptionKey();
        if (!encryptionKey) {
          setAuthStep("unauthorized");
          router.push("/login");
          return;
        }
        if (encryptionKey && data.items && data.items.length > 0) {
          const decryptedItems = await Promise.all(
            data.items.map(async (rawItem: any) => {
              return await decryptVaultItem(rawItem, encryptionKey);
            })
          );
          setItemsList(decryptedItems);
          if (decryptedItems.length > 0) {
            setSelectedItem(
              decryptedItems.find((i) => i.vaultID !== TRASH_VAULT_ID) ?? decryptedItems[0]
            );
          }
          // Load attachments list
          try {
            const atts = await fetchAttachmentsList(encryptionKey);
            setAttachments(atts);
          } catch (attErr) {
            console.error("Failed to load attachments:", attErr);
          }
        } else if (!encryptionKey) {
          console.warn("No encryption key in session storage. Operating in local sandbox view mode.");
          setItemsList([]);
        } else {
          // Empty vault
          setItemsList([]);
        }
      } catch (err) {
        console.error("API loading failed. Running in fallback mode.", err);
        setItemsList([]);
      } finally {
        setIsVaultLoading(false);
      }

      // Initialize sharing keys
      let activePrivKey = "";
      try {
        const keysRes = await fetch(`${CONFIG.API_URL}/api/user/keys`, {
          headers: {
            "x-user-id": userId,
            "session-token": sessionToken || ""
          }
        });
        if (keysRes.ok) {
          const keysData = await keysRes.json();
          const encryptionKey = await getClientEncryptionKey();
          if (encryptionKey) {
            if (keysData.keys && keysData.keys.publicKey && keysData.keys.encryptedPrivateKey) {
              try {
                const decryptedPrivKey = await decryptData(
                  keysData.keys.encryptedPrivateKey,
                  keysData.keys.privateKeyIv || keysData.keys.iv,
                  keysData.keys.privateKeyAuthTag || keysData.keys.authTag,
                  encryptionKey
                );
                activePrivKey = decryptedPrivKey;
                setSharingPrivateKey(decryptedPrivKey);
              } catch (decErr) {
                console.error("Failed to decrypt sharing private key", decErr);
              }
            } else {
              const keyPair = await generateSharingKeyPair();
              const encryptedPriv = await encryptData(keyPair.privateKey, encryptionKey);
              
              await fetch(`${CONFIG.API_URL}/api/user/keys`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-user-id": userId,
                  "session-token": sessionToken || ""
                },
                body: JSON.stringify({
                  publicKey: keyPair.publicKey,
                  encryptedPrivateKey: encryptedPriv.ciphertext,
                  iv: encryptedPriv.iv,
                  authTag: encryptedPriv.authTag
                })
              });
              activePrivKey = keyPair.privateKey;
              setSharingPrivateKey(keyPair.privateKey);
            }
          }
        }
      } catch (err) {
        console.error("Failed to initialize sharing keys:", err);
      }

      // Load shared items
      try {
        const sentRes = await fetch(`${CONFIG.API_URL}/api/shares/sent`, {
          headers: {
            "x-user-id": userId,
            "session-token": sessionToken || ""
          }
        });
        const receivedRes = await fetch(`${CONFIG.API_URL}/api/shares/received`, {
          headers: {
            "x-user-id": userId,
            "session-token": sessionToken || ""
          }
        });
        
        let sentItems: VaultItem[] = [];
        let receivedItems: VaultItem[] = [];

        if (sentRes.ok) {
          const sentData = await sentRes.json();
          if (sentData.items) {
            sentItems = sentData.items.map((item: any) => ({
              id: item.id,
              name: item.name,
              type: item.type,
              url: "",
              strength: "strong" as const,
              updatedAt: `Shared with ${item.receiverEmail}`,
              timeGroup: "Last week" as const,
              created: "Shared",
              modified: "Shared",
              lastAutofill: "Never",
              itemID: item.id,
              shareID: "shr_" + item.id,
              vaultID: "vlt_shared",
              receiverEmail: item.receiverEmail,
              isSentShare: true,
              username: "Shared Item",
              noteText: `You shared this item with ${item.receiverEmail}.`
            }));
          }
        }

        if (receivedRes.ok) {
          const receivedData = await receivedRes.json();
          if (receivedData.items && activePrivKey) {
            const decryptedReceived = await Promise.all(
              receivedData.items.map(async (rawItem: any) => {
                return await decryptSharedItem(rawItem, activePrivKey);
              })
            );
            receivedItems = decryptedReceived;
          }
        }

        setSharedItemsList([...sentItems, ...receivedItems]);
      } catch (err) {
        console.error("Failed to load shared items:", err);
      }

      // Load user profile details
      try {
        const profileRes = await fetch(`${CONFIG.API_URL}/api/user/profile`, {
          headers: {
            "x-user-id": userId,
            "session-token": sessionToken || ""
          }
        });
        if (profileRes.ok) {
          const profileData = await profileRes.ok ? await profileRes.json() : null;
          if (profileData) {
            setProfileName(profileData.name || "User");
            setProfileEmail(profileData.email || getStorage().getItem("user-email") || "");
            setProfilePlan(profileData.plan || "starter");
          }
        } else {
          const storedEmail = getStorage().getItem("user-email") || "";
          setProfileEmail(storedEmail);
          if (storedEmail) {
            const prefix = storedEmail.split("@")[0];
            setProfileName(prefix.charAt(0).toUpperCase() + prefix.slice(1));
          }
        }
      } catch (err) {
        console.error("Failed to load profile in dashboard:", err);
        const storedEmail = getStorage().getItem("user-email") || "";
        setProfileEmail(storedEmail);
        if (storedEmail) {
          const prefix = storedEmail.split("@")[0];
          setProfileName(prefix.charAt(0).toUpperCase() + prefix.slice(1));
        }
      }

      setAuthStep("ready");
    }
    loadVault();
  }, [router]);

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      clearSession();
      sessionStorage.removeItem("verify-pending-email");
      router.push("/login");
    }
  };
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [customVaults, setCustomVaults] = useState<{ name: string; id: string }[]>([
    { name: "Work", id: "vlt_work" },
    { name: "Finance", id: "vlt_finance" }
  ]);
  
  const [showPassword, setShowPassword] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "recent">("all");
  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [totpSeconds, setTotpSeconds] = useState(18);

  // Popover menu and slide-in drawer state
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<string | null>(null);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [currentView, setCurrentView] = useState<"vault" | "profile" | "documents">("vault");
  const [activeMobilePane, setActiveMobilePane] = useState<"sidebar" | "list" | "details">("list");
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");

  useEffect(() => {
    if (categoryParam) {
      setSelectedCategory(categoryParam);
      setCurrentView("vault");
    }
  }, [categoryParam]);

  const createVaultParam = searchParams.get("createVault");
  useEffect(() => {
    if (createVaultParam === "true") {
      setIsAddVaultModalOpen(true);
      // Clean the search parameter from URL
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("createVault");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, [createVaultParam]);

  const newLoginParam = searchParams.get("action");
  const selectItemParam = searchParams.get("select");

  const [isAddVaultModalOpen, setIsAddVaultModalOpen] = useState(false);
  const [newVaultName, setNewVaultName] = useState("");
  const [newVaultError, setNewVaultError] = useState("");

  // Sharing Feature State
  const [sharingPrivateKey, setSharingPrivateKey] = useState<string | null>(null);
  const [sharedItemsList, setSharedItemsList] = useState<VaultItem[]>([]);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState("");
  const [shareError, setShareError] = useState("");
  const [shareSuccess, setShareSuccess] = useState("");
  const [isSharingLoading, setIsSharingLoading] = useState(false);

  // Form fields state (Login / standard)
  const [formTitle, setFormTitle] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formTotp, setFormTotp] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formUrls, setFormUrls] = useState<string[]>([""]);
  const [formVaultId, setFormVaultId] = useState("vlt_personal");
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [drawerItemId, setDrawerItemId] = useState<string>("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDrawerUploading, setIsDrawerUploading] = useState(false);
  const [drawerUploadProgress, setDrawerUploadProgress] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formError, setFormError] = useState("");

  // Card-specific form states
  const [cardName, setCardName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [cardPin, setCardPin] = useState("");

  // Alias-specific form states
  const [aliasForwardTo, setAliasForwardTo] = useState("infonowshad@proton.me");
  const [aliasSuffix, setAliasSuffix] = useState("reanalyze433");

  // Identity-specific form states
  const [identityFirstName, setIdentityFirstName] = useState("");
  const [identityLastName, setIdentityLastName] = useState("");
  const [identityGender, setIdentityGender] = useState("");
  const [identityBirthDate, setIdentityBirthDate] = useState("");
  const [identityPhone, setIdentityPhone] = useState("");
  const [identityEmail, setIdentityEmail] = useState("");
  const [identityAddress, setIdentityAddress] = useState("");
  const [identityCity, setIdentityCity] = useState("");
  const [identityState, setIdentityState] = useState("");
  const [identityZip, setIdentityZip] = useState("");
  const [identityCountry, setIdentityCountry] = useState("");
  const [identitySsn, setIdentitySsn] = useState("");
  const [identityPassport, setIdentityPassport] = useState("");

  // Passkey-specific form states
  const [passkeyRelyingParty, setPasskeyRelyingParty] = useState("");
  const [passkeyUserName, setPasskeyUserName] = useState("");
  const [passkeyCredentialId, setPasskeyCredentialId] = useState("");
  const [passkeyPublicKey, setPasskeyPublicKey] = useState("");
  const [passkeyPrivateKey, setPasskeyPrivateKey] = useState("");
  const [showPasskeyPrivateKey, setShowPasskeyPrivateKey] = useState(false);

  // Password Generator states
  const [genType, setGenType] = useState<"random" | "memorizable">("random");
  const [genLength, setGenLength] = useState(16);
  const [genIncludeNumbers, setGenIncludeNumbers] = useState(true);
  const [genIncludeSymbols, setGenIncludeSymbols] = useState(true);
  const [genIncludeUppercase, setGenIncludeUppercase] = useState(true);
  const [genWordSeparator, setGenWordSeparator] = useState("-");
  const [genCapitalizeWords, setGenCapitalizeWords] = useState(true);
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(true);

  const generatePassword = () => {
    if (genType === "random") {
      const lowercase = "abcdefghijklmnopqrstuvwxyz";
      const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const numbers = "0123456789";
      const symbols = "!@#$%^&*()_+-=[]{}|;:,.<>?";
      
      let pool = lowercase;
      if (genIncludeUppercase) pool += uppercase;
      if (genIncludeNumbers) pool += numbers;
      if (genIncludeSymbols) pool += symbols;
      
      if (!pool) return;
      
      let result = "";
      const guaranteed: string[] = [];
      if (genIncludeUppercase) guaranteed.push(uppercase[Math.floor(Math.random() * uppercase.length)]);
      if (genIncludeNumbers) guaranteed.push(numbers[Math.floor(Math.random() * numbers.length)]);
      if (genIncludeSymbols) guaranteed.push(symbols[Math.floor(Math.random() * symbols.length)]);
      guaranteed.push(lowercase[Math.floor(Math.random() * lowercase.length)]);
      
      for (let i = 0; i < genLength; i++) {
        if (i < guaranteed.length) {
          result += guaranteed[i];
        } else {
          result += pool.charAt(Math.floor(Math.random() * pool.length));
        }
      }
      
      const shuffled = result.split('').sort(() => 0.5 - Math.random()).join('');
      setGeneratedPassword(shuffled);
    } else {
      const wordsPool = [
        "apple", "banana", "cherry", "orange", "grape", "melon", "peach", "berry", "lemon", "lime",
        "forest", "river", "mountain", "valley", "ocean", "desert", "cloud", "storm", "wind", "rain",
        "shadow", "light", "spark", "ember", "flame", "frost", "winter", "summer", "spring", "autumn",
        "rabbit", "falcon", "panther", "badger", "coyote", "dolphin", "otter", "koala", "panda", "tiger",
        "castle", "temple", "bridge", "tower", "palace", "cabin", "garden", "meadow", "island", "canyon"
      ];
      
      let words: string[] = [];
      const actualCount = genLength > 10 ? 4 : genLength;
      for (let i = 0; i < actualCount; i++) {
        let wd = wordsPool[Math.floor(Math.random() * wordsPool.length)];
        if (genCapitalizeWords) {
          wd = wd.charAt(0).toUpperCase() + wd.slice(1);
        }
        words.push(wd);
      }
      
      let password = words.join(genWordSeparator);
      if (genIncludeNumbers) {
        password += Math.floor(Math.random() * 100);
      }
      setGeneratedPassword(password);
    }
  };

  useEffect(() => {
    if (drawerType === "Password Generator") {
      generatePassword();
    }
  }, [genType, genLength, genIncludeNumbers, genIncludeSymbols, genIncludeUppercase, genWordSeparator, genCapitalizeWords, drawerType]);

  const renderColorCodedPassword = (password: string) => {
    return password.split("").map((char, index) => {
      if (/[0-9]/.test(char)) {
        return <span key={index} className="text-violet-600 font-bold">{char}</span>;
      } else if (/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(char)) {
        return <span key={index} className="text-emerald-600 font-bold">{char}</span>;
      } else {
        return <span key={index} className="text-slate-800 font-semibold">{char}</span>;
      }
    });
  };

  const [currentOtp, setCurrentOtp] = useState("000000");


  const [itemsList, setItemsList] = useState<VaultItem[]>([]);

  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);

  useEffect(() => {
    if (itemsList.length > 0 && !selectedItem) {
      setSelectedItem(
        itemsList.find((i) => i.vaultID !== TRASH_VAULT_ID) ?? itemsList[0]
      );
    }
  }, [itemsList, selectedItem]);

  const handleCopy = (value: string, id: string) => {
    navigator.clipboard.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleAddVault = () => {
    setNewVaultName("");
    setNewVaultError("");
    setIsAddVaultModalOpen(true);
  };

  const handleOpenDrawer = (type: string) => {
    setDrawerType(type);
    setIsDrawerOpen(true);
    setIsCreateMenuOpen(false);
    
    const newId = "item_" + Math.random().toString(36).substring(2, 11);
    setDrawerItemId(newId);
    
    // Reset login fields
    setFormTitle("");
    setFormUsername("");
    setFormPassword("");
    setFormTotp("");
    setFormUrl("");
    setFormNote("");
    setFormError("");

    // Reset card fields
    setCardName("");
    setCardNumber("");
    setCardExpiry("");
    setCardCvv("");
    setCardPin("");

    // Reset alias fields
    setAliasForwardTo("infonowshad@proton.me");
    setAliasSuffix("reanalyze" + Math.floor(100 + Math.random() * 900));

    // Reset identity fields
    setIdentityFirstName("");
    setIdentityLastName("");
    setIdentityGender("");
    setIdentityBirthDate("");
    setIdentityPhone("");
    setIdentityEmail("");
    setIdentityAddress("");
    setIdentityCity("");
    setIdentityState("");
    setIdentityZip("");
    setIdentityCountry("");
    setIdentitySsn("");
    setIdentityPassport("");

    // Reset passkey fields
    setPasskeyRelyingParty("");
    setPasskeyUserName("");
    setPasskeyCredentialId("");
    setPasskeyPublicKey("");
    setPasskeyPrivateKey("");
    setShowPasskeyPrivateKey(false);

    if (type === "Passkey") {
      generatePasskeyCredentialPair().then((pair) => {
        setPasskeyCredentialId(pair.credentialId);
        setPasskeyPublicKey(pair.publicKey);
        setPasskeyPrivateKey(pair.privateKey);
      });
    }
  };

  useEffect(() => {
    if (newLoginParam !== "newLogin") return;
    setCurrentView("vault");
    handleOpenDrawer("Login");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("action");
      window.history.replaceState({}, "", url.toString());
    }
  }, [newLoginParam]);

  useEffect(() => {
    if (!selectItemParam || itemsList.length === 0) return;
    const item = itemsList.find((i) => i.id === selectItemParam);
    if (!item) return;
    setSelectedItem(item);
    setCurrentView("vault");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("select");
      window.history.replaceState({}, "", url.toString());
    }
  }, [selectItemParam, itemsList]);

  const handleGeneratePassword = () => {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
    let pass = "";
    for (let i = 0; i < 16; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormPassword(pass);
  };

  const handleShareItem = async () => {
    if (!shareEmail.trim()) {
      setShareError("Please enter an email address");
      return;
    }
    if (!activeItem) return;

    setIsSharingLoading(true);
    setShareError("");
    setShareSuccess("");

    try {
      const pubKeyRes = await fetch(
        `${CONFIG.API_URL}/api/user/public-key?email=${encodeURIComponent(shareEmail.trim())}`,
        {
          headers: {
            "x-user-id": getStorage().getItem("x-user-id") || "",
            "session-token": getStorage().getItem("session-token") || ""
          }
        }
      );

      if (!pubKeyRes.ok) {
        const errData = await pubKeyRes.json();
        throw new Error(errData.error || "Recipient email not found or recipient has not generated sharing keys");
      }

      const { userId: receiverId, publicKey: receiverPublicKey } = await pubKeyRes.json();

      const encryptionKey = await getClientEncryptionKey();
      if (!encryptionKey) {
        throw new Error("Local encryption key not found. Please log in again.");
      }

      const payload = {
        url: activeItem.url || "",
        username: activeItem.username || "",
        password: activeItem.password || "",
        totp: activeItem.totp || "",
        cardholderName: activeItem.cardholderName || "",
        cardNumber: activeItem.cardNumber || "",
        expirationDate: activeItem.expirationDate || "",
        cvv: activeItem.cvv || "",
        pin: activeItem.pin || "",
        noteText: activeItem.noteText || "",
        aliasEmail: activeItem.aliasEmail || "",
        forwardTo: activeItem.forwardTo || "",
        identityFirstName: activeItem.identityFirstName || "",
        identityLastName: activeItem.identityLastName || "",
        identityGender: activeItem.identityGender || "",
        identityBirthDate: activeItem.identityBirthDate || "",
        identityPhone: activeItem.identityPhone || "",
        identityEmail: activeItem.identityEmail || "",
        identityAddress: activeItem.identityAddress || "",
        identityCity: activeItem.identityCity || "",
        identityState: activeItem.identityState || "",
        identityZip: activeItem.identityZip || "",
        identityCountry: activeItem.identityCountry || "",
        identitySsn: activeItem.identitySsn || "",
        identityPassport: activeItem.identityPassport || "",
        urls: activeItem.urls || [],
        itemID: activeItem.itemID || activeItem.id,
        shareID: activeItem.shareID || "shr_" + activeItem.id,
        vaultID: "vlt_shared"
      };

      const plaintext = JSON.stringify(payload);
      const encryptedShare = await encryptSharedData(plaintext, receiverPublicKey);

      const shareRes = await fetch(`${CONFIG.API_URL}/api/shares`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": getStorage().getItem("x-user-id") || "",
          "session-token": getStorage().getItem("session-token") || ""
        },
        body: JSON.stringify({
          receiverId,
          type: activeItem.type || "login",
          name: activeItem.name,
          ciphertext: encryptedShare.ciphertext,
          encryptedKey: encryptedShare.encryptedKey,
          iv: encryptedShare.iv,
          authTag: encryptedShare.authTag
        })
      });

      if (!shareRes.ok) {
        throw new Error("Failed to share vault item with server");
      }

      setShareSuccess(`Successfully shared "${activeItem.name}" with ${shareEmail}`);
      
      const newItem = {
        id: "sh_" + Math.random().toString(36).substr(2, 9),
        name: activeItem.name,
        type: activeItem.type || "login",
        url: activeItem.url || "",
        strength: "strong" as const,
        updatedAt: `Shared with ${shareEmail}`,
        timeGroup: "Last week" as const,
        created: "Shared",
        modified: "Shared",
        lastAutofill: "Never",
        itemID: activeItem.id,
        shareID: "shr_" + activeItem.id,
        vaultID: "vlt_shared",
        receiverEmail: shareEmail,
        isSentShare: true,
        username: "Shared Item",
        noteText: `You shared this item with ${shareEmail}.`
      };
      setSharedItemsList(prev => [newItem as VaultItem, ...prev]);
      setShareEmail("");

      setTimeout(() => {
        setIsShareModalOpen(false);
        setShareSuccess("");
      }, 2000);

    } catch (err: any) {
      setShareError(err.message || "An error occurred during sharing");
    } finally {
      setIsSharingLoading(false);
    }
  };

  const handleEditItem = (item: VaultItem) => {
    setEditingItem(item);
    setDrawerItemId(item.id);
    setFormTitle(item.name);
    setFormUsername(item.username);
    setFormPassword(item.password || "");
    setFormTotp(item.totp || "");
    setFormUrls(item.urls && item.urls.length > 0 ? item.urls : [item.url || ""]);
    setFormNote(item.noteText || "");
    
    if (item.type === "card") {
      setDrawerType("Card");
      setCardName(item.cardholderName || "");
      setCardNumber(item.cardNumber || "");
      setCardExpiry(item.expirationDate || "");
      setCardCvv(item.cvv || "");
      setCardPin(item.pin || "");
    } else if (item.type === "alias") {
      setDrawerType("Alias");
      setAliasForwardTo(item.forwardTo || "");
    } else if (item.type === "note") {
      setDrawerType("Note");
    } else if (item.type === "identity") {
      setDrawerType("Identity");
      setIdentityFirstName(item.identityFirstName || "");
      setIdentityLastName(item.identityLastName || "");
      setIdentityGender(item.identityGender || "");
      setIdentityBirthDate(item.identityBirthDate || "");
      setIdentityPhone(item.identityPhone || "");
      setIdentityEmail(item.identityEmail || "");
      setIdentityAddress(item.identityAddress || "");
      setIdentityCity(item.identityCity || "");
      setIdentityState(item.identityState || "");
      setIdentityZip(item.identityZip || "");
      setIdentityCountry(item.identityCountry || "");
      setIdentitySsn(item.identitySsn || "");
      setIdentityPassport(item.identityPassport || "");
    } else if (item.type === "passkey") {
      setDrawerType("Passkey");
      setPasskeyRelyingParty(item.passkeyRelyingParty || "");
      setPasskeyUserName(item.passkeyUserName || "");
      setPasskeyCredentialId(item.passkeyCredentialId || "");
      setPasskeyPublicKey(item.passkeyPublicKey || "");
      setPasskeyPrivateKey(item.passkeyPrivateKey || "");
      setShowPasskeyPrivateKey(false);
    } else {
      setDrawerType("Login");
    }
    
    setIsDrawerOpen(true);
  };

  const handleSaveItem = () => {
    if (!formTitle.trim()) {
      setFormError("Title is required");
      return;
    }
    setFormError("");

    const itemId = drawerItemId || (editingItem ? editingItem.id : "item_" + Math.random().toString(36).substring(2, 11));
    let newItem: VaultItem;

    const currentVaultId = getVaultId(selectedCategory === "all" ? "personal" : selectedCategory);

    if (drawerType === "Card") {
      newItem = {
        id: itemId,
        name: formTitle.trim(),
        url: "",
        username: cardName.trim() || "Cardholder",
        strength: "strong",
        updatedAt: "Just now",
        timeGroup: editingItem ? editingItem.timeGroup : "Last week",
        created: editingItem ? editingItem.created : "Just now",
        modified: "Just now",
        lastAutofill: editingItem ? editingItem.lastAutofill : "Never",
        itemID: editingItem ? editingItem.itemID : itemId,
        shareID: editingItem ? editingItem.shareID : "shr_" + itemId,
        vaultID: editingItem ? editingItem.vaultID : currentVaultId,
        type: "card",
        cardholderName: cardName.trim(),
        cardNumber: cardNumber.trim() || "1234 1234 1234 1234",
        expirationDate: cardExpiry.trim() || "MM/YY",
        cvv: cardCvv.trim() || "123",
        pin: cardPin.trim() || "1234",
        noteText: formNote.trim()
      };
    } else if (drawerType === "Alias") {
      const cleanPrefix = formTitle.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || "alias";
      const generatedEmail = editingItem && editingItem.username ? editingItem.username : `${cleanPrefix}.${aliasSuffix}@vivagopass.com`;
      newItem = {
        id: itemId,
        name: formTitle.trim(),
        url: "",
        username: generatedEmail,
        strength: "strong",
        updatedAt: "Just now",
        timeGroup: editingItem ? editingItem.timeGroup : "Last week",
        created: editingItem ? editingItem.created : "Just now",
        modified: "Just now",
        lastAutofill: editingItem ? editingItem.lastAutofill : "Never",
        itemID: editingItem ? editingItem.itemID : itemId,
        shareID: editingItem ? editingItem.shareID : "shr_" + itemId,
        vaultID: editingItem ? editingItem.vaultID : currentVaultId,
        type: "alias",
        aliasEmail: generatedEmail,
        forwardTo: aliasForwardTo,
        noteText: formNote.trim()
      };
    } else if (drawerType === "Note") {
      newItem = {
        id: itemId,
        name: formTitle.trim(),
        url: "",
        username: "Secure Note",
        strength: "strong",
        updatedAt: "Just now",
        timeGroup: editingItem ? editingItem.timeGroup : "Last week",
        created: editingItem ? editingItem.created : "Just now",
        modified: "Just now",
        lastAutofill: editingItem ? editingItem.lastAutofill : "Never",
        itemID: editingItem ? editingItem.itemID : itemId,
        shareID: editingItem ? editingItem.shareID : "shr_" + itemId,
        vaultID: editingItem ? editingItem.vaultID : currentVaultId,
        type: "note",
        noteText: formNote.trim()
      };
    } else if (drawerType === "Identity") {
      newItem = {
        id: itemId,
        name: formTitle.trim(),
        url: "",
        username: `${identityFirstName} ${identityLastName}`.trim() || "Identity Profile",
        strength: "strong",
        updatedAt: "Just now",
        timeGroup: editingItem ? editingItem.timeGroup : "Last week",
        created: editingItem ? editingItem.created : "Just now",
        modified: "Just now",
        lastAutofill: editingItem ? editingItem.lastAutofill : "Never",
        itemID: editingItem ? editingItem.itemID : itemId,
        shareID: editingItem ? editingItem.shareID : "shr_" + itemId,
        vaultID: editingItem ? editingItem.vaultID : currentVaultId,
        type: "identity",
        identityFirstName,
        identityLastName,
        identityGender,
        identityBirthDate,
        identityPhone,
        identityEmail,
        identityAddress,
        identityCity,
        identityState,
        identityZip,
        identityCountry,
        identitySsn,
        identityPassport,
        noteText: formNote.trim()
      };
    } else if (drawerType === "Passkey") {
      const rp = passkeyRelyingParty.trim();
      const fallbackUrl = rp ? (rp.startsWith("http") ? rp : `https://${rp}`) : "";
      newItem = {
        id: itemId,
        name: formTitle.trim(),
        url: fallbackUrl,
        username: passkeyUserName.trim() || "passkey",
        strength: "strong",
        updatedAt: "Just now",
        timeGroup: editingItem ? editingItem.timeGroup : "Last week",
        created: editingItem ? editingItem.created : "Just now",
        modified: "Just now",
        lastAutofill: editingItem ? editingItem.lastAutofill : "Never",
        itemID: editingItem ? editingItem.itemID : itemId,
        shareID: editingItem ? editingItem.shareID : "shr_" + itemId,
        vaultID: editingItem ? editingItem.vaultID : currentVaultId,
        type: "passkey",
        passkeyRelyingParty: rp,
        passkeyUserName: passkeyUserName.trim(),
        passkeyCredentialId: passkeyCredentialId.trim(),
        passkeyPublicKey: passkeyPublicKey,
        passkeyPrivateKey: passkeyPrivateKey,
        noteText: formNote.trim()
      };
    } else {
      newItem = {
        id: itemId,
        name: formTitle.trim(),
        url: formUrls.filter(Boolean)[0] || "https://",
        urls: formUrls.filter(Boolean),
        username: formUsername.trim() || "username",
        password: formPassword,
        strength: formPassword.length > 8 ? "strong" : "fair",
        updatedAt: "Just now",
        timeGroup: editingItem ? editingItem.timeGroup : "Last week",
        totp: formTotp.trim() || undefined,
        created: editingItem ? editingItem.created : "Just now",
        modified: "Just now",
        lastAutofill: editingItem ? editingItem.lastAutofill : "Never",
        itemID: editingItem ? editingItem.itemID : itemId,
        shareID: editingItem ? editingItem.shareID : "shr_" + itemId,
        vaultID: editingItem ? editingItem.vaultID : currentVaultId,
        type: "login",
        noteText: formNote.trim()
      };
    }

    if (editingItem) {
      setItemsList(itemsList.map(item => item.id === editingItem.id ? newItem : item));
      setEditingItem(null);
    } else {
      setItemsList([newItem, ...itemsList]);
    }
    
    setSelectedItem(newItem);

    // Sync to database backend using ZKA client encryption
    const saveToBackend = async (item: VaultItem) => {
      if (typeof window === "undefined") return;
      const userId = getStorage().getItem("x-user-id");
      if (!userId) {
        console.error("[saveToBackend] No x-user-id in storage. Cannot sync to server.");
        return;
      }
      
      const key = await getClientEncryptionKey();
      if (!key) {
        console.error("[saveToBackend] No encryption key in sessionStorage. Did you log in properly?");
        return;
      }
      
      try {
        const encrypted = await encryptVaultItem(item, key);
        const res = await fetch(`${CONFIG.API_URL}/api/vault`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-id": userId,
            "session-token": getStorage().getItem("session-token") || ""
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
          const errBody = await res.text();
          console.error("[saveToBackend] Server returned", res.status, errBody);
        } else {
          console.log("[saveToBackend] Item synced successfully:", item.id);
        }
      } catch (err) {
        console.error("[saveToBackend] Network/sync error:", err);
      }
    };
    saveToBackend(newItem);
    
    // Reset and close drawer
    setDrawerItemId("");
    setFormTitle("");
    setFormUsername("");
    setFormPassword("");
    setFormTotp("");
    setFormUrl("");
    setFormUrls([""]);
    setFormNote("");
    setCardName("");
    setCardNumber("");
    setCardExpiry("");
    setCardCvv("");
    setCardPin("");
    
    // Reset identity fields
    setIdentityFirstName("");
    setIdentityLastName("");
    setIdentityGender("");
    setIdentityBirthDate("");
    setIdentityPhone("");
    setIdentityEmail("");
    setIdentityAddress("");
    setIdentityCity("");
    setIdentityState("");
    setIdentityZip("");
    setIdentityCountry("");
    setIdentitySsn("");
    setIdentityPassport("");

    // Reset passkey fields
    setPasskeyRelyingParty("");
    setPasskeyUserName("");
    setPasskeyCredentialId("");
    setPasskeyPublicKey("");
    setPasskeyPrivateKey("");
    setShowPasskeyPrivateKey(false);

    setIsDrawerOpen(false);
    setDrawerType(null);
  };

  const deleteVaultItemOnServer = async (id: string): Promise<boolean> => {
    const userId = getStorage().getItem("x-user-id");
    if (!userId) return false;
    try {
      const res = await fetch(`${CONFIG.API_URL}/api/vault/${id}`, {
        method: "DELETE",
        headers: {
          "x-user-id": userId,
          "session-token": getStorage().getItem("session-token") || ""
        }
      });
      if (!res.ok) {
        console.error("Failed to delete vault item from server:", id);
        return false;
      }
      return true;
    } catch (err) {
      console.error("Delete sync error:", err);
      return false;
    }
  };

  const permanentlyRemoveItemsFromState = (ids: Set<string>) => {
    const updatedItems = itemsList.filter((item) => !ids.has(item.id));
    const updatedShared = sharedItemsList.filter((item) => !ids.has(item.id));
    setItemsList(updatedItems);
    setSharedItemsList(updatedShared);
    if (selectedItem && ids.has(selectedItem.id)) {
      const nextPool = selectedCategory === "shared" ? updatedShared : updatedItems;
      setSelectedItem(nextPool[0] || null);
    }
  };

  const moveItemsToTrashInState = (ids: Set<string>) => {
    setItemsList((prev) => {
      const next = prev.map((item) =>
        ids.has(item.id)
          ? { ...item, vaultID: TRASH_VAULT_ID, modified: "Trashed", updatedAt: "Trashed" }
          : item
      );
      if (selectedItem && ids.has(selectedItem.id)) {
        const visible = next.filter((i) => i.vaultID !== TRASH_VAULT_ID);
        setSelectedItem(visible[0] || null);
      }
      return next;
    });
  };

  const moveItemToTrashOnServer = async (item: VaultItem): Promise<boolean> => {
    const trashed: VaultItem = {
      ...item,
      vaultID: TRASH_VAULT_ID,
      modified: "Trashed",
      updatedAt: "Trashed"
    };
    return syncVaultItemToBackend(trashed);
  };

  const findVaultItemById = (id: string): VaultItem | undefined =>
    itemsList.find((i) => i.id === id) ?? sharedItemsList.find((i) => i.id === id);

  const isPermanentDeleteContext = (item: VaultItem) =>
    selectedCategory === "trash" || item.vaultID === TRASH_VAULT_ID;

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const toggleItemSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteItem = async (id: string) => {
    if (typeof window === "undefined") return;
    const item = findVaultItemById(id);
    if (!item) return;

    const permanent = isPermanentDeleteContext(item) || selectedCategory === "shared";

    const confirmed = await confirm(
      permanent
        ? "Permanently delete this item? This cannot be undone."
        : "Move this item to Trash?",
      {
        title: permanent ? "Delete Permanently" : "Move to Trash",
        confirmText: permanent ? "Delete forever" : "Move to trash",
        cancelText: "Cancel",
        type: "danger"
      }
    );
    if (!confirmed) return;

    if (permanent) {
      const ok = await deleteVaultItemOnServer(id);
      if (!ok) {
        toast.error("Could not delete item on the server.");
        return;
      }
      permanentlyRemoveItemsFromState(new Set([id]));
      toast.success("Item permanently deleted.");
    } else {
      const ok = await moveItemToTrashOnServer(item);
      if (!ok) {
        toast.error("Could not move item to trash.");
        return;
      }
      moveItemsToTrashInState(new Set([id]));
      toast.success("Moved to trash.");
    }
  };

  const handleBulkDeleteItems = async () => {
    if (selectedIds.size === 0 || typeof window === "undefined") return;
    const count = selectedIds.size;
    const ids = Array.from(selectedIds);
    const items = ids.map((id) => findVaultItemById(id)).filter((i): i is VaultItem => !!i);
    const permanent =
      selectedCategory === "trash" ||
      selectedCategory === "shared" ||
      (items.length > 0 && items.every((i) => isPermanentDeleteContext(i)));

    const confirmed = await confirm(
      permanent
        ? `Permanently delete ${count} selected item${count === 1 ? "" : "s"}? This cannot be undone.`
        : `Move ${count} selected item${count === 1 ? "" : "s"} to Trash?`,
      {
        title: permanent ? "Delete Permanently" : "Move to Trash",
        confirmText: permanent ? `Delete ${count}` : "Move to trash",
        cancelText: "Cancel",
        type: "danger"
      }
    );
    if (!confirmed) return;

    setIsBulkDeleting(true);
    let failed = 0;

    if (permanent) {
      for (const id of ids) {
        const ok = await deleteVaultItemOnServer(id);
        if (!ok) failed += 1;
      }
      permanentlyRemoveItemsFromState(new Set(ids));
    } else {
      for (const item of items) {
        const ok = await moveItemToTrashOnServer(item);
        if (!ok) failed += 1;
      }
      moveItemsToTrashInState(new Set(items.map((i) => i.id)));
    }

    exitSelectMode();
    setIsBulkDeleting(false);

    if (failed > 0) {
      toast.error(`${failed} item(s) failed.`);
    } else if (permanent) {
      toast.success(`Deleted ${count - failed} item${count - failed === 1 ? "" : "s"}.`);
    } else {
      toast.success(`Moved ${count - failed} item${count - failed === 1 ? "" : "s"} to trash.`);
    }
  };

  // Filter vault items based on search term and category
  const baseItemsList = selectedCategory === "shared" ? sharedItemsList : itemsList;

  const filteredItems = baseItemsList.filter((item) => {
    // Filter by tab
    if (activeTab === "recent" && item.timeGroup !== "Last week") {
      return false;
    }

    // Trash items only appear in Trash view
    if (selectedCategory === "all" && item.vaultID === TRASH_VAULT_ID) {
      return false;
    }

    // Filter by vault category using vaultID
    if (selectedCategory !== "all" && selectedCategory !== "shared") {
      const targetVaultId = getVaultId(selectedCategory);
      if (item.vaultID !== targetVaultId) {
        return false;
      }
    }
    
    // Filter by search
    if (searchTerm.trim() !== "") {
      return item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
             (item.username && item.username.toLowerCase().includes(searchTerm.toLowerCase())) ||
             (item.url && item.url.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return true;
  });

  const activeItem =
    selectedItem &&
    baseItemsList.some((i) => i.id === selectedItem.id) &&
    filteredItems.some((i) => i.id === selectedItem.id)
      ? selectedItem
      : filteredItems[0] || null;

  const allFilteredSelected =
    filteredItems.length > 0 && filteredItems.every((item) => selectedIds.has(item.id));

  const handleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((item) => item.id)));
    }
  };

  const filteredItemIdKey = useMemo(
    () => filteredItems.map((i) => i.id).join("\0"),
    [filteredItems]
  );

  useEffect(() => {
    setSelectedIds((prev) => {
      const visible = new Set(filteredItemIdKey ? filteredItemIdKey.split("\0") : []);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredItemIdKey]);

  useEffect(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, [selectedCategory]);

  // Real TOTP countdown timer and calculator
  useEffect(() => {
    const updateTotp = async () => {
      const epoch = Math.floor(Date.now() / 1000);
      const secondsRemaining = 30 - (epoch % 30);
      setTotpSeconds(secondsRemaining);

      if (activeItem?.totp) {
        const otp = await generateTOTP(activeItem.totp);
        setCurrentOtp(otp);
      } else {
        setCurrentOtp("000000");
      }
    };

    updateTotp();
    const timer = setInterval(updateTotp, 1000);
    return () => clearInterval(timer);
  }, [activeItem?.totp]);

  // Group items by time group
  const timeGroups: { [key: string]: VaultItem[] } = {
    "Last week": [],
    "Last 2 weeks": [],
    "Older": []
  };
  filteredItems.forEach((item) => {
    if (timeGroups[item.timeGroup]) {
      timeGroups[item.timeGroup].push(item);
    } else {
      timeGroups["Older"].push(item);
    }
  });

  if (authStep !== "ready") {
    if (authStep === "unauthorized") {
      return (
        <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 text-slate-800 font-sans">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-slate-200 border-t-indigo-600"></div>
            <p className="text-sm font-medium text-slate-500">Redirecting to login...</p>
          </div>
        </div>
      );
    }
    if (authStep === "checking") {
      return (
        <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 text-slate-800 font-sans">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-slate-200 border-t-indigo-600"></div>
            <p className="text-sm font-medium text-slate-500">Securing environment...</p>
          </div>
        </div>
      );
    }

    return (
      <main className="relative flex min-h-screen w-full flex-col items-center justify-center bg-[#fafbfc] overflow-hidden font-sans text-slate-800">
        {/* Soft, modern ambient light gradients in background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
          <div className="absolute -top-[30%] -left-[20%] w-[60%] h-[60%] rounded-full bg-blue-100/30 blur-[130px] md:blur-[180px]" />
          <div className="absolute -bottom-[30%] -right-[20%] w-[60%] h-[60%] rounded-full bg-indigo-100/30 blur-[130px] md:blur-[180px]" />
          <div className="absolute top-[20%] right-[10%] w-[50%] h-[50%] rounded-full bg-purple-100/20 blur-[130px] md:blur-[180px]" />
        </div>

        {/* Center content container */}
        <div className="relative z-10 flex flex-col items-center justify-center px-4 max-w-sm w-full text-center">
          {/* Minimalist Circular Spinner */}
          <div className="w-7 h-7 rounded-full border-[2.5px] border-slate-200 border-t-indigo-600 animate-spin mb-4" />

          {/* Dynamic Status Text */}
          <p className="text-[13px] font-bold tracking-wide text-slate-500/90 uppercase animate-pulse">
            {authStep === "loading-pass" && "Loading Vivago Pass"}
            {authStep === "signing-in" && "Signing in"}
            {authStep === "decrypting" && "Decrypting your data"}
          </p>
        </div>
      </main>
    );
  }

  const handleDrawerAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (!filesList || filesList.length === 0) return;
    const file = filesList[0];
    
    // Strict validations (No zip, no videos, max 10MB)
    const nameLower = file.name.toLowerCase();
    const isZip = 
      file.type === "application/zip" || 
      file.type === "application/x-zip-compressed" || 
      file.type === "application/zip-compressed" ||
      nameLower.endsWith(".zip") ||
      nameLower.endsWith(".rar") ||
      nameLower.endsWith(".7z") ||
      nameLower.endsWith(".tar") ||
      nameLower.endsWith(".gz") ||
      nameLower.endsWith(".bz2") ||
      nameLower.endsWith(".xz");

    const isVideo = 
      file.type.startsWith("video/") || 
      nameLower.endsWith(".mp4") || 
      nameLower.endsWith(".mov") || 
      nameLower.endsWith(".avi") || 
      nameLower.endsWith(".mkv") || 
      nameLower.endsWith(".webm") || 
      nameLower.endsWith(".3gp") ||
      nameLower.endsWith(".flv") ||
      nameLower.endsWith(".wmv") ||
      nameLower.endsWith(".m4v") ||
      nameLower.endsWith(".mpg") ||
      nameLower.endsWith(".mpeg") ||
      nameLower.endsWith(".ogv");
    
    if (isZip) {
      toast.warning("ZIP/compressed archives are strictly prohibited.");
      e.target.value = "";
      return;
    }
    if (isVideo) {
      toast.warning("Video files are strictly prohibited.");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.warning("File exceeds the maximum allowed size of 10MB.");
      e.target.value = "";
      return;
    }

    const key = await getClientEncryptionKey();
    if (!key) {
      toast.error("Encryption key not found. Please log in again.");
      return;
    }

    setIsDrawerUploading(true);
    setDrawerUploadProgress("Encrypting and uploading file...");
    try {
      const att = await uploadAttachmentFile(file, drawerItemId, key);
      setAttachments(prev => [att, ...prev]);
      toast.success("Attachment uploaded successfully!");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload file attachment.");
    } finally {
      setIsDrawerUploading(false);
      setDrawerUploadProgress("");
      e.target.value = "";
    }
  };

  const handleDeleteDrawerAttachment = async (id: string) => {
    const confirmed = await confirm("Are you sure you want to delete this attachment?", {
      title: "Delete Attachment",
      confirmText: "Delete",
      cancelText: "Cancel",
      type: "danger"
    });
    if (!confirmed) return;
    try {
      await deleteAttachmentFile(id);
      setAttachments(prev => prev.filter(att => att.id !== id));
      toast.success("Attachment deleted successfully.");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete attachment.");
    }
  };

  const handleDownloadAttachment = async (att: Attachment) => {
    const key = await getClientEncryptionKey();
    if (!key) return;
    try {
      const { blob, metadata } = await downloadAttachmentFile(att, key);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = metadata.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Failed to decrypt or download attachment.");
    }
  };

  const renderDrawerAttachmentSection = () => {
    const itemAttachments = attachments.filter(att => att.vaultItemId === drawerItemId);

    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 space-y-4 hover:bg-slate-50/30 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="text-slate-400">
              <Paperclip className="w-5 h-5" />
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-800 block">Attachments</label>
              <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">Upload secure files linked to this item.</span>
            </div>
          </div>
          {isDrawerUploading ? (
            <div className="flex items-center gap-1.5 text-amber-600 text-[10px] font-bold">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Uploading...</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-indigo-600 text-[10px] font-bold shadow-sm">
              <Sparkles className="w-3 h-3 text-indigo-500" />
              <span>Max 10MB</span>
            </div>
          )}
        </div>

        {/* Existing attachments list */}
        {itemAttachments.length > 0 && (
          <div className="vivago-scrollbar space-y-2 max-h-48 overflow-y-auto pr-1">
            {itemAttachments.map((att) => {
              const filename = att.decryptedMetadata?.name || "Encrypted File";
              return (
                <div key={att.id} className="flex items-center justify-between bg-slate-50 hover:bg-slate-100 p-2.5 rounded-xl border border-slate-200/50 transition-colors">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Paperclip className="w-4.5 h-4.5 text-slate-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-slate-700 truncate" title={filename}>
                        {filename}
                      </p>
                      <span className="text-[9px] text-slate-400 font-semibold block">
                        {att.fileSize ? (att.fileSize / 1024 / 1024).toFixed(2) + " MB" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDownloadAttachment(att)}
                      className="p-1.5 rounded-lg hover:bg-white border border-transparent hover:border-slate-200 text-slate-550 hover:text-slate-700 transition-all shadow-sm"
                      title="Download & Decrypt"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDrawerAttachment(att.id)}
                      className="p-1.5 rounded-lg hover:bg-rose-50 border border-transparent hover:border-rose-200 text-slate-550 hover:text-rose-650 transition-all shadow-sm"
                      title="Delete attachment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* File chooser button */}
        <label className="w-full py-3 px-4 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 font-bold text-xs rounded-xl shadow-sm flex items-center justify-center gap-1.5 transition-all active:scale-[0.98] cursor-pointer">
          <input
            type="file"
            onChange={handleDrawerAttachmentUpload}
            className="hidden"
            disabled={isDrawerUploading}
          />
          <span>Choose a file to attach</span>
        </label>
      </div>
    );
  };

  return (
    <div className="flex h-dvh w-full max-w-[100vw] bg-[#f8fafc] overflow-hidden font-sans text-slate-800 antialiased">
      {/* 1. Sidebar (Left Column) */}
      <Sidebar 
        currentView={currentView}
        selectedCategory={selectedCategory}
        activeMobilePane={activeMobilePane}
        setActiveMobilePane={setActiveMobilePane}
        onAddVault={() => setIsAddVaultModalOpen(true)}
      />

      {currentView === "profile" ? (
        <ProfileView 
          onClose={() => setCurrentView("vault")} 
          onProfileUpdate={(newVal) => setProfileName(newVal)}
        />
      ) : currentView === "documents" ? (
        <DocumentsView 
          onClose={() => setCurrentView("vault")}
        />
      ) : (
        <div className="flex flex-1 min-w-0 min-h-0 h-full overflow-hidden">
          {/* 2. Middle Column: Grouped Items List */}
          <section className={`w-full md:w-80 lg:w-[400px] border-r border-slate-200/80 bg-white flex flex-col h-full min-h-0 min-w-0 overflow-hidden shrink-0 ${activeMobilePane === "list" ? "flex" : "hidden"} md:flex`}>
        <header className="p-4 border-b border-slate-100 flex flex-col gap-3 relative">
          {/* Top Search bar */}
          <div className="relative flex items-center gap-2">
            <button 
              onClick={() => setActiveMobilePane("sidebar")}
              className="md:hidden p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 bg-slate-50/50 transition-colors"
              title="Show Menu"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
            <div className="relative flex-1 flex items-center">
              <Search className="absolute left-2.5 w-3.5 h-3.5 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search items..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 text-xs bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
              />
            </div>
          </div>

          {/* Tabs Filter (All / Recent) */}
          <div className="flex items-center justify-between mt-1">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab("all")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                  activeTab === "all"
                    ? "bg-slate-100 text-slate-800 shadow-sm"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                All ({filteredItems.length})
              </button>
              <button
                onClick={() => setActiveTab("recent")}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${
                  activeTab === "recent"
                    ? "bg-slate-100 text-slate-800 shadow-sm"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Recent
              </button>
            </div>
            
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (isSelectMode) exitSelectMode();
                  else setIsSelectMode(true);
                }}
                className={`h-7 px-2.5 text-xs font-bold rounded-lg border flex items-center gap-1 transition-all ${
                  isSelectMode
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {isSelectMode ? "Done" : "Select"}
              </button>
            <div className="relative">
              <button 
                onClick={() => setIsCreateMenuOpen(!isCreateMenuOpen)}
                disabled={isSelectMode}
                className="h-7 px-3 text-xs font-bold rounded-lg border border-indigo-100 hover:bg-indigo-50 text-indigo-600 flex items-center gap-1 transition-all active:scale-95 shadow-sm bg-indigo-50/30 disabled:opacity-40"
              >
                <Plus className="w-3.5 h-3.5" /> Create
              </button>

              {/* Create Menu Dropdown List */}
              {isCreateMenuOpen && (
                <div className="absolute right-0 top-8 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-50 py-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
                  {[
                    { label: "Login", type: "login", desc: "Credentials and web logins" },
                    { label: "Passkey", type: "passkey", desc: "Third-party WebAuthn login" },
                    { label: "Alias", type: "alias", desc: "Private email forwarder" },
                    { label: "Card", type: "card", desc: "Credit / debit details" },
                    { label: "Note", type: "note", desc: "Secure text info" },
                    { label: "Identity", type: "identity", desc: "Personal profiles" },
                    { label: "Password Generator", type: "generator", desc: "Generate strong passwords" }
                  ].map((opt) => (
                    <button
                      key={opt.type}
                      onClick={() => handleOpenDrawer(opt.label)}
                      className="w-full text-left px-4 py-2 hover:bg-slate-50 transition-colors"
                    >
                      <span className="text-xs font-bold text-slate-800 block">{opt.label}</span>
                      <span className="text-[10px] text-slate-400 block mt-0.5 leading-snug">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            </div>
          </div>

          {isSelectMode && filteredItems.length > 0 && (
            <div className="flex items-center justify-between gap-2 px-0.5 py-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5"
              >
                {allFilteredSelected ? (
                  <CheckSquare className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
                {allFilteredSelected ? "Deselect all" : "Select all"}
              </button>
              <span className="text-[10px] font-semibold text-slate-400">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={handleBulkDeleteItems}
                disabled={selectedIds.size === 0 || isBulkDeleting}
                className="h-7 px-2.5 text-[11px] font-bold rounded-lg bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none"
              >
                <Trash2 className="w-3 h-3" />
                {isBulkDeleting
                  ? "Working…"
                  : selectedCategory === "trash"
                    ? "Delete"
                    : "Trash"}
              </button>
            </div>
          )}
        </header>

        {/* Scrollable list items with headers */}
        <div className="vivago-scrollbar flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-2 bg-slate-50/20 space-y-3.5">
          {filteredItems.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              No credentials found.
            </div>
          ) : (
            Object.keys(timeGroups).map((groupName) => {
              const itemsInGroup = timeGroups[groupName];
              if (itemsInGroup.length === 0) return null;

              return (
                <div key={groupName} className="space-y-1">
                  {/* Time Group Header */}
                  <div className="px-3 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {groupName}
                  </div>
                  
                  {/* Group items list */}
                  <div className="space-y-1">
                    {itemsInGroup.map((item) => {
                      const isActive = activeItem && activeItem.id === item.id;
                      const isChecked = selectedIds.has(item.id);
                      // Dynamic theme gradients for app avatar circles
                      const bgGradient = item.name.toLowerCase().includes("google")
                        ? "from-red-500 to-amber-500"
                        : item.name.toLowerCase().includes("github")
                        ? "from-slate-700 to-slate-900"
                        : item.name.toLowerCase().includes("figma")
                        ? "from-purple-500 to-pink-500"
                        : item.name.toLowerCase().includes("card")
                        ? "from-emerald-500 to-teal-500"
                        : item.type === "alias"
                        ? "from-violet-500 to-fuchsia-600"
                        : item.type === "note"
                        ? "from-amber-400 to-orange-500"
                        : item.type === "identity"
                        ? "from-sky-500 to-indigo-500"
                        : item.type === "passkey"
                        ? "from-rose-500 to-pink-600"
                        : "from-indigo-500 to-blue-500";

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (isSelectMode) {
                              toggleItemSelection(item.id);
                              return;
                            }
                            setSelectedItem(item);
                            setShowPassword(false);
                            setShowCardNumber(false);
                            setActiveMobilePane("details");
                          }}
                          className={`w-full text-left px-3.5 py-3 rounded-xl flex items-center gap-3 transition-all ${
                            isSelectMode && isChecked
                              ? "bg-indigo-50 border border-indigo-200/80 text-slate-800"
                              : isActive && !isSelectMode
                              ? "bg-gray-600 text-white shadow-md shadow-indigo-400/10" 
                              : "hover:bg-slate-100/60 text-slate-700 border border-transparent"
                          }`}
                        >
                          {isSelectMode && (
                            <span
                              className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-md border ${
                                isChecked
                                  ? "bg-indigo-600 border-indigo-600 text-white"
                                  : "bg-white border-slate-300 text-transparent"
                              }`}
                              aria-hidden
                            >
                              <CheckSquare className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-extrabold text-sm shrink-0 shadow-sm ${
                            isActive && !isSelectMode
                              ? "bg-white/20 text-white"
                              : `bg-gradient-to-tr ${bgGradient} text-white`
                          }`}>
                            {item.type === "card" ? (
                              <CreditCard className="w-4 h-4 text-white" />
                            ) : item.type === "alias" ? (
                              <Glasses className="w-4 h-4 text-white" />
                            ) : item.type === "note" ? (
                              <FileText className="w-4 h-4 text-white" />
                            ) : item.type === "identity" ? (
                              <User className="w-4 h-4 text-white" />
                            ) : item.type === "passkey" ? (
                              <Key className="w-4 h-4 text-white" />
                            ) : (
                              item.name.charAt(0)
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className={`text-xs font-bold truncate leading-snug ${isActive && !isSelectMode ? "text-white" : "text-slate-800"}`}>
                              {item.name}
                            </h4>
                            <p className={`text-[11px] font-medium truncate mt-0.5 ${isActive && !isSelectMode ? "text-indigo-200" : "text-slate-400"}`}>
                              {item.type === "card" 
                                ? "Secure Card Details" 
                                : item.type === "alias" 
                                ? "Email Alias" 
                                : item.type === "note" 
                                ? "Secure Note" 
                                : item.type === "identity" 
                                ? "Personal Profile" 
                                : item.type === "passkey"
                                ? `Passkey (${item.passkeyRelyingParty || "WebAuthn"})`
                                : item.username}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 3. Right Column: Selected Item Details Pane or Slide-in Drawer */}
      <section className={`flex-1 min-w-0 min-h-0 h-full bg-[#f8fafc]/50 flex flex-col relative overflow-hidden ${activeMobilePane === "details" ? "flex" : "hidden"} md:flex`}>
        {/* Scrollable details container */}
        <div
          className={`vivago-scrollbar flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 md:p-10 ${
            isDrawerOpen ? "hidden" : ""
          }`}
        >
          {activeItem ? (
            <div className="max-w-4xl w-full mx-auto space-y-6">
              
              {/* Unified Professional Credentials Sheet */}
              <div className="bg-white rounded-2xl border border-slate-200/50 shadow-sm overflow-hidden divide-y divide-slate-100">
                
                {/* Card Header Profile Block */}
                <div className="p-6 flex items-center justify-between gap-4 bg-slate-50/40">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => setActiveMobilePane("list")}
                      className="md:hidden px-3 py-1.5 rounded-lg border border-slate-200 text-slate-655 hover:text-slate-850 hover:bg-slate-50 bg-white transition-all font-bold text-xs shadow-sm flex items-center justify-center gap-1"
                      title="Back to list"
                    >
                      ← Back
                    </button>
                    <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100/40 flex items-center justify-center font-black text-indigo-600 text-xl shadow-sm">
                      {activeItem.type === "card" ? (
                        <CreditCard className="w-6 h-6 text-indigo-600" />
                      ) : activeItem.type === "alias" ? (
                        <Glasses className="w-6 h-6 text-indigo-600" />
                      ) : activeItem.type === "note" ? (
                        <FileText className="w-6 h-6 text-indigo-600" />
                      ) : activeItem.type === "identity" ? (
                        <User className="w-6 h-6 text-indigo-600" />
                      ) : (
                        activeItem.name.charAt(0)
                      )}
                    </div>
                    <div>
                      <h1 className="text-lg font-bold text-slate-900 leading-snug">{activeItem.name}</h1>
                      {activeItem.type !== "card" && activeItem.type !== "alias" && activeItem.type !== "note" && activeItem.type !== "identity" && (activeItem.urls && activeItem.urls.length > 0 ? activeItem.urls[0] : activeItem.url) && (
                        <a 
                          href={activeItem.urls && activeItem.urls.length > 0 ? activeItem.urls[0] : activeItem.url} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-xs font-semibold text-indigo-650 hover:text-indigo-800 flex items-center gap-1 mt-1.5 hover:underline"
                        >
                          {activeItem.urls && activeItem.urls.length > 0 ? activeItem.urls[0] : activeItem.url} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {activeItem.type === "card" && (
                        <span className="text-xs font-semibold text-slate-500 block mt-1.5">Secure Credit / Debit Card</span>
                      )}
                      {activeItem.type === "alias" && (
                        <span className="text-xs font-semibold text-slate-500 block mt-1.5">Secure Email Alias Forwarder</span>
                      )}
                      {activeItem.type === "note" && (
                        <span className="text-xs font-semibold text-slate-500 block mt-1.5">Secure Zero-Knowledge Note</span>
                      )}
                      {activeItem.type === "identity" && (
                        <span className="text-xs font-semibold text-slate-500 block mt-1.5">Secure Personal Profile Identity</span>
                      )}
                    </div>
                  </div>

                  {/* Edit & Settings Action Panel */}
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => handleEditItem(activeItem)}
                      className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-650 transition-colors"
                      title="Edit item"
                    >
                      <Edit2 className="w-4.5 h-4.5" />
                    </button>
                    {!activeItem.isReceivedShare && (
                      <button 
                        onClick={() => {
                          setShareEmail("");
                          setShareError("");
                          setShareSuccess("");
                          setIsShareModalOpen(true);
                        }}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-650 transition-colors"
                        title="Share item with user email"
                      >
                        <Share2 className="w-4.5 h-4.5" />
                      </button>
                    )}
                    <button 
                      onClick={() => handleDeleteItem(activeItem.id)}
                      className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-650 transition-colors"
                      title={
                        activeItem.vaultID === TRASH_VAULT_ID || selectedCategory === "trash"
                          ? "Delete permanently"
                          : "Move to trash"
                      }
                    >
                      <Trash2 className="w-4.5 h-4.5" />
                    </button>
                  </div>
                </div>

                {/* Conditional fields based on item type */}
                {activeItem.type === "card" ? (
                  <>
                    {/* Cardholder Name */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <User className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Name on card</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.cardholderName}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.cardholderName || "", activeItem.id + "_cardname")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_cardname" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>

                    {/* Card Number */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <CreditCard className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Card number</span>
                          <span className="text-xs md:text-sm font-mono font-bold text-slate-800 mt-0.5 block tracking-wider">
                            {showCardNumber ? activeItem.cardNumber : "•••• •••• •••• " + (activeItem.cardNumber?.slice(-4) || "1234")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setShowCardNumber(!showCardNumber)}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {showCardNumber ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button 
                          onClick={() => handleCopy(activeItem.cardNumber || "", activeItem.id + "_cardnum")}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {copiedId === activeItem.id + "_cardnum" ? (
                            <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-4.5 h-4.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expiration Date */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <Calendar className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Expiration date</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block">{activeItem.expirationDate}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.expirationDate || "", activeItem.id + "_cardexpiry")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_cardexpiry" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>

                    {/* Security Code (CVV) & PIN side-by-side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <CreditCard className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Security code (CVV)</span>
                            <span className="text-xs md:text-sm font-mono font-bold text-slate-800 mt-0.5 block">•••</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleCopy(activeItem.cvv || "", activeItem.id + "_cvv")}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {copiedId === activeItem.id + "_cvv" ? (
                            <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-4.5 h-4.5" />
                          )}
                        </button>
                      </div>

                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-center gap-3 pl-0 md:pl-2">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <Hash className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">PIN</span>
                            <span className="text-xs md:text-sm font-mono font-bold text-slate-800 mt-0.5 block">••••</span>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleCopy(activeItem.pin || "", activeItem.id + "_pin")}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {copiedId === activeItem.id + "_pin" ? (
                            <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-4.5 h-4.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                ) : activeItem.type === "passkey" ? (
                  <>
                    {/* Relying Party / Domain */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <Globe className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Relying Party (Domain)</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.passkeyRelyingParty}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.passkeyRelyingParty || "", activeItem.id + "_rp")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_rp" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>

                    {/* Username */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <User className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Username / Account</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.passkeyUserName}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.passkeyUserName || "", activeItem.id + "_username")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_username" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>

                    {/* Credential ID */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <Hash className="w-4.5 h-4.5" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Credential ID</span>
                          <span className="text-xs font-mono text-slate-700 mt-0.5 block truncate max-w-[200px] md:max-w-md select-all" title={activeItem.passkeyCredentialId}>
                            {activeItem.passkeyCredentialId}
                          </span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.passkeyCredentialId || "", activeItem.id + "_credid")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_credid" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>

                    {/* Keypair Section */}
                    <div className="p-5 hover:bg-slate-50/30 transition-colors space-y-4">
                      <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 pb-2">
                        <span>WebAuthn Cryptographic Keys</span>
                        <Key className="w-4 h-4 text-slate-400" />
                      </div>

                      {/* Public Key Display */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Public Key (JWK)</span>
                          <button 
                            onClick={() => handleCopy(activeItem.passkeyPublicKey || "", activeItem.id + "_pubkey")}
                            className="text-[9px] font-bold text-indigo-650 hover:text-indigo-800 flex items-center gap-0.5"
                          >
                            <Copy className="w-3 h-3" /> Copy Public Key
                          </button>
                        </div>
                        <pre className="bg-slate-50 p-3 rounded-xl border border-slate-200/50 text-[10px] font-mono text-slate-600 overflow-x-auto max-h-32">
                          {activeItem.passkeyPublicKey}
                        </pre>
                      </div>

                      {/* Private Key Display */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Private Key (JWK)</span>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setShowPasskeyPrivateKey(!showPasskeyPrivateKey)}
                              className="text-[9px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-0.5"
                            >
                              {showPasskeyPrivateKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              {showPasskeyPrivateKey ? "Hide" : "Reveal"}
                            </button>
                            <button 
                              onClick={() => handleCopy(activeItem.passkeyPrivateKey || "", activeItem.id + "_privkey")}
                              className="text-[9px] font-bold text-indigo-650 hover:text-indigo-800 flex items-center gap-0.5"
                            >
                              <Copy className="w-3 h-3" /> Copy Private Key
                            </button>
                          </div>
                        </div>
                        <pre className="bg-slate-50 p-3 rounded-xl border border-slate-200/50 text-[10px] font-mono text-slate-600 overflow-x-auto max-h-32">
                          {showPasskeyPrivateKey ? activeItem.passkeyPrivateKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                        </pre>
                      </div>
                    </div>
                  </>
                ) : activeItem.type === "alias" ? (
                  <>
                    {/* Alias Email */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <Glasses className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Alias email address</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.aliasEmail}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.aliasEmail || "", activeItem.id + "_aliasemail")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_aliasemail" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>

                    {/* Forwards to */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <CornerUpRight className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Forwards to</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.forwardTo}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.forwardTo || "", activeItem.id + "_forwardto")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_forwardto" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>
                  </>
                ) : activeItem.type === "note" ? (
                  <>
                    {/* Note Content display */}
                    <div className="p-6 bg-amber-50/10 leading-relaxed text-xs md:text-sm font-medium text-slate-800 space-y-4">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                        <FileText className="w-4 h-4 text-slate-400" />
                        <span>Note Content</span>
                      </div>
                      <div className="whitespace-pre-line bg-white p-5 rounded-2xl border border-slate-200/50 shadow-sm font-semibold min-h-[160px] text-slate-700 leading-relaxed">
                        {activeItem.noteText || "No note content recorded."}
                      </div>
                    </div>
                  </>
                ) : activeItem.type === "identity" ? (
                  <>
                    {/* Name block */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <User className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">First Name</span>
                            <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.identityFirstName || "—"}</span>
                          </div>
                        </div>
                        {activeItem.identityFirstName && (
                          <button 
                            onClick={() => handleCopy(activeItem.identityFirstName || "", activeItem.id + "_idfirst")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {copiedId === activeItem.id + "_idfirst" ? <CheckCircle className="w-4.5 h-4.5 text-emerald-600" /> : <Copy className="w-4.5 h-4.5" />}
                          </button>
                        )}
                      </div>
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors pl-0 md:pl-2">
                        <div className="flex items-center gap-3 pl-0 md:pl-2">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <User className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Last Name</span>
                            <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.identityLastName || "—"}</span>
                          </div>
                        </div>
                        {activeItem.identityLastName && (
                          <button 
                            onClick={() => handleCopy(activeItem.identityLastName || "", activeItem.id + "_idlast")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {copiedId === activeItem.id + "_idlast" ? <CheckCircle className="w-4.5 h-4.5 text-emerald-600" /> : <Copy className="w-4.5 h-4.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Gender & BirthDate */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-t border-slate-100">
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <User className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Gender</span>
                            <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block">{activeItem.identityGender || "—"}</span>
                          </div>
                        </div>
                      </div>
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors pl-0 md:pl-2">
                        <div className="flex items-center gap-3 pl-0 md:pl-2">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <Calendar className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Birth Date</span>
                            <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block">{activeItem.identityBirthDate || "—"}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Contact Phone & Email */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-t border-slate-100">
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <Phone className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Phone</span>
                            <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.identityPhone || "—"}</span>
                          </div>
                        </div>
                        {activeItem.identityPhone && (
                          <button 
                            onClick={() => handleCopy(activeItem.identityPhone || "", activeItem.id + "_idphone")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {copiedId === activeItem.id + "_idphone" ? <CheckCircle className="w-4.5 h-4.5 text-emerald-600" /> : <Copy className="w-4.5 h-4.5" />}
                          </button>
                        )}
                      </div>
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors pl-0 md:pl-2">
                        <div className="flex items-center gap-3 pl-0 md:pl-2">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <Mail className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Email</span>
                            <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.identityEmail || "—"}</span>
                          </div>
                        </div>
                        {activeItem.identityEmail && (
                          <button 
                            onClick={() => handleCopy(activeItem.identityEmail || "", activeItem.id + "_idemail")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {copiedId === activeItem.id + "_idemail" ? <CheckCircle className="w-4.5 h-4.5 text-emerald-600" /> : <Copy className="w-4.5 h-4.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Address Block */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors border-t border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <MapPin className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Address</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">
                            {[activeItem.identityAddress, activeItem.identityCity, activeItem.identityState, activeItem.identityZip, activeItem.identityCountry].filter(Boolean).join(", ") || "—"}
                          </span>
                        </div>
                      </div>
                      {([activeItem.identityAddress, activeItem.identityCity, activeItem.identityState, activeItem.identityZip, activeItem.identityCountry].filter(Boolean).length > 0) && (
                        <button 
                          onClick={() => handleCopy([activeItem.identityAddress, activeItem.identityCity, activeItem.identityState, activeItem.identityZip, activeItem.identityCountry].filter(Boolean).join(", "), activeItem.id + "_idaddr")}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {copiedId === activeItem.id + "_idaddr" ? <CheckCircle className="w-4.5 h-4.5 text-emerald-600" /> : <Copy className="w-4.5 h-4.5" />}
                        </button>
                      )}
                    </div>

                    {/* SSN & Passport */}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 border-t border-slate-100">
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <Shield className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">ID / SSN</span>
                            <span className="text-xs md:text-sm font-mono font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.identitySsn || "—"}</span>
                          </div>
                        </div>
                        {activeItem.identitySsn && (
                          <button 
                            onClick={() => handleCopy(activeItem.identitySsn || "", activeItem.id + "_idssn")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {copiedId === activeItem.id + "_idssn" ? <CheckCircle className="w-4.5 h-4.5 text-emerald-600" /> : <Copy className="w-4.5 h-4.5" />}
                          </button>
                        )}
                      </div>
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors pl-0 md:pl-2">
                        <div className="flex items-center gap-3 pl-0 md:pl-2">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <FileText className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Passport Number</span>
                            <span className="text-xs md:text-sm font-mono font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.identityPassport || "—"}</span>
                          </div>
                        </div>
                        {activeItem.identityPassport && (
                          <button 
                            onClick={() => handleCopy(activeItem.identityPassport || "", activeItem.id + "_idpass")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {copiedId === activeItem.id + "_idpass" ? <CheckCircle className="w-4.5 h-4.5 text-emerald-600" /> : <Copy className="w-4.5 h-4.5" />}
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Card Field 1: Email Box */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <User className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Email / Username</span>
                          <span className="text-xs md:text-sm font-semibold text-slate-800 mt-0.5 block select-all">{activeItem.username}</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => handleCopy(activeItem.username, activeItem.id + "_user")}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {copiedId === activeItem.id + "_user" ? (
                          <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-4.5 h-4.5" />
                        )}
                      </button>
                    </div>

                    {/* Card Field 2: Password Box */}
                    <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                          <LockKeyhole className="w-4.5 h-4.5" />
                        </div>
                        <div>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Password</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs md:text-sm font-mono font-bold text-slate-800 tracking-wider">
                              {showPassword ? (activeItem.password || "") : "••••••••••••••"}
                            </span>
                            <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded uppercase tracking-wider">
                              Strong
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button 
                          onClick={() => setShowPassword(!showPassword)}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {showPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 0 0 1 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/></svg>
                          )}
                        </button>
                        <button 
                          onClick={() => handleCopy(activeItem.password || "", activeItem.id + "_pass")}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {copiedId === activeItem.id + "_pass" ? (
                            <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                          ) : (
                            <Copy className="w-4.5 h-4.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Card Field 3: 2FA Token (TOTP) Box */}
                    {activeItem.totp && (
                      <div className="p-5 flex items-center justify-between gap-4 hover:bg-slate-50/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm">
                            <Clock className="w-4.5 h-4.5" />
                          </div>
                          <div>
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">2FA Token (TOTP)</span>
                            <div className="flex flex-col mt-0.5">
                              <span className="text-sm md:text-base font-extrabold text-indigo-600 tracking-wider block">
                                {currentOtp.slice(0, 3)} {currentOtp.slice(3)}
                              </span>
                              <span className="text-[9px] text-slate-450 font-mono select-all truncate max-w-[180px]" title={activeItem.totp}>
                                Key: {activeItem.totp}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {/* Countdown Ring Indicator */}
                          <div className="relative w-7 h-7 flex items-center justify-center">
                            <svg className="w-full h-full transform -rotate-90">
                              <circle
                                cx="14"
                                cy="14"
                                r="11"
                                stroke="#e2e8f0"
                                strokeWidth="2.5"
                                fill="transparent"
                              />
                              <circle
                                cx="14"
                                cy="14"
                                r="11"
                                stroke="#4f46e5"
                                strokeWidth="2.5"
                                fill="transparent"
                                strokeDasharray={2 * Math.PI * 11}
                                strokeDashoffset={2 * Math.PI * 11 * (1 - totpSeconds / 30)}
                                className="transition-all duration-1000 ease-linear"
                              />
                            </svg>
                            <span className="absolute text-[8px] font-bold text-slate-500">{totpSeconds}</span>
                          </div>
                          
                          <button 
                            onClick={() => handleCopy(currentOtp, activeItem.id + "_totp")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {copiedId === activeItem.id + "_totp" ? (
                              <CheckCircle className="w-4.5 h-4.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-4.5 h-4.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Card Field 4: Website Box */}
                    <div className="p-5 hover:bg-slate-50/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/40 flex items-center justify-center text-slate-500 shadow-sm mt-1 shrink-0">
                          <Globe className="w-4.5 h-4.5" />
                        </div>
                        <div className="flex-1 space-y-2">
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Websites</span>
                          {((activeItem.urls && activeItem.urls.length > 0) ? activeItem.urls : [activeItem.url || "https://"]).map((u, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 border-b border-slate-100/50 pb-1.5 last:border-0 last:pb-0">
                              <a 
                                href={u} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="text-xs md:text-sm font-semibold text-indigo-650 hover:text-indigo-805 hover:underline truncate max-w-[240px] md:max-w-sm block"
                              >
                                {u}
                              </a>
                              <a 
                                href={u} 
                                target="_blank" 
                                rel="noreferrer" 
                                className="p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Field 5: Activity Logs Box */}
              <div className="bg-white rounded-2xl border border-slate-200/50 p-5 shadow-sm space-y-3.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 pb-2.5">
                  <span>Activity details</span>
                  <Clock className="w-4 h-4 text-slate-400" />
                </div>
                <div className="space-y-2.5 text-[11px] text-slate-500 font-semibold">
                  <div className="flex items-center justify-between">
                    <span>Last autofill</span>
                    <span className="text-slate-800 font-bold">{activeItem.lastAutofill}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Last modified</span>
                    <span className="text-slate-800 font-bold">{activeItem.modified}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Created</span>
                    <span className="text-slate-800 font-bold">{activeItem.created}</span>
                  </div>
                </div>
              </div>

              {/* Note / Description Box (For card note representation) */}
              {activeItem.noteText && activeItem.type !== "note" && (
                <div className="bg-white rounded-2xl border border-slate-200/50 p-5 shadow-sm space-y-3">
                  <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-slate-400" />
                    <span>Secure Note</span>
                  </div>
                  <p className="text-xs md:text-sm font-semibold text-slate-700 leading-relaxed whitespace-pre-line">{activeItem.noteText}</p>
                </div>
              )}

              {/* Linked Attachments Box */}
              {attachments.filter(att => att.vaultItemId === activeItem.id).length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200/50 p-5 shadow-sm space-y-3">
                  <div className="text-[11px] text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Paperclip className="w-4 h-4 text-slate-400" />
                      <span>Attached Secure Files</span>
                    </div>
                    <span className="text-[9px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
                      Zero-Knowledge Files
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {attachments.filter(att => att.vaultItemId === activeItem.id).map((att) => {
                      const filename = att.decryptedMetadata?.name || "Encrypted File";
                      return (
                        <div key={att.id} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50/50 border border-slate-150 hover:bg-slate-50 transition-all group">
                          <div className="min-w-0 flex-1 flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-white border border-slate-200/70 flex items-center justify-center text-slate-500 shadow-sm shrink-0">
                              <Paperclip className="w-4.5 h-4.5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-800 truncate" title={filename}>{filename}</p>
                              <span className="text-[9px] text-slate-400 font-semibold block mt-0.5">
                                {att.fileSize ? (att.fileSize / 1024 / 1024).toFixed(2) + " MB" : ""}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 ml-3">
                            <button
                              onClick={() => handleDownloadAttachment(att)}
                              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:text-indigo-650 hover:border-indigo-200 transition-all shadow-sm"
                              title="Download Decrypted File"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={async () => {
                                const confirmed = await confirm(`Are you sure you want to delete the file "${filename}"?`, {
                                  title: "Delete Attachment",
                                  confirmText: "Delete",
                                  cancelText: "Cancel",
                                  type: "danger"
                                });
                                if (confirmed) {
                                  try {
                                    await deleteAttachmentFile(att.id);
                                    setAttachments(prev => prev.filter(a => a.id !== att.id));
                                    toast.success("Attachment deleted.");
                                  } catch (err: any) {
                                    toast.error(err.message || "Failed to delete attachment.");
                                  }
                                }
                              }}
                              className="p-2 rounded-xl bg-white border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 transition-all shadow-sm"
                              title="Delete File"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Collapsible More Info Accordion */}
              <div className="bg-white rounded-2xl border border-slate-200/50 overflow-hidden shadow-sm">
                <button 
                  onClick={() => setShowMoreInfo(!showMoreInfo)}
                  className="w-full px-5 py-4 flex items-center justify-between bg-slate-50/30 hover:bg-slate-50/80 transition-colors text-xs font-bold text-slate-700"
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-4.5 h-4.5 text-slate-400" />
                    <span>More Info</span>
                  </div>
                  {showMoreInfo ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>

                {showMoreInfo && (
                  <div className="p-5 border-t border-slate-100 bg-white space-y-3.5 text-[11px] font-semibold text-slate-500">
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Item ID</span>
                      <span className="text-slate-800 block select-all font-mono break-all bg-slate-50 p-3 rounded-xl border border-slate-200/40 leading-normal">{activeItem.itemID}</span>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Share ID</span>
                      <span className="text-slate-800 block select-all font-mono break-all bg-slate-50 p-3 rounded-xl border border-slate-200/40 leading-normal">{activeItem.shareID}</span>
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Vault ID</span>
                      <span className="text-slate-800 block select-all font-mono break-all bg-slate-50 p-3 rounded-xl border border-slate-200/40 leading-normal">{activeItem.vaultID}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
              <Key className="w-8 h-8 text-slate-400 mb-2" />
              <h3 className="text-sm font-bold text-slate-700">No item selected</h3>
            </div>
          )}
        </div>

        {/* 4. Slide-in Drawer Container */}
        {isDrawerOpen && (
        <div 
          className="absolute inset-0 bg-[#f8fafc] border-l border-slate-200/80 z-40 flex flex-col overflow-hidden animate-slide-in-right"
        >
          {/* Drawer Form Header */}
          <div className="p-5 border-b border-slate-200/60 bg-white flex items-center justify-between shadow-sm shrink-0">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  setIsDrawerOpen(false);
                  setDrawerType(null);
                }}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
              <h2 className="text-sm font-bold text-slate-900">
                {drawerType === "Password Generator" ? "Password Generator" : `Create new ${drawerType?.toLowerCase()}`}
              </h2>
            </div>
            {drawerType === "Password Generator" ? (
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(generatedPassword);
                    setIsDrawerOpen(false);
                    setDrawerType(null);
                  }}
                  className="h-8 px-4 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-all shadow-sm shadow-rose-600/10 flex items-center justify-center gap-1.5"
                >
                  Copy and close
                </button>
                <button 
                  onClick={generatePassword}
                  className="p-1.5 rounded-lg hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 transition-all active:rotate-180 duration-300"
                  title="Regenerate password"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button 
                onClick={handleSaveItem}
                className="h-8 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-sm shadow-indigo-600/10"
              >
                Create {drawerType?.toLowerCase()}
              </button>
            )}
          </div>

          {/* Scrollable Form Content */}
          <div className="vivago-scrollbar flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-6 md:p-8 space-y-6 max-w-2xl w-full mx-auto">
            {drawerType === "Card" ? (
              <div className="space-y-4">
                {/* Title Card Block */}
                <div className="border border-slate-200 focus-within:border-indigo-500 rounded-2xl p-4 bg-white shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
                  <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-1">Title</label>
                  <input 
                    type="text" 
                    placeholder="Untitled" 
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-slate-900 text-lg font-bold placeholder-slate-400 focus:ring-0 focus:outline-none"
                  />
                  {formError && (
                    <span className="text-[10px] text-red-500 font-bold block mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {formError}
                    </span>
                  )}
                </div>

                {/* Primary Card Fields Stack */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                  {/* Name on card */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Name on card</label>
                      <input 
                        type="text" 
                        placeholder="Full Name" 
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Card number */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Card number</label>
                      <input 
                        type="text" 
                        placeholder="1234 1234 1234 1234" 
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold font-mono placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Expiration date */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <Calendar className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Expiration date</label>
                      <input 
                        type="text" 
                        placeholder="MM/YY" 
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Security code */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <CreditCard className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Security code</label>
                      <input 
                        type="text" 
                        placeholder="123" 
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* PIN */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <Hash className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">PIN</label>
                      <input 
                        type="text" 
                        placeholder="1234" 
                        value={cardPin}
                        onChange={(e) => setCardPin(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold font-mono placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Note Block */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                  <div className="mt-1 text-slate-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Note</label>
                    <textarea 
                      placeholder="Add note" 
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      rows={3}
                      className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1 resize-none"
                    />
                  </div>
                </div>

                {/* Attachments Block */}
                {renderDrawerAttachmentSection()}
              </div>
            ) : drawerType === "Passkey" ? (
              <div className="space-y-4">
                {/* Title Block */}
                <div className="border border-slate-200 focus-within:border-indigo-500 rounded-2xl p-4 bg-white shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
                  <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-1">Title</label>
                  <input 
                    type="text" 
                    placeholder="Untitled Passkey" 
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-slate-900 text-lg font-bold placeholder-slate-400 focus:ring-0 focus:outline-none"
                  />
                  {formError && (
                    <span className="text-[10px] text-red-500 font-bold block mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {formError}
                    </span>
                  )}
                </div>

                {/* Primary Passkey Fields */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                  {/* Relying Party / Domain */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1.5 text-slate-400">
                      <Globe className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Relying Party (Domain)</label>
                      <input 
                        type="text" 
                        placeholder="e.g. facebook.com" 
                        value={passkeyRelyingParty}
                        onChange={(e) => setPasskeyRelyingParty(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Username / Account */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1.5 text-slate-400">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Username / Account Email</label>
                      <input 
                        type="text" 
                        placeholder="e.g. user@example.com" 
                        value={passkeyUserName}
                        onChange={(e) => setPasskeyUserName(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* WebAuthn Credentials */}
                <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <div className="flex items-center gap-1.5">
                      <Key className="w-4 h-4 text-indigo-600" />
                      <span className="text-[11px] text-slate-700 font-bold uppercase tracking-wider">WebAuthn Cryptographic Credentials</span>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const pair = await generatePasskeyCredentialPair();
                        setPasskeyCredentialId(pair.credentialId);
                        setPasskeyPublicKey(pair.publicKey);
                        setPasskeyPrivateKey(pair.privateKey);
                        toast.success("Regenerated WebAuthn keypair.");
                      }}
                      className="text-[10px] font-bold text-indigo-650 hover:text-indigo-800 flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" /> Regenerate Keypair
                    </button>
                  </div>

                  <div className="space-y-3">
                    {/* Credential ID */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Credential ID</label>
                      <input 
                        type="text" 
                        value={passkeyCredentialId}
                        onChange={(e) => setPasskeyCredentialId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200/60 rounded-xl p-2.5 text-xs font-mono text-slate-700 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                      />
                    </div>

                    {/* Public Key */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Public Key (JWK)</label>
                      <textarea 
                        readOnly
                        value={passkeyPublicKey}
                        rows={3}
                        className="w-full bg-slate-50 border border-slate-200/60 rounded-xl p-2.5 text-[10px] font-mono text-slate-600 focus:ring-0 focus:outline-none resize-none"
                      />
                    </div>

                    {/* Private Key */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Private Key (JWK)</label>
                        <button
                          type="button"
                          onClick={() => setShowPasskeyPrivateKey(!showPasskeyPrivateKey)}
                          className="text-[9px] font-bold text-slate-500 hover:text-slate-700 flex items-center gap-1"
                        >
                          {showPasskeyPrivateKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          {showPasskeyPrivateKey ? "Hide Private Key" : "Reveal Private Key"}
                        </button>
                      </div>
                      <textarea 
                        readOnly
                        value={showPasskeyPrivateKey ? passkeyPrivateKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                        rows={3}
                        className="w-full bg-slate-50 border border-slate-200/60 rounded-xl p-2.5 text-[10px] font-mono text-slate-600 focus:ring-0 focus:outline-none resize-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Note Block */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                  <div className="mt-1 text-slate-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Note</label>
                    <textarea 
                      placeholder="Add note" 
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      rows={3}
                      className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1 resize-none"
                    />
                  </div>
                </div>
              </div>
            ) : drawerType === "Alias" ? (
              <div className="space-y-4">
                {/* Title Card Block */}
                <div className="border border-slate-200 focus-within:border-indigo-500 rounded-2xl p-4 bg-white shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
                  <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-1">Title</label>
                  <input 
                    type="text" 
                    placeholder="Untitled" 
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-slate-900 text-lg font-bold placeholder-slate-400 focus:ring-0 focus:outline-none"
                  />
                  {formError && (
                    <span className="text-[10px] text-red-500 font-bold block mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {formError}
                    </span>
                  )}
                </div>

                {/* You are about to create Box */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                  <div className="mt-1 text-slate-400">
                    <Glasses className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">You are about to create</label>
                      <button className="text-slate-400 hover:text-slate-600 transition-colors" title="Alias Settings">
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <span className="text-xs md:text-sm font-semibold text-slate-800 mt-1 block break-all">
                      {(formTitle.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || "abcd")}.{aliasSuffix}@vivagopass.com
                    </span>
                  </div>
                </div>

                {/* Forwards to Box */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                  <div className="mt-1 text-slate-400">
                    <CornerUpRight className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Forwards to</label>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </div>
                    <input 
                      type="text" 
                      value={aliasForwardTo}
                      onChange={(e) => setAliasForwardTo(e.target.value)}
                      className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                    />
                  </div>
                </div>

                {/* Attachments Block */}
                {renderDrawerAttachmentSection()}

                {/* Note Block */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                  <div className="mt-1 text-slate-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Note</label>
                    <textarea 
                      placeholder="Enter a note..." 
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      rows={3}
                      className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1 resize-none"
                    />
                  </div>
                </div>
              </div>
            ) : drawerType === "Note" ? (
              <div className="space-y-4">
                {/* Title Card Block */}
                <div className="border border-slate-200 focus-within:border-indigo-500 rounded-2xl p-4 bg-white shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
                  <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-1">Title</label>
                  <input 
                    type="text" 
                    placeholder="Untitled" 
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-slate-900 text-lg font-bold placeholder-slate-400 focus:ring-0 focus:outline-none"
                  />
                  {formError && (
                    <span className="text-[10px] text-red-500 font-bold block mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {formError}
                    </span>
                  )}
                </div>

                {/* Note Area Block */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                  <div className="mt-1 text-slate-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Note Content</label>
                    <textarea 
                      placeholder="Type your secure note here..." 
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      rows={12}
                      className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1 resize-y min-h-[200px]"
                    />
                  </div>
                </div>

                {/* Attachments Block */}
                {renderDrawerAttachmentSection()}
              </div>
            ) : drawerType === "Identity" ? (
              <div className="space-y-4">
                {/* Title Card Block */}
                <div className="border border-slate-200 focus-within:border-indigo-500 rounded-2xl p-4 bg-white shadow-sm focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
                  <label className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest block mb-1">Title</label>
                  <input 
                    type="text" 
                    placeholder="Untitled" 
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full bg-transparent border-0 p-0 text-slate-900 text-lg font-bold placeholder-slate-400 focus:ring-0 focus:outline-none"
                  />
                  {formError && (
                    <span className="text-[10px] text-red-500 font-bold block mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {formError}
                    </span>
                  )}
                </div>

                {/* Primary Identity Fields Stack */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                  {/* First Name */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">First Name</label>
                      <input 
                        type="text" 
                        placeholder="First Name" 
                        value={identityFirstName}
                        onChange={(e) => setIdentityFirstName(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Last Name */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Last Name</label>
                      <input 
                        type="text" 
                        placeholder="Last Name" 
                        value={identityLastName}
                        onChange={(e) => setIdentityLastName(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Gender */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <User className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Gender</label>
                      <input 
                        type="text" 
                        placeholder="Gender" 
                        value={identityGender}
                        onChange={(e) => setIdentityGender(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Birth Date */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <Calendar className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Birth Date</label>
                      <input 
                        type="text" 
                        placeholder="YYYY-MM-DD" 
                        value={identityBirthDate}
                        onChange={(e) => setIdentityBirthDate(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Contact Section Stack */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                  {/* Phone */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <Phone className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Phone</label>
                      <input 
                        type="text" 
                        placeholder="Phone number" 
                        value={identityPhone}
                        onChange={(e) => setIdentityPhone(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Email */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Email</label>
                      <input 
                        type="text" 
                        placeholder="Email address" 
                        value={identityEmail}
                        onChange={(e) => setIdentityEmail(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Address Section Stack */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                  {/* Address */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Address</label>
                      <input 
                        type="text" 
                        placeholder="Street Address" 
                        value={identityAddress}
                        onChange={(e) => setIdentityAddress(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* City, State, ZIP */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0 grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">City</label>
                        <input 
                          type="text" 
                          placeholder="City" 
                          value={identityCity}
                          onChange={(e) => setIdentityCity(e.target.value)}
                          className="w-full bg-transparent border-0 p-0 text-slate-800 text-xs font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-0.5"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">State</label>
                        <input 
                          type="text" 
                          placeholder="State" 
                          value={identityState}
                          onChange={(e) => setIdentityState(e.target.value)}
                          className="w-full bg-transparent border-0 p-0 text-slate-800 text-xs font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-0.5"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">ZIP</label>
                        <input 
                          type="text" 
                          placeholder="ZIP" 
                          value={identityZip}
                          onChange={(e) => setIdentityZip(e.target.value)}
                          className="w-full bg-transparent border-0 p-0 text-slate-800 text-xs font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-0.5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Country */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Country</label>
                      <input 
                        type="text" 
                        placeholder="Country" 
                        value={identityCountry}
                        onChange={(e) => setIdentityCountry(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Identification Stack */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-100">
                  {/* ID / SSN */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <Shield className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">ID / SSN</label>
                      <input 
                        type="text" 
                        placeholder="SSN or National ID" 
                        value={identitySsn}
                        onChange={(e) => setIdentitySsn(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>

                  {/* Passport */}
                  <div className="p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                    <div className="mt-1 text-slate-400">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Passport Number</label>
                      <input 
                        type="text" 
                        placeholder="Passport Number" 
                        value={identityPassport}
                        onChange={(e) => setIdentityPassport(e.target.value)}
                        className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Note Block */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start gap-4 hover:bg-slate-50/30 transition-colors">
                  <div className="mt-1 text-slate-400">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Note</label>
                    <textarea 
                      placeholder="Add secure details or references..." 
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      rows={3}
                      className="w-full bg-transparent border-0 p-0 text-slate-800 text-sm font-semibold placeholder-slate-400 focus:ring-0 focus:outline-none mt-1 resize-none"
                    />
                  </div>
                </div>
              </div>
            ) : drawerType === "Password Generator" ? (
              <div className="space-y-6">
                {/* 1. Large Display Block */}
                <div className="bg-[#f8fafc] border border-slate-200 rounded-2xl p-8 text-center flex flex-col items-center justify-center gap-4 relative overflow-hidden shadow-inner">
                  <div className="text-xl md:text-2xl font-mono font-bold tracking-wider select-all break-all leading-normal px-4">
                    {renderColorCodedPassword(generatedPassword)}
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 border border-emerald-100 rounded-full text-emerald-700 text-xs font-bold shadow-sm">
                    <Shield className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500/20" />
                    <span>Strong</span>
                  </div>
                </div>

                {/* 2. Interactive Configuration Sheet */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
                  {/* Password Type dropdown */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <span className="text-xs font-bold text-slate-800">Type</span>
                    <select
                      value={genType}
                      onChange={(e) => {
                        const val = e.target.value as "random" | "memorizable";
                        setGenType(val);
                        setGenLength(val === "random" ? 16 : 4);
                      }}
                      className="text-xs font-bold text-indigo-600 bg-transparent border-0 focus:ring-0 cursor-pointer outline-none hover:text-indigo-700"
                    >
                      <option value="random">Random Password</option>
                      <option value="memorizable">Memorizable Password</option>
                    </select>
                  </div>

                  {/* Character/Word Length Slider */}
                  <div className="space-y-2 pb-3 border-b border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        {genLength} {genType === "random" ? "characters" : "words"}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={genType === "random" ? 6 : 3}
                      max={genType === "random" ? 64 : 10}
                      value={genLength}
                      onChange={(e) => setGenLength(Number(e.target.value))}
                      className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-rose-500"
                      style={{
                        background: `linear-gradient(to right, #f43f5e 0%, #f43f5e ${
                          ((genLength - (genType === "random" ? 6 : 3)) / ((genType === "random" ? 64 : 10) - (genType === "random" ? 6 : 3))) * 100
                        }%, #f1f5f9 ${
                          ((genLength - (genType === "random" ? 6 : 3)) / ((genType === "random" ? 64 : 10) - (genType === "random" ? 6 : 3))) * 100
                        }%, #f1f5f9 100%)`
                      }}
                    />
                  </div>

                  {showAdvancedOptions && (
                    <div className="space-y-4 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
                      {genType === "random" ? (
                        <>
                          {/* Special characters */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">Special characters (!&*)</span>
                            <button
                              onClick={() => setGenIncludeSymbols(!genIncludeSymbols)}
                              className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all duration-300 ${
                                genIncludeSymbols ? "bg-rose-400" : "bg-slate-200"
                              }`}
                            >
                              <div
                                className={`bg-white w-4 h-4 rounded-full shadow transform transition-all duration-300 ${
                                  genIncludeSymbols ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          {/* Capital letters */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">Capital letters (A-Z)</span>
                            <button
                              onClick={() => setGenIncludeUppercase(!genIncludeUppercase)}
                              className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all duration-300 ${
                                genIncludeUppercase ? "bg-rose-400" : "bg-slate-200"
                              }`}
                            >
                              <div
                                className={`bg-white w-4 h-4 rounded-full shadow transform transition-all duration-300 ${
                                  genIncludeUppercase ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          {/* Include numbers */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">Include numbers (0-9)</span>
                            <button
                              onClick={() => setGenIncludeNumbers(!genIncludeNumbers)}
                              className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all duration-300 ${
                                genIncludeNumbers ? "bg-rose-400" : "bg-slate-200"
                              }`}
                            >
                              <div
                                className={`bg-white w-4 h-4 rounded-full shadow transform transition-all duration-300 ${
                                  genIncludeNumbers ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Capitalize words */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">Capitalize words</span>
                            <button
                              onClick={() => setGenCapitalizeWords(!genCapitalizeWords)}
                              className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all duration-300 ${
                                genCapitalizeWords ? "bg-rose-400" : "bg-slate-200"
                              }`}
                            >
                              <div
                                className={`bg-white w-4 h-4 rounded-full shadow transform transition-all duration-300 ${
                                  genCapitalizeWords ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          {/* Include numbers */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">Include trailing numbers</span>
                            <button
                              onClick={() => setGenIncludeNumbers(!genIncludeNumbers)}
                              className={`w-9 h-5 flex items-center rounded-full p-0.5 cursor-pointer transition-all duration-300 ${
                                genIncludeNumbers ? "bg-rose-400" : "bg-slate-200"
                              }`}
                            >
                              <div
                                className={`bg-white w-4 h-4 rounded-full shadow transform transition-all duration-300 ${
                                  genIncludeNumbers ? "translate-x-4" : "translate-x-0"
                                }`}
                              />
                            </button>
                          </div>

                          {/* Separator select */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-600">Word separator</span>
                            <select
                              value={genWordSeparator}
                              onChange={(e) => setGenWordSeparator(e.target.value)}
                              className="text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none"
                            >
                              <option value="-">Hyphen (-)</option>
                              <option value=".">Dot (.)</option>
                              <option value="_">Underscore (_)</option>
                              <option value=" ">Space ( )</option>
                            </select>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Toggle Advanced options footer links */}
                  <div className="pt-2 flex items-center justify-center border-t border-slate-100">
                    <button
                      onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                      className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
                    >
                      {showAdvancedOptions ? (
                        <>
                          <X className="w-3.5 h-3.5" /> Close advanced options
                        </>
                      ) : (
                        <>
                          <Sliders className="w-3.5 h-3.5" /> Show options
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Title input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Title</label>
                  <input 
                    type="text" 
                    placeholder="Untitled" 
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold text-slate-955 bg-white"
                  />
                  {formError && (
                    <span className="text-[10px] text-red-500 font-bold block mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" /> {formError}
                    </span>
                  )}
                </div>

                {/* Email or username */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Email or username</label>
                  <div className="relative flex items-center">
                    <User className="absolute left-3 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Enter email or username" 
                      value={formUsername}
                      onChange={(e) => setFormUsername(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold text-slate-955 bg-white"
                    />
                  </div>
                </div>

                {/* Password field with generate */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Password</label>
                  <div className="relative flex items-center">
                    <LockKeyhole className="absolute left-3 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Enter password" 
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      className="w-full pl-9 pr-10 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold text-slate-950 bg-white font-mono"
                    />
                    <button 
                      onClick={handleGeneratePassword}
                      className="absolute right-3 p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                      title="Generate strong password"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 2FA secret key */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">2FA secret key (TOTP)</label>
                  <div className="relative flex items-center">
                    <Clock className="absolute left-3 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Enter 2FA secret key" 
                      value={formTotp}
                      onChange={(e) => setFormTotp(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold text-slate-950 bg-white"
                    />
                  </div>
                </div>

                {/* Websites */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Websites</label>
                    <button 
                      type="button" 
                      onClick={() => setFormUrls([...formUrls, ""])}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 font-bold flex items-center gap-0.5"
                    >
                      + Add website
                    </button>
                  </div>
                  
                  {formUrls.map((url, idx) => (
                    <div key={idx} className="relative flex items-center gap-2">
                      <div className="relative flex-1 flex items-center">
                        <Globe className="absolute left-3 w-4 h-4 text-slate-400" />
                        <input 
                          type="text" 
                          placeholder="https://" 
                          value={url}
                          onChange={(e) => {
                            const newUrls = [...formUrls];
                            newUrls[idx] = e.target.value;
                            setFormUrls(newUrls);
                          }}
                          className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold text-slate-955 bg-white"
                        />
                      </div>
                      {formUrls.length > 1 && (
                        <button 
                          type="button" 
                          onClick={() => setFormUrls(formUrls.filter((_, i) => i !== idx))}
                          className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-slate-100 transition-colors"
                          title="Remove website URL"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Note */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Note</label>
                  <div className="relative flex">
                    <FileText className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
                    <textarea 
                      placeholder="Add note" 
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                      rows={3}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-semibold text-slate-955 bg-white resize-none"
                    />
                  </div>
                </div>

                {/* Attachments dropzone */}
                <div className="space-y-1.5 pt-2">
                  {renderDrawerAttachmentSection()}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </section>
        </div>
      )}
      <Preferences open={isPreferencesOpen} onClose={() => setIsPreferencesOpen(false)} />

      {isAddVaultModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px]" onClick={() => setIsAddVaultModalOpen(false)} />
          
          {/* Modal Box */}
          <div className="relative bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xl w-full max-w-sm mx-4 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                <FolderPlus className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Create New Vault</h3>
                <p className="text-[10px] text-slate-400 font-semibold leading-none mt-0.5">Organize your passwords and cards</p>
              </div>
            </div>
            
            <div className="space-y-1">
              <input 
                type="text"
                placeholder="e.g. Finance, Work, Personal"
                value={newVaultName}
                onChange={(e) => {
                  setNewVaultName(e.target.value);
                  setNewVaultError("");
                }}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50/20 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-405 transition-all font-semibold"
                autoFocus
              />
              {newVaultError && (
                <span className="text-[10px] text-red-500 font-semibold block">{newVaultError}</span>
              )}
            </div>
            
            <div className="flex items-center justify-end gap-2 pt-2">
              <button 
                onClick={() => setIsAddVaultModalOpen(false)}
                className="text-xs font-bold text-slate-500 hover:text-slate-900 px-3.5 py-2 rounded-xl hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  const cleanName = newVaultName.trim();
                  if (!cleanName) {
                    setNewVaultError("Vault name cannot be empty");
                    return;
                  }
                  if (customVaults.some(v => v.name.toLowerCase() === cleanName.toLowerCase())) {
                    setNewVaultError("Vault category already exists");
                    return;
                  }
                  setCustomVaults([...customVaults, { name: cleanName, id: getVaultId(cleanName.toLowerCase()) }]);
                  setNewVaultName("");
                  setIsAddVaultModalOpen(false);
                }}
                className="bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-sm transition-all"
              >
                Create Vault
              </button>
            </div>
          </div>
        </div>
      )}

      {isShareModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-900/10 backdrop-blur-[2px]" onClick={() => setIsShareModalOpen(false)} />
          
          {/* Modal Box */}
          <div className="relative bg-white border border-slate-200/80 rounded-2xl p-6 shadow-xl w-full max-w-sm mx-4 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                <Share2 className="w-4.5 h-4.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Share Item</h3>
                <p className="text-[10px] text-slate-400 font-semibold leading-none mt-0.5">Encrypt and share securely by email</p>
              </div>
            </div>
            
            <div className="space-y-1">
              <input 
                type="email"
                placeholder="recipient@example.com"
                value={shareEmail}
                onChange={(e) => {
                  setShareEmail(e.target.value);
                  setShareError("");
                }}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50/20 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-indigo-500 transition-all font-semibold"
                autoFocus
              />
              {shareError && (
                <span className="text-[10px] text-red-500 font-semibold block">{shareError}</span>
              )}
              {shareSuccess && (
                <span className="text-[10px] text-emerald-600 font-semibold block">{shareSuccess}</span>
              )}
            </div>
            
            <div className="flex items-center justify-end gap-2 pt-2">
              <button 
                onClick={() => setIsShareModalOpen(false)}
                className="text-xs font-bold text-slate-500 hover:text-slate-900 px-3.5 py-2 rounded-xl hover:bg-slate-100 transition-colors"
                disabled={isSharingLoading}
              >
                Cancel
              </button>
              <button 
                onClick={handleShareItem}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-sm transition-all flex items-center gap-1.5"
                disabled={isSharingLoading}
              >
                {isSharingLoading ? "Sharing..." : "Share Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 text-slate-800 font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-slate-200 border-t-indigo-600"></div>
          <p className="text-sm font-medium text-slate-500">Securing environment...</p>
        </div>
      </div>
    }>
      <DashboardPageContent />
    </Suspense>
  );
}
