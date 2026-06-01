"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deriveKeyFromBackupCode, wrapMasterKey, encryptData, deriveKeyFromPrf, base64ToArrayBuffer } from "@vivago-pass/ts-crypto";
import { getMasterKeyHex, getStorage, clearSession, CONFIG } from "@/lib/sessionStore";
import { startRegistration } from "@simplewebauthn/browser";
import { 
  User, Shield, Key, Globe, Inbox, Copy, Check, Trash2, 
  ArrowLeft, Edit2, Sliders, ExternalLink, AlertCircle, 
  CheckCircle2, ShieldCheck, ArrowRight, Download, RefreshCw, 
  KeyRound, Eye, EyeOff, Layers, Lock, Folder, FolderPlus, Sparkles, 
  HelpCircle, LogOut, ChevronsUpDown, X, PanelLeft, ToggleLeft, ToggleRight
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "../../context/toast-context";

interface DomainEmail {
  id: string;
  email: string;
  prefix: string;
  domain: string;
  createdDate: string;
  active: boolean;
}

interface EmailAlias {
  id: string;
  aliasEmail: string;
  forwardTo: string;
  label: string;
  createdDate: string;
  active: boolean;
  isEditingForwardTarget: boolean;
}

export default function ProfilePage() {
  const { toast } = useToast();
  const localStorage = getStorage();
  const router = useRouter();
  
  // Navigation tabs for settings
  const [activeTab, setActiveTab] = useState<"account" | "backup_codes" | "domains" | "aliases" | "passkeys">("account");
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);

  const handleRegisterPasskey = async () => {
    if (typeof window === "undefined" || !window.PublicKeyCredential) {
      toast.warning("Passkeys/WebAuthn are not supported on this browser.");
      return;
    }
    
    const masterKeyHex = getMasterKeyHex();
    if (!masterKeyHex) {
      toast.error("Master key not found in memory. Please log in again.");
      return;
    }

    setIsRegisteringPasskey(true);
    try {
      const userId = localStorage.getItem("x-user-id");
      const sessionToken = localStorage.getItem("session-token");

      // 1. Fetch options
      const optionsRes = await fetch(`${CONFIG.API_URL}/api/auth/passkey/register-options`, {
        method: "POST",
        headers: {
          "x-user-id": userId || "",
          "session-token": sessionToken || ""
        }
      });
      if (!optionsRes.ok) {
        throw new Error(await optionsRes.text() || "Failed to fetch passkey options");
      }
      const options = await optionsRes.json();

      // 2. Start registration via SimpleWebAuthn
      if (options.extensions?.prf?.eval?.first && typeof options.extensions.prf.eval.first === "string") {
        options.extensions.prf.eval.first = base64ToArrayBuffer(options.extensions.prf.eval.first);
      }
      const credential = await startRegistration({ optionsJSON: options });

      // 3. Extract PRF key
      const firstPrf = (credential as any).response.extensions?.prf?.results?.first || (credential as any).clientExtensionResults?.prf?.results?.first;
      if (!firstPrf) {
        throw new Error("Your authenticator does not support the WebAuthn PRF extension. A master key could not be derived.");
      }

      // Convert the first PRF ArrayBuffer to a CryptoKey and use it to encrypt the master key
      const rawPrfBuffer = base64ToArrayBuffer(firstPrf);
      const prfKey = await deriveKeyFromPrf(rawPrfBuffer);

      // Encrypt the masterKeyHex using the prfKey
      const encrypted = await encryptData(masterKeyHex, prfKey);

      // 4. Send credential and encrypted master key back to backend
      const verifyRes = await fetch(`${CONFIG.API_URL}/api/auth/passkey/register-verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId || "",
          "session-token": sessionToken || ""
        },
        body: JSON.stringify({
          credential,
          encryptedMasterKey: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag
        })
      });

      if (verifyRes.ok) {
        toast.success("Passkey successfully registered!");
      } else {
        const errData = await verifyRes.json();
        throw new Error(errData.error || "Failed to verify passkey registration");
      }
    } catch (err: any) {
      console.error("Passkey registration failed:", err);
      toast.error(err.message || "An error occurred during passkey registration.");
    } finally {
      setIsRegisteringPasskey(false);
    }
  };

  const [activeMobilePane, setActiveMobilePane] = useState<"sidebar" | "content">("sidebar");
  
  // Profile state
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [plan, setPlan] = useState("starter");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Password reset states
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassCurrent, setShowPassCurrent] = useState(false);
  const [showPassNew, setShowPassNew] = useState(false);
  const [showPassConfirm, setShowPassConfirm] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<{ type: "success" | "error" | null; message: string }>({ type: null, message: "" });

  // Backup codes states
  const [backupCodesStatus, setBackupCodesStatus] = useState<Array<{ codeHash: string; isUsed: number }>>([]);
  const [newGeneratedCodes, setNewGeneratedCodes] = useState<string[]>([]);
  const [isGeneratingCodes, setIsGeneratingCodes] = useState(false);

  // Domains states
  const [domainPrefix, setDomainPrefix] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("vivago.me");
  const [domainEmailList, setDomainEmailList] = useState<DomainEmail[]>([
    { id: "d1", email: "hello@vivago.me", prefix: "hello", domain: "vivago.me", createdDate: "May 20, 2026", active: true },
    { id: "d2", email: "nowshad@vivagopass.com", prefix: "nowshad", domain: "vivagopass.com", createdDate: "May 25, 2026", active: true }
  ]);

  // Aliases states
  const [aliasLabel, setAliasLabel] = useState("");
  const [aliasForwardTo, setAliasForwardTo] = useState("");
  const [aliasList, setAliasList] = useState<EmailAlias[]>([
    { id: "a1", aliasEmail: "go.netflix.591a@vivagopass.com", forwardTo: "infonowshad@proton.me", label: "Netflix Subscription", createdDate: "May 24, 2026", active: true, isEditingForwardTarget: false },
    { id: "a2", aliasEmail: "sec.github.ff2c@vivago.me", forwardTo: "hello@vivago.me", label: "GitHub Account", createdDate: "May 28, 2026", active: true, isEditingForwardTarget: false }
  ]);

  useEffect(() => {
    async function loadData() {
      if (typeof window === "undefined") return;
      const userId = localStorage.getItem("x-user-id");
      const sessionToken = localStorage.getItem("session-token");
      if (!userId || userId === "undefined") {
        router.push("/login");
        return;
      }

      try {
        const res = await fetch(`${CONFIG.API_URL}/api/user/profile`, {
          headers: {
            "x-user-id": userId,
            "session-token": sessionToken || ""
          }
        });
        if (res.ok) {
          const data = await res.json();
          setUserEmail(data.email);
          setUserName(data.name || "User");
          setPlan(data.plan || "starter");
          setAliasForwardTo(data.email);
        }

        const codesRes = await fetch(`${CONFIG.API_URL}/api/user/backup-codes`, {
          headers: {
            "x-user-id": userId,
            "session-token": sessionToken || ""
          }
        });
        if (codesRes.ok) {
          const data = await codesRes.json();
          setBackupCodesStatus(data.codes || []);
        }
      } catch (err) {
        console.error("Failed to load profile data:", err);
      }
    }
    loadData();
  }, [router]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window === "undefined") return;
    const userId = sessionStorage.getItem("x-user-id");
    if (!userId) return;

    try {
      const res = await fetch(`${CONFIG.API_URL}/api/user/profile`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId,
          "session-token": sessionStorage.getItem("session-token") || ""
        },
        body: JSON.stringify({ name: userName })
      });
      if (res.ok) {
        toast.success("Name updated successfully!");
      } else {
        toast.error("Failed to update name");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handlePasswordReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordStatus({ type: "error", message: "All fields are required." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus({ type: "error", message: "Passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordStatus({ type: "error", message: "Password must be at least 8 characters." });
      return;
    }
    
    setPasswordStatus({ type: "success", message: "Master password successfully updated." });
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setTimeout(() => setPasswordStatus({ type: null, message: "" }), 4000);
  };

  const handleRegenerateBackupCodes = async () => {
    if (typeof window === "undefined") return;
    setIsGeneratingCodes(true);
    try {
      const emailVal = localStorage.getItem("user-email") || userEmail;
      const keyHex = getMasterKeyHex();
      if (!keyHex) {
        toast.error("Cannot generate codes: Master encryption key not found in session memory. Please log in again.");
        setIsGeneratingCodes(false);
        return;
      }

      const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      const masterKey = await window.crypto.subtle.importKey(
        "raw",
        keyBytes.buffer,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const codes = [];
      for (let i = 0; i < 8; i++) {
        const segment1 = Math.random().toString(36).substring(2, 6).toUpperCase();
        const segment2 = Math.random().toString(36).substring(2, 6).toUpperCase();
        codes.push(`VVGP-${segment1}-${segment2}`);
      }

      const wrappedCodes = await Promise.all(
        codes.map(async (code) => {
          const wrappingKey = await deriveKeyFromBackupCode(code, emailVal);
          const wrapped = await wrapMasterKey(masterKey, wrappingKey);
          return {
            hash: code,
            encryptedMasterKey: wrapped.ciphertext,
            iv: wrapped.iv,
            authTag: wrapped.authTag
          };
        })
      );

      const userId = localStorage.getItem("x-user-id");
      const res = await fetch(`${CONFIG.API_URL}/api/user/backup-codes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId || "",
          "session-token": localStorage.getItem("session-token") || ""
        },
        body: JSON.stringify({ backupCodes: wrappedCodes })
      });

      if (res.ok) {
        setNewGeneratedCodes(codes);
        const statusRes = await fetch(`${CONFIG.API_URL}/api/user/backup-codes`, {
          headers: {
            "x-user-id": userId || "",
            "session-token": localStorage.getItem("session-token") || ""
          }
        });
        if (statusRes.ok) {
          const data = await statusRes.json();
          setBackupCodesStatus(data.codes || []);
        }
      } else {
        toast.error("Failed to save new backup codes to server.");
      }
    } catch (err) {
      console.error(err);
      toast.error("Encryption error while generating backup codes.");
    } finally {
      setIsGeneratingCodes(false);
    }
  };

  const handleCreateDomainEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrefix = domainPrefix.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!cleanPrefix) return;

    const emailStr = `${cleanPrefix}@${selectedDomain}`;
    if (domainEmailList.some(item => item.email.toLowerCase() === emailStr.toLowerCase())) {
      toast.warning("This domain email mailbox already exists.");
      return;
    }

    const newDomainEmail: DomainEmail = {
      id: String(Date.now()),
      email: emailStr,
      prefix: cleanPrefix,
      domain: selectedDomain,
      createdDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      active: true
    };

    setDomainEmailList([newDomainEmail, ...domainEmailList]);
    setDomainPrefix("");
  };

  const handleCreateAlias = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLabel = aliasLabel.trim() || "Generated Alias";
    const randomHash = Math.random().toString(36).substring(2, 6);
    const cleanPrefix = cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, "") || "alias";
    const randomDomain = Math.random() > 0.5 ? "vivago.me" : "vivagopass.com";
    
    const emailStr = `${cleanPrefix}.${randomHash}@${randomDomain}`;

    const newAlias: EmailAlias = {
      id: String(Date.now()),
      aliasEmail: emailStr,
      forwardTo: aliasForwardTo.trim() || userEmail,
      label: cleanLabel,
      createdDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      active: true,
      isEditingForwardTarget: false
    };

    setAliasList([newAlias, ...aliasList]);
    setAliasLabel("");
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      clearSession();
      router.push("/login");
    }
  };

  return (
    <div className="flex h-screen w-full max-w-full bg-slate-50 dark:bg-slate-950 overflow-hidden font-sans text-slate-800 dark:text-slate-100 antialiased">
      
      {/* 1. Global Navigation Sidebar (Shared from Dashboard) */}
      <aside className={`w-full md:w-60 lg:w-64 bg-slate-50 border-r border-slate-200/60 flex flex-col justify-between ${activeMobilePane === "sidebar" ? "flex" : "hidden"} md:flex text-slate-700 shrink-0`}>
        <div className="flex flex-col space-y-4 overflow-y-auto flex-1 p-3.5 lg:p-4 pb-2">
          {/* Header */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8.5 h-8.5 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-600/20">
                <Shield className="w-4.5 h-4.5" />
              </div>
              <span className="font-extrabold text-sm text-slate-900 tracking-tight">Vivago Pass</span>
            </div>
            <button 
              onClick={() => setActiveMobilePane("content")} 
              className="p-1.5 rounded-lg hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-all md:hidden"
            >
              <X className="w-4 h-4" />
            </button>
            <button className="p-1.5 rounded-lg hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-all hidden md:block">
              <PanelLeft className="w-4 h-4" />
            </button>
          </div>

          <div className="border-t border-slate-200/60 my-2"></div>

          {/* Navigation / Vaults */}
          <div className="space-y-4 px-0.5">
            <div>
              <div className="flex items-center justify-between mb-2 px-2">
                <span className="text-[11px] font-bold text-slate-405 uppercase tracking-widest">Vaults</span>
                <button className="p-0.5 rounded hover:bg-slate-200/60 text-slate-400 hover:text-slate-655" onClick={() => router.push("/dashboard?createVault=true")}>
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>

              <nav className="space-y-1">
                <button 
                  onClick={() => router.push("/dashboard")}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border border-transparent text-slate-600 hover:bg-slate-200/30 hover:text-slate-900"
                >
                  <div className="flex items-center gap-3">
                    <Layers className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-bold block leading-tight">All items</span>
                  </div>
                </button>

                <button 
                  onClick={() => router.push("/dashboard")}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border border-transparent text-slate-600 hover:bg-slate-200/30 hover:text-slate-900"
                >
                  <div className="flex items-center gap-3">
                    <Lock className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-bold block leading-tight">Personal</span>
                  </div>
                </button>

                <button 
                  onClick={() => router.push("/dashboard")}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border border-transparent text-slate-600 hover:bg-slate-200/30 hover:text-slate-900"
                >
                  <div className="flex items-center gap-3">
                    <Trash2 className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-bold block leading-tight">Trash</span>
                  </div>
                </button>
              </nav>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="p-4 pt-0 space-y-3.5">
          {/* <div className="bg-[#eef2ff] border border-indigo-100/50 rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-indigo-655 shadow-sm">
                <Sparkles className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-tight">Current plan</p>
                <p className="text-xs font-extrabold text-slate-900 leading-tight">Starter plan</p>
              </div>
            </div>
          </div> */}

          <nav className="space-y-0.5 px-1 border-t border-slate-200/60 pt-2">
            <button onClick={() => router.push("/dashboard")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 transition-all">
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              <span>Preferences</span>
            </button>
            <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-655 hover:bg-rose-50/50 hover:text-rose-700 transition-all mt-1">
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span>Logout</span>
            </button>
          </nav>

          {/* Active Profile block */}
          <div 
            onClick={() => setActiveMobilePane("content")}
            className="flex items-center justify-between border-t border-slate-200/60 pt-3 px-2 rounded-xl cursor-pointer bg-slate-200/50"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8.5 h-8.5 rounded-full bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center text-white font-extrabold text-xs shadow-md">
                {userName ? userName.substring(0, 2).toUpperCase() : "VP"}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 leading-tight truncate max-w-[120px]">
                  {userName}
                </p>
                <p className="text-[10px] text-slate-500 font-bold leading-none mt-0.5 capitalize">
                  {plan} plan
                </p>
              </div>
            </div>
            <button className="p-1 rounded-md text-slate-400" title="Settings / Profile">
              <ChevronsUpDown className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* 2. Main Profile Workspace */}
      <section className={`flex-1 flex flex-col overflow-hidden bg-white ${activeMobilePane === "content" ? "flex" : "hidden"} md:flex`}>
        
        {/* Workspace Top Header Bar */}
        <header className="bg-white border-b border-slate-200/60 px-6 py-4 flex items-center justify-between shrink-0 shadow-sm">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setActiveMobilePane("sidebar")}
              className="md:hidden p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 bg-slate-50/50 transition-colors"
              title="Show Menu"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
            <div>
              <h1 className="text-sm font-bold text-slate-900">Profile Settings</h1>
              <p className="text-[10px] text-slate-400 font-semibold leading-none mt-0.5">Manage accounts, master password & customized emails</p>
            </div>
          </div>
          <Link 
            href="/dashboard"
            className="text-xs font-bold text-slate-655 hover:text-slate-850 border border-slate-200 hover:bg-slate-50 bg-white px-4 py-2 rounded-xl shadow-sm transition-all"
          >
            ← Back to Vault
          </Link>
        </header>

        {/* Workspace Area: Horizontal tab navigation and workspace */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/30">
          
          {/* Sub Navigation tabs */}
          <div className="flex items-center border-b border-slate-200/60 bg-white px-6 gap-6 shrink-0 z-10 shadow-[0_1px_2px_rgba(0,0,0,0.01)]">
            <button 
              onClick={() => setActiveTab("account")}
              className={`pb-3.5 pt-4 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "account" 
                  ? "border-indigo-650 text-indigo-650 font-black" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <User className="w-4 h-4" />
              1. Personal & Password
            </button>
            <button 
              onClick={() => setActiveTab("backup_codes")}
              className={`pb-3.5 pt-4 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "backup_codes" 
                  ? "border-indigo-650 text-indigo-650 font-black" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Key className="w-4 h-4" />
              2. Backup Codes
            </button>
            <button 
              onClick={() => setActiveTab("domains")}
              className={`pb-3.5 pt-4 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "domains" 
                  ? "border-indigo-650 text-indigo-650 font-black" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Globe className="w-4 h-4" />
              3. Domains
            </button>
            <button 
              onClick={() => setActiveTab("aliases")}
              className={`pb-3.5 pt-4 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "aliases" 
                  ? "border-indigo-650 text-indigo-650 font-black" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Inbox className="w-4 h-4" />
              4. Aliases
            </button>
            <button 
              onClick={() => setActiveTab("passkeys")}
              className={`pb-3.5 pt-4 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === "passkeys" 
                  ? "border-indigo-650 text-indigo-650 font-black" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              5. Passkeys
            </button>
          </div>

          {/* Tab Workspaces Scrollable container */}
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            
            {activeTab === "account" && (
              <div className="space-y-8 max-w-xl bg-white border border-slate-200/50 rounded-2xl p-6 md:p-8 shadow-sm">
                <div>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Update Personal Profile</h2>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Manage your public username and display email profile details</p>
                </div>

                <form onSubmit={handleUpdateName} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="displayName" className="text-xs font-semibold text-slate-700">Display Name</Label>
                    <div className="flex gap-3">
                      <Input
                        id="displayName"
                        type="text"
                        className="h-10.5 rounded-xl border-slate-200 text-xs font-bold"
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                      />
                      <Button type="submit" className="h-10.5 rounded-xl bg-slate-900 hover:bg-slate-850 px-6 font-semibold text-xs transition-all shrink-0">
                        Save Display Name
                      </Button>
                    </div>
                  </div>
                </form>

                <div className="border-t border-slate-100 pt-6">
                  <div className="mb-4">
                    <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Change Master Password</h2>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Modify the password used to derive your cryptographic keys locally</p>
                  </div>

                  <form onSubmit={handlePasswordReset} className="space-y-4">
                    {passwordStatus.type && (
                      <div className={`p-3 rounded-xl text-xs flex gap-2.5 items-start leading-snug border ${
                        passwordStatus.type === "success" 
                          ? "bg-emerald-50 text-emerald-800 border-emerald-100/50" 
                          : "bg-red-50 text-red-800 border-red-100/50"
                      }`}>
                        {passwordStatus.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />}
                        <span>{passwordStatus.message}</span>
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <Label htmlFor="currentPass" className="text-xs font-semibold text-slate-700">Current Password</Label>
                      <div className="relative">
                        <Input
                          id="currentPass"
                          type={showPassCurrent ? "text" : "password"}
                          className="h-10.5 rounded-xl border-slate-200 text-xs font-semibold"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                        />
                        <button type="button" onClick={() => setShowPassCurrent(!showPassCurrent)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                          {showPassCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="newPass" className="text-xs font-semibold text-slate-700">New Password</Label>
                        <div className="relative">
                          <Input
                            id="newPass"
                            type={showPassNew ? "text" : "password"}
                            className="h-10.5 rounded-xl border-slate-200 text-xs font-semibold"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                          />
                          <button type="button" onClick={() => setShowPassNew(!showPassNew)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            {showPassNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="confirmPass" className="text-xs font-semibold text-slate-700">Confirm Password</Label>
                        <div className="relative">
                          <Input
                            id="confirmPass"
                            type={showPassConfirm ? "text" : "password"}
                            className="h-10.5 rounded-xl border-slate-200 text-xs font-semibold"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                          />
                          <button type="button" onClick={() => setShowPassConfirm(!showPassConfirm)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                            {showPassConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <Button type="submit" className="h-10.5 rounded-xl bg-slate-900 hover:bg-slate-850 px-6 font-semibold text-xs shadow-sm transition-all active:scale-[0.98]">
                      Update Master Password
                    </Button>
                  </form>
                </div>
              </div>
            )}

            {activeTab === "backup_codes" && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200/50 rounded-2xl p-6 md:p-8 shadow-sm">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Emergency Recovery Keys</h2>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Secure your vault with ZKA-encrypted offline backup codes</p>
                  </div>

                  <div className="flex flex-col gap-4 mt-6">
                    <Button
                      onClick={handleRegenerateBackupCodes}
                      disabled={isGeneratingCodes}
                      className="h-10 px-6 bg-slate-900 hover:bg-slate-850 disabled:bg-slate-300 rounded-xl font-bold text-xs shadow-sm w-fit transition-all flex items-center gap-2"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingCodes ? 'animate-spin' : ''}`} />
                      {isGeneratingCodes ? "Regenerating Keys..." : "Generate New Backup Codes"}
                    </Button>

                    {newGeneratedCodes.length > 0 && (
                      <div className="border border-indigo-100 bg-indigo-50/20 rounded-2xl p-5 space-y-4 animate-in fade-in duration-200">
                        <div>
                          <h4 className="text-xs font-bold text-indigo-950">Backup Codes Saved to Server!</h4>
                          <p className="text-[10px] text-slate-400 font-medium">Download or copy these codes securely. You will not be able to view them again.</p>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 font-mono text-[11px] font-bold text-slate-700 tracking-wider">
                          {newGeneratedCodes.map((code, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl p-2.5 shadow-sm">
                              <span className="text-[9px] text-slate-350 select-none">0{idx + 1}</span>
                              <span>{code}</span>
                            </div>
                          ))}
                        </div>

                        <div className="flex gap-2">
                          <Button
                            onClick={() => {
                              navigator.clipboard.writeText(newGeneratedCodes.join("\n"));
                              toast.success("Codes copied to clipboard!");
                            }}
                            className="h-9 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
                          >
                            <Copy className="w-3.5 h-3.5" /> Copy Codes
                          </Button>
                          <Button
                            onClick={() => {
                              const element = document.createElement("a");
                              const file = new Blob([
                                `VIVAGO PASS SECURITY BACKUP CODES\n`,
                                `Account: ${userEmail}\n`,
                                `Date: ${new Date().toLocaleDateString()}\n\n`,
                                newGeneratedCodes.join("\n")
                              ], {type: 'text/plain'});
                              element.href = URL.createObjectURL(file);
                              element.download = "vivago-pass-backup-codes.txt";
                              document.body.appendChild(element);
                              element.click();
                              document.body.removeChild(element);
                            }}
                            className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm transition-all"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-200" /> Download .txt
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200/50 rounded-2xl p-6 md:p-8 shadow-sm">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4">Backup Codes Status</h3>
                  
                  {backupCodesStatus.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs font-medium bg-slate-50/50 rounded-2xl border border-slate-100">
                      No active backup codes found. Please generate a new set above to secure your account recovery flow.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {backupCodesStatus.map((c, idx) => (
                        <div key={idx} className={`flex items-center justify-between border rounded-2xl p-4 transition-all ${
                          c.isUsed === 1 
                            ? 'bg-slate-50 border-slate-100 text-slate-450' 
                            : 'bg-white border-slate-200/60 text-slate-705 shadow-sm'
                        }`}>
                          <div className="space-y-0.5">
                            <span className="text-[9px] text-slate-350 font-bold uppercase tracking-wider">Code #{idx + 1}</span>
                            <div className="text-xs font-extrabold font-mono tracking-wider">
                              {c.isUsed === 1 ? "USED CODE" : "ACTIVE"}
                            </div>
                          </div>
                          <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${
                            c.isUsed === 1 
                              ? 'bg-slate-200/50 text-slate-500' 
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-100/50'
                          }`}>
                            {c.isUsed === 1 ? 'USED' : 'UNUSED'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === "domains" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-slate-900 uppercase tracking-wider">Custom Domain Mailboxes</h2>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Manage fully functioning mailboxes under custom secure domains</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
                  <form onSubmit={handleCreateDomainEmail} className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1 flex border border-slate-200 rounded-xl overflow-hidden focus-within:border-slate-350 transition-all bg-white min-w-0">
                      <input 
                        type="text"
                        required
                        value={domainPrefix}
                        onChange={(e) => setDomainPrefix(e.target.value)}
                        placeholder="Mailbox prefix (e.g. hello)"
                        className="flex-1 h-10 px-3.5 text-xs focus:outline-none font-semibold text-slate-800 bg-transparent min-w-0"
                      />
                      <select
                        value={selectedDomain}
                        onChange={(e) => setSelectedDomain(e.target.value)}
                        className="h-10 px-3 text-xs bg-slate-50 border-l border-slate-200 focus:outline-none font-semibold text-slate-700 cursor-pointer"
                      >
                        <option value="vivago.me">@vivago.me</option>
                        <option value="vivagopass.com">@vivagopass.com</option>
                      </select>
                    </div>

                    <Button type="submit" className="h-10 px-6 bg-slate-900 hover:bg-slate-850 font-bold text-xs rounded-xl">
                      Create Mailbox
                    </Button>
                  </form>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200/60 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          <th className="py-3 px-6">Domain Email Address</th>
                          <th className="py-3 px-6 text-center">Status</th>
                          <th className="py-3 px-6 text-right">Inbox Access</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                        {domainEmailList.map((item) => (
                          <tr key={item.id} className="hover:bg-slate-50/40 transition-colors">
                            <td className="py-4 px-6">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-slate-900 select-all">{item.email}</span>
                                <button 
                                  onClick={() => handleCopy(item.email, item.id)}
                                  className="p-1 rounded hover:bg-slate-100 text-slate-405 hover:text-slate-655"
                                >
                                  {copiedId === item.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                              <span className="text-[9px] text-slate-400 font-semibold block mt-0.5">Created {item.createdDate}</span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100/50">
                                Active Mailbox
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <a 
                                  href={`https://webmail.${item.domain}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-650 hover:text-indigo-850 bg-indigo-50/50 hover:bg-indigo-100/70 border border-indigo-100/40 px-3 py-1.5 rounded-xl transition-all"
                                >
                                  Webmail <ExternalLink className="w-3 h-3" />
                                </a>
                                <button 
                                  onClick={() => setDomainEmailList(domainEmailList.filter(d => d.id !== item.id))}
                                  className="p-1.5 rounded-xl border border-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-505 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "aliases" && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-bold text-slate-900 uppercase tracking-wider">Masked Email Aliases</h2>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Hide your primary address. Send random forwarders to untrusted sites</p>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-sm">
                  <form onSubmit={handleCreateAlias} className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1">
                      <input 
                        type="text"
                        required
                        value={aliasLabel}
                        onChange={(e) => setAliasLabel(e.target.value)}
                        placeholder="Label (e.g. Amazon, Twitter)"
                        className="w-full h-10 px-3.5 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:border-slate-350 transition-all font-semibold text-slate-800"
                      />
                    </div>

                    <div className="flex-1">
                      <select 
                        value={aliasForwardTo}
                        onChange={(e) => setAliasForwardTo(e.target.value)}
                        className="w-full h-10 px-3 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:border-slate-350 transition-all font-semibold text-slate-800 cursor-pointer"
                      >
                        <option value={userEmail}>Registered Email: {userEmail}</option>
                        {domainEmailList.map((d) => (
                          <option key={d.id} value={d.email}>
                            Domain Mailbox: {d.email}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Button type="submit" className="h-10 px-5 bg-slate-900 hover:bg-slate-850 font-bold text-xs rounded-xl">
                      Generate Alias
                    </Button>
                  </form>
                </div>

                <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200/60 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                          <th className="py-3 px-6">Label / Platform</th>
                          <th className="py-3 px-6">Masked Alias Address</th>
                          <th className="py-3 px-6">Forward To</th>
                          <th className="py-3 px-6 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                        {aliasList.map((alias) => (
                          <tr key={alias.id} className="hover:bg-slate-50/40 transition-colors">
                            <td className="py-4 px-6">
                              <span className="font-extrabold text-slate-900 block">{alias.label}</span>
                              <span className="text-[9px] text-slate-400 font-semibold block mt-0.5">Created {alias.createdDate}</span>
                            </td>
                            <td className="py-4 px-6 font-mono text-slate-500">
                              <div className="flex items-center gap-2">
                                <span className={alias.active ? "" : "line-through text-slate-300"}>{alias.aliasEmail}</span>
                                <button 
                                  onClick={() => handleCopy(alias.aliasEmail, alias.id)}
                                  className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                                >
                                  {copiedId === alias.id ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </td>
                            <td className="py-4 px-6 text-slate-500 truncate max-w-[180px]">
                              {alias.forwardTo}
                            </td>
                            <td className="py-4 px-6 text-right">
                              <div className="flex items-center justify-end gap-3">
                                <button 
                                  onClick={() => setAliasList(aliasList.map(item => item.id === alias.id ? { ...item, active: !item.active } : item))}
                                  className={`transition-colors ${alias.active ? "text-slate-800" : "text-slate-300"}`}
                                >
                                  {alias.active ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                                </button>
                                <button 
                                  onClick={() => setAliasList(aliasList.filter(item => item.id !== alias.id))}
                                  className="p-1.5 rounded-xl border border-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-505 transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "passkeys" && (
              <div className="space-y-6">
                <div className="bg-white border border-slate-200/50 rounded-2xl p-6 md:p-8 shadow-sm">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Passkey Security Setup</h2>
                    <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Setup biometric passwordless authentication using Touch ID, Face ID, or Windows Hello</p>
                  </div>

                  <div className="flex flex-col gap-4 mt-6">
                    <Button
                      onClick={handleRegisterPasskey}
                      disabled={isRegisteringPasskey}
                      className="h-10 px-6 bg-slate-900 hover:bg-slate-850 disabled:bg-slate-300 rounded-xl font-bold text-xs shadow-sm w-fit transition-all flex items-center gap-2"
                    >
                      {isRegisteringPasskey ? "Registering..." : "Add Biometric Passkey"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </section>
    </div>
  );
}
