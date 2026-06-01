"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Folder,
  FolderPlus,
  Key,
  Layers,
  Loader2,
  LogOut,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";

export interface CommandItem {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  icon: "vault" | "folder" | "share" | "trash" | "documents" | "profile" | "plus" | "folder-plus" | "logout" | "key";
  run: () => void;
}

export interface VaultSearchHit {
  id: string;
  name: string;
  type: "vault";
}

const ICONS: Record<CommandItem["icon"], React.ReactNode> = {
  vault: <Layers className="w-4 h-4" />,
  folder: <Folder className="w-4 h-4" />,
  share: <Share2 className="w-4 h-4" />,
  trash: <Trash2 className="w-4 h-4" />,
  documents: <FileText className="w-4 h-4" />,
  profile: <User className="w-4 h-4" />,
  plus: <Plus className="w-4 h-4" />,
  "folder-plus": <FolderPlus className="w-4 h-4" />,
  logout: <LogOut className="w-4 h-4" />,
  key: <Key className="w-4 h-4" />,
};

interface CommandPaletteModalProps {
  isOpen: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  items: CommandItem[];
  vaultLoading: boolean;
  onClose: () => void;
  onSelect: (item: CommandItem) => void;
}

export function CommandPaletteModal({
  isOpen,
  query,
  onQueryChange,
  items,
  vaultLoading,
  onClose,
  onSelect,
}: CommandPaletteModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const item of items) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const flatItems = items;

  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeIndex >= flatItems.length) {
      setActiveIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, activeIndex]);

  if (!isOpen) return null;

  let rowOffset = 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatItems[activeIndex]) {
      e.preventDefault();
      onSelect(flatItems[activeIndex]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-in fade-in duration-150"
        aria-label="Close command palette"
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-xl rounded-2xl border border-slate-200/80 bg-white/95 dark:bg-slate-900/95 shadow-2xl shadow-slate-900/20 overflow-hidden animate-in zoom-in-95 fade-in duration-150"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search vault, jump anywhere, or type a command…"
              className="flex-1 bg-transparent text-sm font-medium text-slate-900 dark:text-slate-100 placeholder:text-slate-400 outline-none min-w-0"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-bold text-slate-500">
            esc
          </kbd>
        </div>

        <div className="vivago-scrollbar max-h-[min(52vh,420px)] overflow-y-auto overscroll-contain py-2">
          {vaultLoading && query.trim() && flatItems.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-xs font-semibold text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              Indexing your vault…
            </div>
          )}

          {!vaultLoading && flatItems.length === 0 && (
            <p className="py-10 text-center text-xs font-semibold text-slate-400">
              No matches — try &quot;documents&quot;, &quot;shared&quot;, or a site name
            </p>
          )}

          {grouped.map(([group, groupItems]) => (
            <div key={group} className="px-2 pb-1">
              <p className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {group}
              </p>
              <ul>
                {groupItems.map((item) => {
                  const index = rowOffset++;
                  const isActive = index === activeIndex;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => onSelect(item)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                          isActive
                            ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-100"
                            : "text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <span
                          className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
                            isActive
                              ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-800"
                              : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          }`}
                        >
                          {ICONS[item.icon]}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-xs font-bold truncate">{item.title}</span>
                          {item.subtitle && (
                            <span className="block text-[10px] font-semibold text-slate-400 truncate mt-0.5">
                              {item.subtitle}
                            </span>
                          )}
                        </span>
                        {isActive && (
                          <kbd className="hidden sm:inline text-[10px] font-bold text-indigo-400">↵</kbd>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80 text-[10px] font-semibold text-slate-400">
          <span className="flex items-center gap-3">
            <span>
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white dark:bg-slate-800">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white dark:bg-slate-800">↵</kbd> run
            </span>
          </span>
          <span className="flex items-center gap-1 text-indigo-500/80">
            <Sparkles className="w-3 h-3" />
            Vivago spotlight
          </span>
        </div>
      </div>
    </div>
  );
}
