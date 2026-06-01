"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStorage, getMasterKeyHex } from "@/lib/sessionStore";
import DocumentsView from "../../components/documents-view";
import Sidebar from "../../components/sidebar";
import { Sliders } from "lucide-react";

export default function DocumentsPage() {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeMobilePane, setActiveMobilePane] = useState<"sidebar" | "content">("content");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storage = getStorage();
    const userId = storage.getItem("x-user-id");
    const sessionToken = storage.getItem("session-token");
    const keyHex = getMasterKeyHex();

    if (!userId || userId === "undefined" || !sessionToken || !keyHex) {
      router.push("/login");
      return;
    }

    setIsAuthenticated(true);
  }, [router]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="animate-pulse text-xs font-semibold text-slate-400">
          Verifying security session...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full max-w-full bg-slate-50 dark:bg-slate-950 overflow-hidden font-sans text-slate-800 dark:text-slate-100 antialiased">
      {/* Reusable Sidebar (Left Column) */}
      <Sidebar 
        currentView="documents" 
        activeMobilePane={activeMobilePane === "sidebar" ? "sidebar" : "list"} 
        setActiveMobilePane={(pane) => setActiveMobilePane(pane === "sidebar" ? "sidebar" : "content")} 
      />

      {/* Main documents content */}
      <div className="flex-1 h-full overflow-hidden flex flex-col relative">
        {/* Toggle mobile sidebar button */}
        <button 
          onClick={() => setActiveMobilePane(activeMobilePane === "sidebar" ? "content" : "sidebar")}
          className="md:hidden absolute top-4 left-4 z-50 p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 bg-white shadow-sm transition-colors"
          title="Toggle Menu"
        >
          <Sliders className="w-4 h-4" />
        </button>
        
        <DocumentsView />
      </div>
    </div>
  );
}
