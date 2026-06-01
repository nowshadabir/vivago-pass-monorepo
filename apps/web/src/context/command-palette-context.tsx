"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  CommandPaletteModal,
  type CommandItem,
  type VaultSearchHit,
} from "@/components/command-palette";
import { CONFIG, clearSession, getMasterKeyHex, getStorage } from "@/lib/sessionStore";
import { decryptData } from "@vivago-pass/ts-crypto";

interface CommandPaletteContextValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: boolean;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = useContext(CommandPaletteContext);
  if (!ctx) {
    throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  }
  return ctx;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = text.toLowerCase();
  let i = 0;
  for (const ch of q) {
    i = hay.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

function matchesQuery(query: string, item: CommandItem): boolean {
  if (!query.trim()) return true;
  const blob = [item.title, item.subtitle ?? "", ...(item.keywords ?? [])].join(" ");
  return fuzzyMatch(query, blob);
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [vaultHits, setVaultHits] = useState<VaultSearchHit[]>([]);
  const [vaultLoading, setVaultLoading] = useState(false);
  const vaultCacheRef = useRef<VaultSearchHit[] | null>(null);

  const isAuthenticatedRoute =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/documents") ||
    pathname.startsWith("/profile");

  const open = useCallback(() => {
    if (!isAuthenticatedRoute) return;
    setQuery("");
    setIsOpen(true);
  }, [isAuthenticatedRoute]);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
  }, []);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  const loadVaultIndex = useCallback(async () => {
    if (vaultCacheRef.current) {
      setVaultHits(vaultCacheRef.current);
      return;
    }
    if (typeof window === "undefined") return;

    const storage = getStorage();
    const userId = storage.getItem("x-user-id");
    const sessionToken = storage.getItem("session-token");
    const keyHex = getMasterKeyHex();
    if (!userId || !sessionToken || !keyHex) return;

    setVaultLoading(true);
    try {
      const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
      const key = await window.crypto.subtle.importKey(
        "raw",
        keyBytes.buffer,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
      );

      const res = await fetch(`${CONFIG.API_URL}/api/vault`, {
        headers: { "x-user-id": userId, "session-token": sessionToken },
      });
      if (!res.ok) return;

      const data = await res.json();
      const hits: VaultSearchHit[] = [];

      if (data.items) {
        await Promise.all(
          data.items.map(async (rawItem: { id: string; name?: string; ciphertext: string; iv: string; authTag: string }) => {
            let name = rawItem.name || "Untitled";
            try {
              const decryptedJson = await decryptData(
                rawItem.ciphertext,
                rawItem.iv,
                rawItem.authTag,
                key
              );
              const payload = JSON.parse(decryptedJson);
              name = payload.name || rawItem.name || name;
            } catch {
              /* use fallback name */
            }
            hits.push({ id: rawItem.id, name, type: "vault" });
          })
        );
      }

      vaultCacheRef.current = hits;
      setVaultHits(hits);
    } catch (err) {
      console.error("Command palette vault index failed:", err);
    } finally {
      setVaultLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && isAuthenticatedRoute) {
      loadVaultIndex();
    }
  }, [isOpen, isAuthenticatedRoute, loadVaultIndex]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!isAuthenticatedRoute) return;
        toggle();
      }
      if (e.key === "Escape" && isOpen) {
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle, close, isOpen, isAuthenticatedRoute]);

  const staticCommands = useMemo<CommandItem[]>(
    () => [
      {
        id: "nav-vault",
        group: "Navigate",
        title: "Go to Vault",
        subtitle: "All items",
        keywords: ["home", "passwords", "dashboard"],
        icon: "vault",
        run: () => router.push("/dashboard"),
      },
      {
        id: "nav-personal",
        group: "Navigate",
        title: "Personal vault",
        subtitle: "Your private items",
        keywords: ["personal", "private"],
        icon: "folder",
        run: () => router.push("/dashboard?category=personal"),
      },
      {
        id: "nav-shared",
        group: "Navigate",
        title: "Shared items",
        subtitle: "Sent and received",
        keywords: ["share", "collaboration"],
        icon: "share",
        run: () => router.push("/dashboard?category=shared"),
      },
      {
        id: "nav-trash",
        group: "Navigate",
        title: "Trash",
        subtitle: "Deleted items",
        keywords: ["delete", "removed"],
        icon: "trash",
        run: () => router.push("/dashboard?category=trash"),
      },
      {
        id: "nav-documents",
        group: "Navigate",
        title: "Documents",
        subtitle: "Secure files & attachments",
        keywords: ["files", "upload", "attachments"],
        icon: "documents",
        run: () => router.push("/documents"),
      },
      {
        id: "nav-profile",
        group: "Navigate",
        title: "Profile & settings",
        subtitle: "Account, passkeys, domains",
        keywords: ["settings", "account", "preferences"],
        icon: "profile",
        run: () => router.push("/profile"),
      },
      {
        id: "action-login",
        group: "Actions",
        title: "Add new login",
        subtitle: "Create a password entry",
        keywords: ["new", "create", "password", "credential"],
        icon: "plus",
        run: () => router.push("/dashboard?action=newLogin"),
      },
      {
        id: "action-vault",
        group: "Actions",
        title: "Create vault folder",
        subtitle: "Organize items into a vault",
        keywords: ["folder", "organize"],
        icon: "folder-plus",
        run: () => router.push("/dashboard?createVault=true"),
      },
      {
        id: "action-lock",
        group: "Actions",
        title: "Lock session",
        subtitle: "Sign out and clear keys",
        keywords: ["logout", "sign out", "exit"],
        icon: "logout",
        run: () => {
          clearSession();
          if (typeof window !== "undefined") {
            sessionStorage.removeItem("verify-pending-email");
          }
          router.push("/login");
        },
      },
    ],
    [router]
  );

  const vaultCommands = useMemo<CommandItem[]>(() => {
    return vaultHits
      .filter((hit) => fuzzyMatch(query, hit.name))
      .slice(0, 8)
      .map((hit) => ({
        id: `vault-${hit.id}`,
        group: "Vault",
        title: hit.name,
        subtitle: "Open in vault",
        keywords: [hit.name],
        icon: "key" as const,
        run: () => router.push(`/dashboard?select=${encodeURIComponent(hit.id)}`),
      }));
  }, [vaultHits, query, router]);

  const filteredStatic = useMemo(
    () => staticCommands.filter((item) => matchesQuery(query, item)),
    [staticCommands, query]
  );

  const allItems = useMemo(
    () => [...filteredStatic, ...vaultCommands],
    [filteredStatic, vaultCommands]
  );

  const runItem = useCallback(
    (item: CommandItem) => {
      close();
      item.run();
    },
    [close]
  );

  const value = useMemo(
    () => ({ open, close, toggle, isOpen }),
    [open, close, toggle, isOpen]
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
      {isAuthenticatedRoute && (
        <CommandPaletteModal
          isOpen={isOpen}
          query={query}
          onQueryChange={setQuery}
          items={allItems}
          vaultLoading={vaultLoading}
          onClose={close}
          onSelect={runItem}
        />
      )}
    </CommandPaletteContext.Provider>
  );
}
