"use client"

import React, { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "lucide-react";

type Theme = "light" | "dark" | "system";

const THEME_KEY = "vivago-theme";

function applyThemeValue(value: "light" | "dark") {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (value === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

function getSystemPref(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function Preferences({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    // initialize theme from localStorage (default: system)
    try {
      const stored = localStorage.getItem(THEME_KEY) as Theme | null;
      const initial = stored || "system";
      setTheme(initial);

      if (initial === "system") {
        applyThemeValue(getSystemPref());
      } else {
        applyThemeValue(initial as "light" | "dark");
      }
    } catch (e) {
      setTheme("system");
      applyThemeValue(getSystemPref());
    }
  }, []);

  useEffect(() => {
    // apply immediately when user changes
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      // ignore
    }

    if (theme === "system") {
      applyThemeValue(getSystemPref());
    } else {
      applyThemeValue(theme as "light" | "dark");
    }
  }, [theme]);

  useEffect(() => {
    // listen for system changes when in system mode
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      if (theme === "system") {
        applyThemeValue(e.matches ? "dark" : "light");
      }
    };
    try {
      mq.addEventListener("change", handler);
    } catch (e) {
      // Safari fallback
      // @ts-ignore
      mq.addListener && // @ts-ignore
      mq.addListener(handler);
    }
    return () => {
      try {
        mq.removeEventListener("change", handler);
      } catch (e) {
        // Safari fallback
        // @ts-ignore
        mq.removeListener && // @ts-ignore
        mq.removeListener(handler);
      }
    };
  }, [theme]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200/60 dark:border-slate-700/60 p-6 animate-scale-up">
        <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-700/60 pb-3">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Preferences</h3>
          <button 
            onClick={onClose} 
            className="text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white transition-colors"
          >
            Close
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Theme</label>
            <div className="mt-2.5 grid grid-cols-3 gap-3 w-full">
              {/* Light Card */}
              <label 
                className={`flex flex-col items-start p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                  theme === "light" 
                    ? "bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-600 dark:border-indigo-500 shadow-sm shadow-indigo-600/10" 
                    : "bg-white dark:bg-slate-900/30 border-slate-200 dark:border-slate-700 hover:border-slate-350 dark:hover:border-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value="light"
                  checked={theme === "light"}
                  onChange={() => setTheme("light")}
                  className="hidden"
                />
                <Sun className={`w-5 h-5 mb-2.5 ${theme === "light" ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`} />
                <div className="text-xs font-bold text-slate-800 dark:text-white leading-tight">Light</div>
                <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 leading-normal font-semibold">Default light UI</div>
              </label>

              {/* Dark Card */}
              <label 
                className={`flex flex-col items-start p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                  theme === "dark" 
                    ? "bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-600 dark:border-indigo-500 shadow-sm shadow-indigo-600/10" 
                    : "bg-white dark:bg-slate-900/30 border-slate-200 dark:border-slate-700 hover:border-slate-350 dark:hover:border-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value="dark"
                  checked={theme === "dark"}
                  onChange={() => setTheme("dark")}
                  className="hidden"
                />
                <Moon className={`w-5 h-5 mb-2.5 ${theme === "dark" ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`} />
                <div className="text-xs font-bold text-slate-800 dark:text-white leading-tight">Dark</div>
                <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 leading-normal font-semibold">Low-light friendly</div>
              </label>

              {/* System Card */}
              <label 
                className={`flex flex-col items-start p-3.5 rounded-2xl border-2 cursor-pointer transition-all ${
                  theme === "system" 
                    ? "bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-600 dark:border-indigo-500 shadow-sm shadow-indigo-600/10" 
                    : "bg-white dark:bg-slate-900/30 border-slate-200 dark:border-slate-700 hover:border-slate-350 dark:hover:border-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value="system"
                  checked={theme === "system"}
                  onChange={() => setTheme("system")}
                  className="hidden"
                />
                <Monitor className={`w-5 h-5 mb-2.5 ${theme === "system" ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 dark:text-slate-500"}`} />
                <div className="text-xs font-bold text-slate-800 dark:text-white leading-tight">System</div>
                <div className="text-[9px] text-slate-400 dark:text-slate-500 mt-1 leading-normal font-semibold">Follow OS setting</div>
              </label>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-slate-700/60 text-right">
            <button
              onClick={onClose}
              className="px-4.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-extrabold hover:bg-indigo-700 active:scale-95 transition-all shadow-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

