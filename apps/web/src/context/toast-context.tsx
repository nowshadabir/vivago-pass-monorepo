"use client";

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { Check, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
  duration?: number;
}

export interface ConfirmOptions {
  title?: string;
  confirmText?: string;
  cancelText?: string;
  type?: "danger" | "warning" | "info";
}

interface ToastContextType {
  toast: {
    success: (msg: string, duration?: number) => void;
    error: (msg: string, duration?: number) => void;
    warning: (msg: string, duration?: number) => void;
    info: (msg: string, duration?: number) => void;
  };
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{
    message: string;
    options: ConfirmOptions;
    resolve: (val: boolean) => void;
  } | null>(null);

  const addToast = useCallback((type: Toast["type"], message: string, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, duration }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const toastMethods = useMemo(() => ({
    success: (msg: string, dur?: number) => addToast("success", msg, dur),
    error: (msg: string, dur?: number) => addToast("error", msg, dur),
    warning: (msg: string, dur?: number) => addToast("warning", msg, dur),
    info: (msg: string, dur?: number) => addToast("info", msg, dur),
  }), [addToast]);

  const confirmMethod = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      setConfirmDialog({
        message,
        options: {
          title: options.title || "Confirm Action",
          confirmText: options.confirmText || "Confirm",
          cancelText: options.cancelText || "Cancel",
          type: options.type || "info",
        },
        resolve,
      });
    });
  }, []);

  const handleConfirmClose = (result: boolean) => {
    if (confirmDialog) {
      confirmDialog.resolve(result);
      setConfirmDialog(null);
    }
  };

  return (
    <ToastContext.Provider value={{ toast: toastMethods, confirm: confirmMethod }}>
      {children}

      {/* --- Global Stacking Toast Container --- */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none p-4 md:p-0">
        {toasts.map((t) => {
          let bgClass = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 shadow-2xl";
          let icon = <Info className="w-4 h-4 text-indigo-500" />;
          
          if (t.type === "success") {
            icon = <Check className="w-4 h-4 text-emerald-500" />;
            bgClass = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 shadow-2xl border-l-4 border-l-emerald-500";
          } else if (t.type === "error") {
            icon = <AlertCircle className="w-4.5 h-4.5 text-red-500" />;
            bgClass = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 shadow-2xl border-l-4 border-l-red-500";
          } else if (t.type === "warning") {
            icon = <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />;
            bgClass = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 shadow-2xl border-l-4 border-l-amber-500";
          } else {
            icon = <Info className="w-4.5 h-4.5 text-indigo-500" />;
            bgClass = "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100 shadow-2xl border-l-4 border-l-indigo-500";
          }

          return (
            <div
              key={t.id}
              className={`flex items-start gap-3.5 p-4 rounded-2xl border pointer-events-auto animate-slide-in-right transform transition-all duration-300 ${bgClass}`}
            >
              <div className="flex-shrink-0 mt-0.5">{icon}</div>
              <div className="flex-1 text-xs font-bold leading-normal">{t.message}</div>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="flex-shrink-0 text-slate-400 hover:text-slate-650 dark:text-slate-500 dark:hover:text-slate-300 p-0.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* --- Confirmation Dialog Modal --- */}
      {confirmDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl border border-slate-200/50 dark:border-slate-800/50 shadow-2xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                {confirmDialog.options.title}
              </h3>
              <p className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold mt-1.5 leading-normal">
                {confirmDialog.message}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => handleConfirmClose(false)}
                className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-4 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-all active:scale-[0.98]"
              >
                {confirmDialog.options.cancelText}
              </button>
              <button
                onClick={() => handleConfirmClose(true)}
                className={`font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-sm transition-all active:scale-[0.98] text-white ${
                  confirmDialog.options.type === "danger"
                    ? "bg-rose-600 hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-700"
                    : confirmDialog.options.type === "warning"
                    ? "bg-amber-500 hover:bg-amber-600 dark:bg-amber-500 dark:hover:bg-amber-600"
                    : "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                }`}
              >
                {confirmDialog.options.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
