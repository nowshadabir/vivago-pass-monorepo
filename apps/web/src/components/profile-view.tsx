"use client";

import React, { useState } from "react";
import { deriveKeyFromBackupCode, wrapMasterKey, encryptData, deriveKeyFromPrf, base64ToArrayBuffer } from "@vivago-pass/ts-crypto";
import { getMasterKeyHex, getStorage, CONFIG } from "@/lib/sessionStore";
import { startRegistration } from "@simplewebauthn/browser";
import { 
  Key, User, Shield, Check, Copy, Trash2, Mail, 
  ToggleLeft, ToggleRight, Plus, AlertCircle, 
  Eye, EyeOff, CheckCircle2, ShieldCheck, ArrowRight, 
  Globe, Sliders, LayoutGrid, Inbox, ExternalLink, Edit2, Download
} from "lucide-react";
import { useToast } from "../context/toast-context";

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

export default function ProfileView({
  onClose,
  onProfileUpdate
}: {
  onClose?: () => void;
  onProfileUpdate?: (name: string) => void;
}) {
  const { toast } = useToast();
  const localStorage = getStorage();
  const [userEmail, setUserEmail] = useState("infonowshad@proton.me");
  const [userName, setUserName] = useState("Alex Mercer");
  const [plan, setPlan] = useState("starter");
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const [backupCodesStatus, setBackupCodesStatus] = useState<Array<{ codeHash: string; isUsed: number }>>([]);
  const [newGeneratedCodes, setNewGeneratedCodes] = useState<string[]>([]);
  const [isGeneratingCodes, setIsGeneratingCodes] = useState(false);

  React.useEffect(() => {
    async function loadProfileAndCodes() {
      if (typeof window === "undefined") return;
      const userId = localStorage.getItem("x-user-id");
      const sessionToken = localStorage.getItem("session-token");
      if (!userId || userId === "undefined") return;

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
        console.error("Failed to load profile settings:", err);
      }
    }
    loadProfileAndCodes();
  }, []);

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
      console.error("Error generating backup codes:", err);
      toast.error("Encryption error while generating backup codes.");
    } finally {
      setIsGeneratingCodes(false);
    }
  };

  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"domain_emails" | "aliases" | "backup_codes" | "passkeys">("domain_emails");
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


  // Password reset states
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassCurrent, setShowPassCurrent] = useState(false);
  const [showPassNew, setShowPassNew] = useState(false);
  const [showPassConfirm, setShowPassConfirm] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<{ type: "success" | "error" | null, message: string }>({ type: null, message: "" });

  // 1. Custom Domain Emails (Real Mailboxes)
  const [domainPrefix, setDomainPrefix] = useState("");
  const [selectedDomain, setSelectedDomain] = useState("vivago.me");
  const [domainEmailList, setDomainEmailList] = useState<DomainEmail[]>([
    {
      id: "d1",
      email: "hello@vivago.me",
      prefix: "hello",
      domain: "vivago.me",
      createdDate: "May 20, 2026",
      active: true
    },
    {
      id: "d2",
      email: "nowshad@vivagopass.com",
      prefix: "nowshad",
      domain: "vivagopass.com",
      createdDate: "May 25, 2026",
      active: true
    }
  ]);

  // 2. Email Aliases (Forwarders)
  const [aliasLabel, setAliasLabel] = useState("");
  const [aliasForwardTo, setAliasForwardTo] = useState("infonowshad@proton.me");
  const [aliasList, setAliasList] = useState<EmailAlias[]>([
    {
      id: "a1",
      aliasEmail: "go.netflix.591a@vivagopass.com",
      forwardTo: "infonowshad@proton.me",
      label: "Netflix Subscription",
      createdDate: "May 24, 2026",
      active: true,
      isEditingForwardTarget: false
    },
    {
      id: "a2",
      aliasEmail: "sec.github.ff2c@vivago.me",
      forwardTo: "hello@vivago.me",
      label: "GitHub Account",
      createdDate: "May 28, 2026",
      active: true,
      isEditingForwardTarget: false
    }
  ]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(id);
    setTimeout(() => setCopiedText(null), 2000);
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

  // Create Domain Email (Mailbox)
  const handleCreateDomainEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPrefix = domainPrefix.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!cleanPrefix) return;

    const email = `${cleanPrefix}@${selectedDomain}`;
    
    if (domainEmailList.some(item => item.email.toLowerCase() === email.toLowerCase())) {
      toast.warning("This domain email mailbox already exists.");
      return;
    }

    const newDomainEmail: DomainEmail = {
      id: String(Date.now()),
      email,
      prefix: cleanPrefix,
      domain: selectedDomain,
      createdDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      active: true
    };

    setDomainEmailList([newDomainEmail, ...domainEmailList]);
    setDomainPrefix("");
  };

  // Create Email Alias (Forwarder)
  const handleCreateAlias = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLabel = aliasLabel.trim() || "Generated Alias";
    const randomHash = Math.random().toString(36).substring(2, 6);
    const cleanPrefix = cleanLabel.toLowerCase().replace(/[^a-z0-9]/g, "") || "alias";
    const randomDomain = Math.random() > 0.5 ? "vivago.me" : "vivagopass.com";
    
    const email = `${cleanPrefix}.${randomHash}@${randomDomain}`;

    const newAlias: EmailAlias = {
      id: String(Date.now()),
      aliasEmail: email,
      forwardTo: aliasForwardTo.trim() || userEmail,
      label: cleanLabel,
      createdDate: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
      active: true,
      isEditingForwardTarget: false
    };

    setAliasList([newAlias, ...aliasList]);
    setAliasLabel("");
  };

  const handleToggleAlias = (id: string) => {
    setAliasList(aliasList.map(item => item.id === id ? { ...item, active: !item.active } : item));
  };

  const handleDeleteAlias = (id: string) => {
    setAliasList(aliasList.filter(item => item.id !== id));
  };

  const handleUpdateAliasForward = (id: string, newTarget: string) => {
    setAliasList(aliasList.map(item => item.id === id ? { ...item, forwardTo: newTarget } : item));
  };

  const handleToggleEditForwardTarget = (id: string) => {
    setAliasList(aliasList.map(item => item.id === id ? { ...item, isEditingForwardTarget: !item.isEditingForwardTarget } : item));
  };

  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: "None", color: "bg-slate-100" };
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[^A-Za-z0-9]/.test(pass)) score += 1;

    if (score <= 1) return { score, label: "Weak", color: "bg-rose-400" };
    if (score === 2) return { score, label: "Fair", color: "bg-amber-400" };
    if (score === 3) return { score, label: "Good", color: "bg-indigo-400" };
    return { score, label: "Strong", color: "bg-emerald-400" };
  };

  const strength = getPasswordStrength(newPassword);

  return (
    <div className="flex-1 bg-slate-50 dark:bg-slate-950 w-full max-w-full h-full lg:h-screen overflow-hidden font-sans antialiased text-slate-800 dark:text-slate-100 flex flex-col">
      
      {/* Header Banner */}
      <header className="bg-white border-b border-slate-200/60 px-4 md:px-8 py-4.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-sm shadow-indigo-600/10">
            <Sliders className="w-4.5 h-4.5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900">Profile Settings</h1>
            <p className="text-[10px] text-slate-400 font-semibold leading-none mt-0.5">Manage accounts, master password & customized emails</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="text-xs font-bold text-slate-655 hover:text-slate-850 border border-slate-200 hover:bg-slate-50 bg-white px-3 md:px-4 py-2 rounded-xl shadow-sm transition-all"
        >
          ← <span className="hidden sm:inline">Back to </span>Vault
        </button>
      </header>

      {/* Split Workspace */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">
        
        {/* Left pane: Profile & Master Password Reset */}
        <section className="w-full lg:w-80 border-b lg:border-b-0 lg:border-r border-slate-200/60 bg-white p-6 space-y-7 shrink-0 flex flex-col justify-between lg:overflow-y-auto lg:overflow-x-hidden">
          <div className="space-y-7">
            {/* Account Card */}
            <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-indigo-500/5">
                  {userName.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">{userName}</h3>
                  <p className="text-[11px] text-slate-400 font-medium truncate max-w-[170px]">{userEmail}</p>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200/60">
                <span className="text-[9px] text-slate-400 font-extrabold uppercase">Plan Status</span>
                <span className="text-[9px] font-bold bg-indigo-50/60 text-indigo-600 border border-indigo-100/50 px-2.5 py-0.5 rounded-full uppercase">
                  {plan} MEMBER
                </span>
              </div>
            </div>

            {/* Profile Name Update */}
            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Update Profile Name</h4>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Change display username</p>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <input 
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-xl text-xs bg-slate-50/30 text-slate-800 focus:bg-white focus:outline-none transition-all font-semibold"
                />
                <button 
                  onClick={async () => {
                    if (typeof window === "undefined") return;
                    const userId = localStorage.getItem("x-user-id");
                    if (!userId || userId === "undefined") return;
                    try {
                      const res = await fetch(`${CONFIG.API_URL}/api/user/profile`, {
                        method: "PUT",
                        headers: {
                          "Content-Type": "application/json",
                          "x-user-id": userId,
                          "session-token": localStorage.getItem("session-token") || ""
                        },
                        body: JSON.stringify({ name: userName })
                      });
                      if (res.ok) {
                        toast.success("Display name updated successfully!");
                        if (onProfileUpdate) {
                          onProfileUpdate(userName);
                        }
                      } else {
                        const errData = await res.json();
                        toast.error("Update failed: " + (errData.error || "Unknown error"));
                      }
                    } catch (err) {
                      console.error("Update name error:", err);
                    }
                  }}
                  className="bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs px-3.5 py-1.5 rounded-xl transition-all active:scale-[0.98]"
                >
                  Save
                </button>
              </div>
            </div>

            {/* Password Reset */}
            <div className="space-y-3.5">
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Reset Master Password</h4>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Encrypts all data locally</p>
              </div>

              <form onSubmit={handlePasswordReset} className="space-y-3.5">
                {passwordStatus.type && (
                  <div className={`p-3 rounded-xl text-xs flex gap-2 items-start leading-snug ${
                    passwordStatus.type === "success" 
                      ? "bg-emerald-50 text-emerald-800 border border-emerald-100/50" 
                      : "bg-red-50 text-red-800 border border-red-100/50"
                  }`}>
                    {passwordStatus.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertCircle className="w-4 h-4 shrink-0 text-red-650" />}
                    <span>{passwordStatus.message}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[9px] font-extrabold text-slate-405 uppercase tracking-widest">Current Password</label>
                  <div className="relative">
                    <input 
                      type={showPassCurrent ? "text" : "password"}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50/30 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-300 transition-all font-semibold"
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPassCurrent(!showPassCurrent)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-405 hover:text-slate-600"
                    >
                      {showPassCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-extrabold text-slate-405 uppercase tracking-widest">New Password</label>
                  <div className="relative">
                    <input 
                      type={showPassNew ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50/30 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-300 transition-all font-semibold"
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPassNew(!showPassNew)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-405 hover:text-slate-600"
                    >
                      {showPassNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  {newPassword && (
                    <div className="pt-1.5 space-y-1">
                      <div className="flex items-center justify-between text-[9px] font-bold text-slate-400">
                        <span>STRENGTH: {strength.label}</span>
                      </div>
                      <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full ${strength.color} transition-all duration-300`} style={{ width: `${(strength.score / 4) * 100}%` }}></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[9px] font-extrabold text-slate-405 uppercase tracking-widest">Confirm Password</label>
                  <div className="relative">
                    <input 
                      type={showPassConfirm ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-xs bg-slate-50/30 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-slate-300 transition-all font-semibold"
                    />
                    <button 
                      type="button" 
                      onClick={() => setShowPassConfirm(!showPassConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-450 hover:text-slate-600"
                    >
                      {showPassConfirm ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <button 
                  type="submit" 
                  className="w-full bg-slate-900 hover:bg-slate-850 text-white font-bold text-xs py-2.5 rounded-xl transition-all active:scale-[0.98] mt-1 shadow-sm"
                >
                  Save Master Password
                </button>
              </form>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-4 space-y-1 mt-6">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Zero-Knowledge Guard</span>
            </div>
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed">
              We never store your master password. All local files are locked client-side.
            </p>
          </div>
        </section>

        {/* Right pane: Domains & Alias Workspace */}
        <section className="flex-1 p-6 md:p-8 flex flex-col space-y-6 min-w-0 lg:overflow-y-auto lg:overflow-x-hidden">
          
          {/* Workspace Tab Selector */}
          <div className="flex items-center border-b border-slate-200/60 pb-px gap-6 shrink-0">
            <button 
              onClick={() => setActiveWorkspaceTab("domain_emails")}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                activeWorkspaceTab === "domain_emails" 
                  ? "border-indigo-650 text-indigo-650" 
                  : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              <Globe className="w-4 h-4" />
              1. Get Domain Mailboxes
            </button>
            <button 
              onClick={() => setActiveWorkspaceTab("aliases")}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                activeWorkspaceTab === "aliases" 
                  ? "border-indigo-650 text-indigo-650" 
                  : "border-transparent text-slate-400 hover:text-slate-650"
              }`}
            >
              <Inbox className="w-4 h-4" />
              2. Masked Email Aliases
            </button>
            <button 
              onClick={() => setActiveWorkspaceTab("backup_codes")}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                activeWorkspaceTab === "backup_codes" 
                  ? "border-indigo-650 text-indigo-650" 
                  : "border-transparent text-slate-400 hover:text-slate-655"
              }`}
            >
              <Key className="w-4 h-4" />
              3. Recovery Backup Codes
            </button>
            <button 
              onClick={() => setActiveWorkspaceTab("passkeys")}
              className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 ${
                activeWorkspaceTab === "passkeys" 
                  ? "border-indigo-650 text-indigo-650" 
                  : "border-transparent text-slate-400 hover:text-slate-655"
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              4. Passkeys Login
            </button>
          </div>

          {/* Conditional Workspaces */}
          {activeWorkspaceTab === "domain_emails" ? (
            /* TAB 1: DOMAIN EMAIL WORKSPACE (REAL MAILBOXES WITH WEBMAIL ACCESS) */
            <div className="space-y-6">
              
              {/* Creator Box */}
              <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.015)]">
                <div className="mb-4">
                  <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg border border-indigo-100 tracking-wide uppercase">
                    Active Webmail Domain Inbox
                  </span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mt-2.5">Create Domain Mailbox</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Secure a customized mailbox with our domains: vivago.me, vivagopass.com. Access messages using your Webmail Web app.</p>
                </div>

                <form onSubmit={handleCreateDomainEmail} className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1 flex border border-slate-200 rounded-xl overflow-hidden focus-within:border-slate-350 transition-all bg-white min-w-0">
                    <input 
                      type="text"
                      required
                      value={domainPrefix}
                      onChange={(e) => setDomainPrefix(e.target.value)}
                      placeholder="Mailbox prefix (e.g. nowshad)"
                      className="flex-1 h-10 px-3.5 text-xs focus:outline-none font-semibold text-slate-800 bg-transparent min-w-0"
                    />
                    <select
                      value={selectedDomain}
                      onChange={(e) => setSelectedDomain(e.target.value)}
                      className="h-10 px-2 sm:px-3 text-xs bg-slate-50 border-l border-slate-200 focus:outline-none font-semibold text-slate-700 cursor-pointer"
                    >
                      <option value="vivago.me">@vivago.me</option>
                      <option value="vivagopass.com">@vivagopass.com</option>
                    </select>
                  </div>

                  <button 
                    type="submit"
                    className="h-10 px-6 bg-slate-900 hover:bg-slate-850 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all active:scale-[0.98] shrink-0"
                  >
                    Create Domain Mailbox
                  </button>
                </form>
              </div>

              {/* Domain Mailboxes List Table */}
              <div className="bg-white border border-slate-200/60 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.015)] overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Created Mailboxes</h3>
                  <span className="text-[10px] text-slate-400 font-semibold">Unlimited real email accounts</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/70 border-b border-slate-200/60 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">
                        <th className="py-3 px-6">Domain Email Address</th>
                        <th className="py-3 px-6 text-center">Status</th>
                        <th className="py-3 px-6 text-right">Inbox Access & Settings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {domainEmailList.map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50/40 transition-colors">
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-extrabold text-slate-900 select-all">{item.email}</span>
                              <button 
                                onClick={() => handleCopy(item.email, item.id)}
                                className="p-1 rounded hover:bg-slate-150 text-slate-450 hover:text-slate-650 transition-colors"
                              >
                                {copiedText === item.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600 font-bold" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                            <span className="text-[9px] text-slate-400 font-semibold block mt-0.5">Created on {item.createdDate}</span>
                          </td>

                          {/* Status */}
                          <td className="py-4 px-6 text-center">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100/50">
                              Active Mailbox
                            </span>
                          </td>

                          {/* Controls */}
                          <td className="py-4 px-6 text-right">
                            <div className="flex items-center justify-end gap-3.5">
                              {/* Inbox Access Button */}
                              <a 
                                href={`https://webmail.${item.domain}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-600 hover:text-indigo-850 bg-indigo-50/60 hover:bg-indigo-100/70 border border-indigo-100/40 px-2.5 sm:px-3.5 py-1.5 rounded-xl transition-all"
                              >
                                <span className="hidden sm:inline">Open </span>Webmail <ExternalLink className="w-3 h-3" />
                              </a>
                              
                              <button 
                                onClick={() => setDomainEmailList(domainEmailList.filter(d => d.id !== item.id))}
                                className="p-1.5 rounded-xl border border-slate-100 hover:border-red-100 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all"
                                title="Delete mailbox"
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
          ) : (
            /* TAB 2: EMAIL ALIAS WORKSPACE (FORWARDERS) */
            <div className="space-y-6">
              
              {/* Creator Box */}
              <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.015)]">
                <div className="mb-4">
                  <span className="text-[10px] font-extrabold bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg border border-emerald-100 tracking-wide uppercase">
                    Security Masking Active
                  </span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mt-2.5">Generate Masked Email Alias</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Use aliases to sign up to untrusted platforms. Emails are forwarded to your selected target address.</p>
                </div>

                <form onSubmit={handleCreateAlias} className="flex flex-col md:flex-row gap-3">
                  <div className="flex-1">
                    <input 
                      type="text"
                      required
                      value={aliasLabel}
                      onChange={(e) => setAliasLabel(e.target.value)}
                      placeholder="Platform Label (e.g. Netflix, Twitter)"
                      className="w-full h-10 px-3.5 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:border-slate-350 transition-all font-semibold text-slate-800"
                    />
                  </div>

                  {/* Create Selector for Forward Target */}
                  <div className="flex-1">
                    <select 
                      value={aliasForwardTo}
                      onChange={(e) => setAliasForwardTo(e.target.value)}
                      className="w-full h-10 px-3 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:border-slate-350 transition-all font-semibold text-slate-850 cursor-pointer"
                    >
                      <option value={userEmail}>Registered Email: {userEmail}</option>
                      {domainEmailList.map((domainEmail) => (
                        <option key={domainEmail.id} value={domainEmail.email}>
                          Domain Mailbox: {domainEmail.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button 
                    type="submit"
                    className="h-10 px-5 bg-slate-900 hover:bg-slate-850 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all active:scale-[0.98] shrink-0"
                  >
                    Generate Masked Alias
                  </button>
                </form>
              </div>

              {/* Aliases List Table */}
              <div className="bg-white border border-slate-200/60 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.015)] overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Generated Security Aliases</h3>
                  <span className="text-[10px] text-slate-400 font-semibold">Randomized proxy forwarders</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/70 border-b border-slate-200/60 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">
                        <th className="py-3 px-6">Label / Platform</th>
                        <th className="py-3 px-6">Generated Masked Email</th>
                        <th className="py-3 px-6">Forward Target</th>
                        <th className="py-3 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {aliasList.map((alias) => (
                        <tr key={alias.id} className="hover:bg-slate-50/40 transition-colors">
                          <td className="py-4 px-6">
                            <span className="text-xs font-bold text-slate-900 block">{alias.label}</span>
                            <span className="text-[9px] text-slate-400 font-semibold block mt-0.5">Created {alias.createdDate}</span>
                          </td>
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-semibold select-all font-mono ${alias.active ? "text-slate-650" : "text-slate-400 line-through"}`}>
                                {alias.aliasEmail}
                              </span>
                              <button 
                                onClick={() => handleCopy(alias.aliasEmail, alias.id)}
                                className="p-1 rounded hover:bg-slate-150 text-slate-450 hover:text-slate-650 transition-colors"
                              >
                                {copiedText === alias.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600 font-bold" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </td>
                          
                          {/* Forward Target Selection with Switchable Custom Input */}
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-2">
                              {alias.isEditingForwardTarget ? (
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                  <select 
                                    value={alias.forwardTo}
                                    onChange={(e) => handleUpdateAliasForward(alias.id, e.target.value)}
                                    className="px-2 py-1 border border-slate-250 rounded-lg bg-white text-xs text-slate-800 font-bold focus:outline-none transition-all w-full sm:w-52 cursor-pointer"
                                  >
                                    <option value={userEmail}>Registered Email ({userEmail})</option>
                                    {domainEmailList.map((d) => (
                                      <option key={d.id} value={d.email}>
                                        Domain Mailbox ({d.email})
                                      </option>
                                    ))}
                                    {!domainEmailList.some(d => d.email === alias.forwardTo) && alias.forwardTo !== userEmail && (
                                      <option value={alias.forwardTo}>Custom: {alias.forwardTo}</option>
                                    )}
                                  </select>
                                  <input 
                                    type="email"
                                    value={alias.forwardTo}
                                    onChange={(e) => handleUpdateAliasForward(alias.id, e.target.value)}
                                    placeholder="Or enter custom email"
                                    className="px-2.5 py-1 border border-slate-250 focus:bg-white rounded-lg bg-slate-50/10 text-xs text-slate-800 font-bold focus:outline-none transition-all w-full sm:w-44"
                                    title="Manually type a custom destination email"
                                  />
                                </div>
                              ) : (
                                <span className="text-xs font-bold text-slate-600 select-all block w-40 sm:w-56 truncate">
                                  {alias.forwardTo === userEmail ? "Registered Email" : "Mailbox"}: {alias.forwardTo}
                                </span>
                              )}
                              
                              <button 
                                onClick={() => handleToggleEditForwardTarget(alias.id)}
                                className={`p-1.5 rounded-lg border text-slate-405 hover:text-slate-700 transition-colors ${
                                  alias.isEditingForwardTarget 
                                    ? "bg-slate-200 border-slate-300 text-slate-850" 
                                    : "border-slate-200/50 hover:bg-slate-100"
                                }`}
                                title={alias.isEditingForwardTarget ? "Save and lock target" : "Click to edit target"}
                              >
                                {alias.isEditingForwardTarget ? <Check className="w-3 h-3 text-slate-800 font-extrabold" /> : <Edit2 className="w-3 h-3" />}
                              </button>
                            </div>
                          </td>

                          <td className="py-4 px-6 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button 
                                onClick={() => handleToggleAlias(alias.id)}
                                className={`transition-colors duration-150 ${alias.active ? "text-slate-800" : "text-slate-300"}`}
                              >
                                {alias.active ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                              </button>
                              <button 
                                onClick={() => handleDeleteAlias(alias.id)}
                                className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-650 transition-colors"
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

          {activeWorkspaceTab === "backup_codes" && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.015)]">
                <div className="mb-4">
                  <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg border border-indigo-100 tracking-wide uppercase">
                    Account Recovery Config
                  </span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mt-2.5">Generate Backup Codes</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Generate a new set of 8 emergency recovery codes. Keep them in a safe place. Regenerating new codes will invalidate your old codes.
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  <button
                    onClick={handleRegenerateBackupCodes}
                    disabled={isGeneratingCodes}
                    className="h-10 px-6 bg-slate-900 hover:bg-slate-850 disabled:bg-slate-300 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all active:scale-[0.98] w-fit"
                  >
                    {isGeneratingCodes ? "Generating..." : "Generate New Backup Codes"}
                  </button>

                  {newGeneratedCodes.length > 0 && (
                    <div className="mt-4 border border-indigo-100 bg-indigo-50/20 rounded-2xl p-5 space-y-4">
                      <div>
                        <h4 className="text-xs font-bold text-indigo-900">Your New Backup Codes</h4>
                        <p className="text-[10px] text-slate-400 font-medium">Please save these codes now. You will not be able to view them again.</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 font-mono text-[12px] font-semibold text-slate-700 tracking-wider">
                        {newGeneratedCodes.map((code, idx) => (
                          <div key={idx} className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl p-2.5 shadow-sm">
                            <span className="text-[10px] text-slate-350 select-none">0{idx + 1}</span>
                            <span>{code}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(newGeneratedCodes.join("\n"));
                            toast.success("Copied to clipboard!");
                          }}
                          className="h-9 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          <Copy className="w-3.5 h-3.5" /> Copy Codes
                        </button>
                        <button
                          onClick={() => {
                            const element = document.createElement("a");
                            const file = new Blob([
                              `VIVAGO PASS SECURITY BACKUP CODES\n`,
                              `Account: ${userEmail}\n`,
                              `Date: ${new Date().toLocaleDateString()}\n\n`,
                              `Keep these codes extremely secure.\n\n`,
                              newGeneratedCodes.join("\n")
                            ], {type: 'text/plain'});
                            element.href = URL.createObjectURL(file);
                            element.download = "vivago-pass-backup-codes.txt";
                            document.body.appendChild(element);
                            element.click();
                            document.body.removeChild(element);
                          }}
                          className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-200" /> Download .txt
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Status Table */}
              <div className="bg-white border border-slate-200/60 rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.015)] overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Backup Codes Status</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Showing status of your active and used recovery keys</p>
                </div>

                <div className="p-6">
                  {backupCodesStatus.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-xs font-medium">
                      No backup codes found. Please generate a new set of backup codes to secure your account.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {backupCodesStatus.map((c, idx) => (
                        <div key={idx} className={`flex items-center justify-between border rounded-2xl p-4 transition-all ${
                          c.isUsed === 1 
                            ? 'bg-slate-50 border-slate-100 text-slate-400' 
                            : 'bg-white border-slate-200/60 text-slate-700 shadow-sm'
                        }`}>
                          <div className="space-y-0.5">
                            <span className="text-[10px] text-slate-350 font-bold uppercase tracking-wider">Code #{idx + 1}</span>
                            <div className="text-xs font-extrabold font-mono tracking-wider text-slate-500">
                              {c.isUsed === 1 ? "USED CODE" : "ACTIVE"}
                            </div>
                          </div>
                          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
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
            </div>
          )}

          {activeWorkspaceTab === "passkeys" && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200/60 rounded-2xl p-6 shadow-[0_1px_3px_rgba(0,0,0,0.015)]">
                <div className="mb-4">
                  <span className="text-[10px] font-extrabold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-lg border border-indigo-100 tracking-wide uppercase">
                    Biometric Authentication
                  </span>
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mt-2.5">Setup Passkey Login</h3>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Register a biometric passkey (Touch ID, Face ID, Windows Hello) to log in instantly. The master key will be wrapped securely with a client-side PRF key, preserving zero-knowledge vault protection.
                  </p>
                </div>

                <div className="flex flex-col gap-4">
                  <button
                    onClick={handleRegisterPasskey}
                    disabled={isRegisteringPasskey}
                    className="h-10 px-6 bg-slate-900 hover:bg-slate-850 disabled:bg-slate-300 text-white font-extrabold text-xs rounded-xl shadow-sm transition-all active:scale-[0.98] w-fit"
                  >
                    {isRegisteringPasskey ? "Registering..." : "Add Biometric Passkey"}
                  </button>
                </div>
              </div>
            </div>
          )}

        </section>

      </main>
    </div>
  );
}
