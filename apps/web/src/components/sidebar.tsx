"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStorage, getMasterKeyHex, clearSession, CONFIG } from "../lib/sessionStore";
import { decryptData } from "@vivago-pass/ts-crypto";
import Preferences from "./preferences";
import { 
  Shield, Layers, Lock, Folder, Share2, Trash2, FileText, 
  Sparkles, Sliders, ShieldCheck, HelpCircle, LogOut, 
  ChevronsUpDown, X, PanelLeft, FolderPlus, FileUp
} from "lucide-react";

interface SidebarProps {
  currentView: "vault" | "profile" | "documents";
  selectedCategory?: string;
  activeMobilePane?: string;
  setActiveMobilePane?: (pane: any) => void;
  onAddVault?: () => void;
}

export default function Sidebar({
  currentView,
  selectedCategory = "all",
  activeMobilePane = "list",
  setActiveMobilePane,
  onAddVault
}: SidebarProps) {
  const router = useRouter();
  const [itemsCount, setItemsCount] = useState(0);
  const [personalCount, setPersonalCount] = useState(0);
  const [trashCount, setTrashCount] = useState(0);
  const [sharedCount, setSharedCount] = useState(0);
  
  const [profileName, setProfileName] = useState("User");
  const [profileEmail, setProfileEmail] = useState("");
  const [profilePlan, setProfilePlan] = useState("starter");
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [customVaults, setCustomVaults] = useState<{ name: string; id: string }[]>([
    { name: "Work", id: "vlt_work" },
    { name: "Finance", id: "vlt_finance" }
  ]);

  const getInitials = (name: string) => {
    if (!name || name.trim() === "") return "U";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") {
      clearSession();
      sessionStorage.removeItem("verify-pending-email");
      router.push("/login");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storage = getStorage();
    const userId = storage.getItem("x-user-id");
    const sessionToken = storage.getItem("session-token");
    const keyHex = getMasterKeyHex();

    if (!userId || userId === "undefined" || !sessionToken || !keyHex) {
      return;
    }

    // Fetch counts and profile details
    async function loadSidebarData() {
      try {
        const res = await fetch(`${CONFIG.API_URL}/api/vault`, {
          headers: {
            "x-user-id": userId || "",
            "session-token": sessionToken || ""
          }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.items?.length) {
            const keyHex = getMasterKeyHex();
            if (keyHex) {
              try {
                const keyBytes = new Uint8Array(
                  keyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
                );
                const key = await crypto.subtle.importKey(
                  "raw",
                  keyBytes.buffer,
                  { name: "AES-GCM", length: 256 },
                  true,
                  ["decrypt"]
                );
                const vaultIds = await Promise.all(
                  data.items.map(async (raw: { ciphertext: string; iv: string; authTag: string }) => {
                    try {
                      const json = await decryptData(
                        raw.ciphertext,
                        raw.iv,
                        raw.authTag,
                        key
                      );
                      const payload = JSON.parse(json);
                      return payload.vaultID || "vlt_personal";
                    } catch {
                      return "vlt_personal";
                    }
                  })
                );
                setTrashCount(vaultIds.filter((id) => id === "vlt_trash").length);
                setItemsCount(vaultIds.filter((id) => id !== "vlt_trash").length);
                setPersonalCount(vaultIds.filter((id) => id === "vlt_personal").length);
              } catch {
                setItemsCount(data.items.length);
              }
            } else {
              setItemsCount(data.items.length);
            }
          } else if (data.items) {
            setItemsCount(0);
            setPersonalCount(0);
            setTrashCount(0);
          }
        }
      } catch (err) {
        console.error("Failed to load items list for sidebar counts:", err);
      }

      // Fetch shared items count
      try {
        const sentRes = await fetch(`${CONFIG.API_URL}/api/shares/sent`, {
          headers: {
            "x-user-id": userId || "",
            "session-token": sessionToken || ""
          }
        });
        const receivedRes = await fetch(`${CONFIG.API_URL}/api/shares/received`, {
          headers: {
            "x-user-id": userId || "",
            "session-token": sessionToken || ""
          }
        });
        let sentCount = 0;
        let receivedCount = 0;
        if (sentRes.ok) {
          const sentData = await sentRes.json();
          if (sentData.items) sentCount = sentData.items.length;
        }
        if (receivedRes.ok) {
          const receivedData = await receivedRes.json();
          if (receivedData.items) receivedCount = receivedData.items.length;
        }
        setSharedCount(sentCount + receivedCount);
      } catch (err) {
        console.error("Failed to load shared items counts:", err);
      }

      // Fetch profile
      try {
        const profileRes = await fetch(`${CONFIG.API_URL}/api/user/profile`, {
          headers: {
            "x-user-id": userId || "",
            "session-token": sessionToken || ""
          }
        });
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setProfileName(profileData.name || "User");
          setProfileEmail(profileData.email || getStorage().getItem("user-email") || "");
          setProfilePlan(profileData.plan || "starter");
        } else {
          const storedEmail = getStorage().getItem("user-email") || "";
          setProfileEmail(storedEmail);
          if (storedEmail) {
            const prefix = storedEmail.split("@")[0];
            setProfileName(prefix.charAt(0).toUpperCase() + prefix.slice(1));
          }
        }
      } catch (err) {
        console.error("Failed to load profile in sidebar:", err);
        const storedEmail = getStorage().getItem("user-email") || "";
        setProfileEmail(storedEmail);
        if (storedEmail) {
          const prefix = storedEmail.split("@")[0];
          setProfileName(prefix.charAt(0).toUpperCase() + prefix.slice(1));
        }
      }
    }

    loadSidebarData();
  }, []);

  const handleVaultNavigation = (category: string) => {
    router.push(`/dashboard?category=${category}`);
    if (setActiveMobilePane) {
      setActiveMobilePane("list");
    }
  };

  return (
    <>
      <aside className={`w-full md:w-60 lg:w-64 h-full min-h-0 bg-slate-50 border-r border-slate-200/60 flex flex-col justify-between overflow-hidden ${
        activeMobilePane === "sidebar" ? "flex" : "hidden"
      } md:flex text-slate-700 shrink-0`}>
        <div className="vivago-scrollbar flex flex-col space-y-4 overflow-y-auto overflow-x-hidden min-h-0 flex-1 p-3.5 lg:p-4 pb-2">
          {/* Header */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <img src="/logo.jpg" alt="Vivago Pass Logo" className="w-8.5 h-8.5 rounded-lg object-cover shadow-sm" />
              <span className="font-extrabold text-sm text-slate-900 tracking-tight">Vivago Pass</span>
            </div>
            <button 
              onClick={() => setActiveMobilePane && setActiveMobilePane(currentView === "documents" ? "content" : "list")} 
              className="p-1.5 rounded-lg hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-all md:hidden"
              title="Close Menu"
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
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Vaults</span>
                <button 
                  onClick={onAddVault || (() => router.push("/dashboard?createVault=true"))}
                  className="p-0.5 rounded hover:bg-slate-200/60 text-slate-400 hover:text-slate-600 transition-all"
                  title="Create new vault category"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
              </div>

              <nav className="space-y-1">
                <button 
                  onClick={() => handleVaultNavigation("all")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border ${
                    selectedCategory === "all" && currentView === "vault"
                      ? "bg-white text-slate-900 shadow-sm border-slate-200/60" 
                      : "text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Layers className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="text-xs font-bold block leading-tight">All items</span>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">{itemsCount} items</span>
                    </div>
                  </div>
                </button>

                <button 
                  onClick={() => handleVaultNavigation("personal")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border ${
                    selectedCategory === "personal" && currentView === "vault"
                      ? "bg-white text-slate-900 shadow-sm border-slate-200/60" 
                      : "text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Lock className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="text-xs font-bold block leading-tight">Personal</span>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">{personalCount} items</span>
                    </div>
                  </div>
                </button>

                {customVaults.map((vault) => (
                  <button 
                    key={vault.id}
                    onClick={() => handleVaultNavigation(vault.name.toLowerCase())}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border ${
                      selectedCategory === vault.name.toLowerCase() && currentView === "vault"
                        ? "bg-white text-slate-900 shadow-sm border-slate-200/60" 
                        : "text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Folder className="w-4 h-4 text-slate-400" />
                      <div>
                        <span className="text-xs font-bold block leading-tight truncate max-w-[120px]">{vault.name}</span>
                        <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">Vault</span>
                      </div>
                    </div>
                  </button>
                ))}

                <button 
                  onClick={() => handleVaultNavigation("shared")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border ${
                    selectedCategory === "shared" && currentView === "vault"
                      ? "bg-white text-slate-900 shadow-sm border-slate-200/60" 
                      : "text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Share2 className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="text-xs font-bold block leading-tight">Shared</span>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">{sharedCount} items</span>
                    </div>
                  </div>
                </button>

                <button 
                  onClick={() => handleVaultNavigation("trash")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border ${
                    selectedCategory === "trash" && currentView === "vault"
                      ? "bg-white text-slate-900 shadow-sm border-slate-200/60" 
                      : "text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Trash2 className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="text-xs font-bold block leading-tight">Trash</span>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">{trashCount} items</span>
                    </div>
                  </div>
                </button>

                <button 
                  onClick={() => router.push("/documents")}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-all border ${
                    currentView === "documents"
                      ? "bg-white text-slate-900 shadow-sm border-slate-200/60"
                      : "text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <FileText className={`w-4 h-4 ${currentView === "documents" ? "text-indigo-650" : "text-slate-400"}`} />
                    <div>
                      <span className="text-xs font-bold block leading-tight">Documents</span>
                      <span className="text-[10px] text-slate-400 font-semibold block mt-0.5">Secure files</span>
                    </div>
                  </div>
                </button>
              </nav>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="p-4 pt-0 space-y-3.5">
          {/* Upgrade Plan Card */}
          {/* <div className="bg-[#eef2ff] border border-indigo-100/50 rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-indigo-600 shadow-sm">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider leading-tight">Current plan</p>
                <p className="text-xs font-extrabold text-slate-900 leading-tight">Pro trial</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-500 leading-relaxed mt-0.5">
              Upgrade to Pro to get the latest and exclusive security features.
            </p>
            <button onClick={() => router.push("/dashboard")} className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-indigo-655 font-bold text-xs py-2 rounded-xl shadow-sm flex items-center justify-center gap-1 transition-all active:scale-[0.98] mt-1">
              ⚡ Upgrade to Pro
            </button>
          </div> */}

          {/* Quick Settings links */}
          <nav className="space-y-0.5 px-1 border-t border-slate-200/60 pt-2">
            <button onClick={() => setIsPreferencesOpen(true)} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 transition-all">
              <Sliders className="w-3.5 h-3.5 text-slate-400" />
              <span>Preferences</span>
            </button>
            <button onClick={() => router.push("/import")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 transition-all">
              <FileUp className="w-3.5 h-3.5 text-slate-400" />
              <span>Import from Proton Pass</span>
            </button>
            <button onClick={() => router.push("/dashboard")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 transition-all">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              <span>Security Center</span>
            </button>
            <button onClick={() => router.push("/dashboard")} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200/30 hover:text-slate-900 transition-all">
              <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
              <span>Help</span>
            </button>
            <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-red-655 hover:bg-rose-50/50 hover:text-rose-700 transition-all mt-1">
              <LogOut className="w-3.5 h-3.5 text-red-400" />
              <span>Logout</span>
            </button>
          </nav>

          {/* User Profile */}
          <div 
            onClick={() => router.push("/profile")}
            className="flex items-center justify-between border-t border-slate-200/60 pt-3 px-2 rounded-xl cursor-pointer hover:bg-slate-200/40 group transition-all"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8.5 h-8.5 rounded-full bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center text-white font-extrabold text-xs shadow-md shadow-violet-500/10 group-hover:scale-105 transition-transform">
                {getInitials(profileName)}
              </div>
              <div className="text-left">
                <p className="text-xs font-extrabold text-slate-900 leading-none group-hover:text-indigo-650 transition-colors">
                  {profileName}
                </p>
                <p className="text-[10px] text-slate-500 font-bold leading-none mt-0.5 capitalize">
                  {profilePlan} plan
                </p>
              </div>
            </div>
            <button className="p-1 rounded-md text-slate-400 group-hover:text-slate-600 transition-colors" title="Settings / Profile">
              <ChevronsUpDown className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Preferences Dialog rendered locally to avoid dashboard dependency */}
      <Preferences open={isPreferencesOpen} onClose={() => setIsPreferencesOpen(false)} />
    </>
  );
}
