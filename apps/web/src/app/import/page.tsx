"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  FileUp,
  Loader2,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { CONFIG, getMasterKeyHex, getStorage } from "@/lib/sessionStore";
import {
  decryptProtonPassExport,
  importDraftsToVault,
  mapProtonExportToDrafts,
  type ImportProgress,
} from "@/lib/protonPassImport";

export default function ImportPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [pgpFile, setPgpFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [status, setStatus] = useState<"idle" | "decrypting" | "importing" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storage = getStorage();
    const userId = storage.getItem("x-user-id");
    const sessionToken = storage.getItem("session-token");
    const keyHex = getMasterKeyHex();
    if (!userId || !sessionToken || !keyHex) {
      router.push("/login");
      return;
    }
    setReady(true);
  }, [router]);

  const handlePreview = async () => {
    if (!pgpFile || !passphrase.trim()) {
      setMessage("Choose your data.pgp file and enter the export passphrase.");
      setStatus("error");
      return;
    }
    setStatus("decrypting");
    setMessage("");
    try {
      const text = await pgpFile.text();
      const data = await decryptProtonPassExport(text, passphrase);
      const drafts = mapProtonExportToDrafts(data);
      setPreviewCount(drafts.length);
      setStatus("idle");
      setMessage(`Found ${drafts.length} items ready to import.`);
    } catch (err: unknown) {
      setStatus("error");
      setPreviewCount(null);
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(
        msg.includes("Session key") || msg.includes("decrypt")
          ? "Could not decrypt the file. Check that this is your Proton Pass data.pgp and the export passphrase is correct."
          : `Decrypt failed: ${msg}`
      );
    }
  };

  const handleImport = async () => {
    if (!pgpFile || !passphrase.trim()) {
      setMessage("Choose your data.pgp file and enter the export passphrase.");
      setStatus("error");
      return;
    }

    const storage = getStorage();
    const userId = storage.getItem("x-user-id");
    const sessionToken = storage.getItem("session-token");
    const keyHex = getMasterKeyHex();
    if (!userId || !sessionToken || !keyHex) {
      router.push("/login");
      return;
    }

    setStatus("decrypting");
    setMessage("");
    setProgress(null);

    try {
      const text = await pgpFile.text();
      const data = await decryptProtonPassExport(text, passphrase);
      const drafts = mapProtonExportToDrafts(data);

      if (drafts.length === 0) {
        setStatus("error");
        setMessage("No items found in the export (empty vaults or only Recycle Bin).");
        return;
      }

      setStatus("importing");
      const result = await importDraftsToVault(
        drafts,
        keyHex,
        CONFIG.API_URL,
        userId,
        sessionToken,
        setProgress
      );

      setStatus("done");
      const failed = result.errors.length;
      const ok = result.total - failed;
      setMessage(
        failed === 0
          ? `Successfully imported ${ok} items into your vault.`
          : `Imported ${ok} of ${result.total} items. ${failed} failed — see details below.`
      );
      setProgress(result);
    } catch (err: unknown) {
      setStatus("error");
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(`Import failed: ${msg}`);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <div className="max-w-lg mx-auto px-4 py-10">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to vault
        </Link>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-sm">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900 dark:text-white">
              Import from Proton Pass
            </h1>
            <p className="text-[11px] font-semibold text-slate-400">
              Decrypts locally — your master key never leaves this device
            </p>
          </div>
        </div>

        <div className="mt-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-100 dark:border-emerald-900/50">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 leading-relaxed">
              Upload your <code className="font-mono">data.pgp</code> from a Proton Pass export.
              Decryption and re-encryption happen in your browser before anything is sent to the
              server. Re-importing updates existing items (same IDs) with corrected fields.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Proton export file
            </label>
            <label className="flex flex-col items-center justify-center gap-2 w-full py-8 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
              <FileUp className="w-6 h-6 text-slate-400" />
              <span className="text-xs font-bold text-slate-600">
                {pgpFile ? pgpFile.name : "Choose data.pgp"}
              </span>
              <input
                type="file"
                accept=".pgp,.gpg,.asc"
                className="hidden"
                onChange={(e) => {
                  setPgpFile(e.target.files?.[0] ?? null);
                  setPreviewCount(null);
                  setMessage("");
                  setStatus("idle");
                }}
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Export passphrase
            </label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Passphrase you set when exporting from Proton Pass"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              autoComplete="off"
            />
          </div>

          {previewCount !== null && status !== "importing" && status !== "done" && (
            <p className="text-xs font-bold text-indigo-600">{previewCount} items detected</p>
          )}

          {(status === "decrypting" || status === "importing") && (
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              {status === "decrypting" ? "Decrypting export…" : "Importing items…"}
              {progress && (
                <span>
                  {progress.done}/{progress.total}
                  {progress.current ? ` — ${progress.current}` : ""}
                </span>
              )}
            </div>
          )}

          {message && (
            <div
              className={`flex items-start gap-2 p-3 rounded-xl text-xs font-semibold ${
                status === "error"
                  ? "bg-rose-50 text-rose-700 border border-rose-100"
                  : status === "done"
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                    : "bg-slate-50 text-slate-600 border border-slate-100"
              }`}
            >
              {status === "done" ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : status === "error" ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : null}
              <span>{message}</span>
            </div>
          )}

          {progress && progress.errors.length > 0 && (
            <ul className="text-[10px] font-mono text-rose-600 max-h-32 overflow-y-auto space-y-1">
              {progress.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handlePreview}
              disabled={status === "importing" || status === "decrypting"}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Preview count
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={status === "importing" || status === "decrypting"}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm disabled:opacity-50"
            >
              Import all
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
