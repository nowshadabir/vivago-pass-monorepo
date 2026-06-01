"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  fetchAttachmentsList, 
  downloadAttachmentFile, 
  deleteAttachmentFile, 
  uploadAttachmentFile,
  Attachment 
} from "../lib/attachmentService";
import { getMasterKeyHex, CONFIG, getStorage } from "../lib/sessionStore";
import { decryptData } from "@vivago-pass/ts-crypto";
import { 
  FolderOpen, Search, Trash2, Download, Plus, File, Image, 
  FileText, Music, Video, Loader2, ShieldAlert, Sparkles, Check, 
  HelpCircle, Eye, RefreshCw, X, Folder, FolderPlus, LayoutGrid, List,
  ChevronRight, MoreVertical, Move, Upload, Edit, CornerUpLeft, Paperclip
} from "lucide-react";
import { useToast } from "../context/toast-context";

interface SecureFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export default function DocumentsView({ onClose }: { onClose?: () => void }) {
  const { toast, confirm } = useToast();
  const [documents, setDocuments] = useState<Attachment[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [vaultItemNames, setVaultItemNames] = useState<Record<string, string>>({});
  const [uploadQueue, setUploadQueue] = useState<{
    name: string;
    size: number;
    status: "waiting" | "processing" | "uploading" | "completed" | "failed";
    progressText: string;
  }[]>([]);

  // Folder & Grid/List States
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeFolderMenuId, setActiveFolderMenuId] = useState<string | null>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [movingItemId, setMovingItemId] = useState<string | null>(null);

  // File Preview States
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: string } | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);

  // Persistent Folders State
  const [folders, setFolders] = useState<SecureFolder[]>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("secure_folders");
      if (stored) return JSON.parse(stored);
      
      const defaultFolders: SecureFolder[] = [
        { id: "fld_tax", name: "Tax Documents", parentId: null, createdAt: new Date().toISOString() },
        { id: "fld_id", name: "Personal Identifications", parentId: null, createdAt: new Date().toISOString() },
        { id: "fld_finance", name: "Financial Statements", parentId: null, createdAt: new Date().toISOString() }
      ];
      window.localStorage.setItem("secure_folders", JSON.stringify(defaultFolders));
      return defaultFolders;
    }
    return [];
  });

  // Persistent Document-Folder Mappings
  const [documentFolders, setDocumentFolders] = useState<Record<string, string | null>>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("secure_doc_folders");
      return stored ? JSON.parse(stored) : {};
    }
    return {};
  });

  // Save changes to LocalStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("secure_folders", JSON.stringify(folders));
    }
  }, [folders]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("secure_doc_folders", JSON.stringify(documentFolders));
    }
  }, [documentFolders]);

  // Click outside listener to close menus
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setActiveMenuId(null);
        setActiveFolderMenuId(null);
        setMovingItemId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Load master key and documents
  useEffect(() => {
    async function init() {
      const keyHex = getMasterKeyHex();
      if (!keyHex) {
        setErrorMsg("Master encryption key not found in memory. Please log in again.");
        setIsLoading(false);
        return;
      }

      try {
        const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
        const key = await window.crypto.subtle.importKey(
          "raw",
          keyBytes.buffer,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"]
        );
        setMasterKey(key);

        const list = await fetchAttachmentsList(key);
        setDocuments(list);

        // Load vault items & shared items to map attachment -> vault item names
        const userId = getStorage().getItem("x-user-id");
        const sessionToken = getStorage().getItem("session-token");
        if (userId && sessionToken) {
          try {
            const vaultRes = await fetch(`${CONFIG.API_URL}/api/vault`, {
              headers: {
                "x-user-id": userId,
                "session-token": sessionToken
              }
            });
            if (vaultRes.ok) {
              const vaultData = await vaultRes.json();
              const nameMap: Record<string, string> = {};
              
              if (vaultData.items) {
                await Promise.all(
                  vaultData.items.map(async (rawItem: any) => {
                    try {
                      const decryptedJson = await decryptData(rawItem.ciphertext, rawItem.iv, rawItem.authTag, key);
                      const payload = JSON.parse(decryptedJson);
                      nameMap[rawItem.id] = rawItem.name || payload.name || "Untitled Item";
                    } catch (e) {
                      nameMap[rawItem.id] = rawItem.name || "Encrypted Item";
                    }
                  })
                );
              }
              
              const shareHeaders = {
                "x-user-id": userId,
                "session-token": sessionToken
              };
              const [sentRes, receivedRes] = await Promise.all([
                fetch(`${CONFIG.API_URL}/api/shares/sent`, { headers: shareHeaders }),
                fetch(`${CONFIG.API_URL}/api/shares/received`, { headers: shareHeaders })
              ]);
              const addShareNames = (items: { id?: string; name?: string }[] | undefined) => {
                items?.forEach((share) => {
                  if (share.id) nameMap[share.id] = share.name || "Shared Item";
                });
              };
              if (sentRes.ok) {
                const sentData = await sentRes.json();
                addShareNames(sentData.items);
              }
              if (receivedRes.ok) {
                const receivedData = await receivedRes.json();
                addShareNames(receivedData.items);
              }
              
              setVaultItemNames(nameMap);
            }
          } catch (vaultErr) {
            console.error("Failed to load vault items in documents view:", vaultErr);
          }
        }
      } catch (err: any) {
        console.error("Init documents view failed:", err);
        setErrorMsg("Failed to initialize cryptographic keys or load documents list: " + (err.message || err));
      } finally {
        setIsLoading(false);
      }
    }
    init();
  }, []);

  // Cleanup object URL on unmount/close
  useEffect(() => {
    return () => {
      if (previewFile) {
        URL.revokeObjectURL(previewFile.url);
      }
    };
  }, [previewFile]);

  const handleRefresh = async () => {
    if (!masterKey) return;
    setIsLoading(true);
    setErrorMsg("");
    try {
      const list = await fetchAttachmentsList(masterKey);
      setDocuments(list);
    } catch (err) {
      setErrorMsg("Failed to refresh documents list.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (!filesList || filesList.length === 0 || !masterKey) return;

    const files = Array.from(filesList);
    setErrorMsg("");
    setSuccessMsg("");

    // Strict Validations Check on ALL files first
    for (const file of files) {
      const nameLower = file.name.toLowerCase();
      // Block zip archives using both exact mime-types and common extension patterns
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

      // Block all video types using wildcard mime and common file extensions
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
        setErrorMsg(`Upload rejected: "${file.name}" is a ZIP/compressed archive, which is strictly prohibited.`);
        e.target.value = "";
        return;
      }
      if (isVideo) {
        setErrorMsg(`Upload rejected: "${file.name}" is a video file, which is strictly prohibited.`);
        e.target.value = "";
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setErrorMsg(`Upload rejected: "${file.name}" exceeds the maximum allowed size of 10MB (${formatSize(file.size)}).`);
        e.target.value = "";
        return;
      }
    }

    // Initialize the upload queue state
    const initialQueue = files.map(file => ({
      name: file.name,
      size: file.size,
      status: "waiting" as const,
      progressText: "Queued in secure pipe"
    }));

    setUploadQueue(initialQueue);
    setIsUploading(true);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const progressPrefix = files.length > 1 ? `[${i + 1}/${files.length}] ` : "";
        
        // 1. Mark current file as processing
        setUploadQueue(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: "processing", progressText: "Preparing file structure..." } : item
        ));

        let processingMsg = "Encrypting & compressing file...";
        if (file.name.toLowerCase().endsWith(".heic")) {
          processingMsg = "Converting HEIC image to JPEG...";
        } else if (file.type.startsWith("image/")) {
          processingMsg = "Optimizing & compressing image...";
        }
        
        setUploadProgress(`${progressPrefix}${processingMsg}`);
        setUploadQueue(prev => prev.map((item, idx) => 
          idx === i ? { ...item, progressText: processingMsg } : item
        ));

        // Add small artificial delay so the user can easily observe the sequential steps
        await new Promise(resolve => setTimeout(resolve, 600));

        // 2. Mark current file as uploading
        setUploadQueue(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: "uploading", progressText: "Uploading encrypted blocks securely..." } : item
        ));
        setUploadProgress(`${progressPrefix}Uploading secure payload...`);

        const uploadedDoc = await uploadAttachmentFile(file, null, masterKey);
        
        // Associate new file with current folder
        setDocumentFolders(prev => ({
          ...prev,
          [uploadedDoc.id]: currentFolderId
        }));

        setDocuments(prev => [uploadedDoc, ...prev]);

        // 3. Mark current file as completed
        setUploadQueue(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: "completed", progressText: "Saved encrypted vault copy" } : item
        ));

        // Short pause to show checkmark/completed status before jumping to next file
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setSuccessMsg(files.length === 1 
        ? `"${files[0].name}" successfully encrypted and uploaded.` 
        : `Successfully processed and uploaded all ${files.length} files one-by-one.`);
    } catch (err: any) {
      console.error("Batch upload error:", err);
      setErrorMsg(err.message || "An error occurred during file encryption and upload.");
      setUploadQueue(prev => prev.map(item => 
        item.status === "processing" || item.status === "uploading" || item.status === "waiting"
          ? { ...item, status: "failed", progressText: "Upload aborted/failed" }
          : item
      ));
    } finally {
      // Keep the panel visible for 3.5 seconds so the user can see completion state, then clean up
      setTimeout(() => {
        setIsUploading(false);
        setUploadQueue([]);
      }, 3500);
      e.target.value = "";
    }
  };

  const handleDownload = async (doc: Attachment) => {
    if (!masterKey) return;
    setErrorMsg("");
    try {
      const { blob, metadata } = await downloadAttachmentFile(doc, masterKey);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = metadata.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      setErrorMsg("Decryption or download failed. Verify your Master Key is valid.");
    }
  };

  // Preview Handling
  const handlePreview = async (doc: Attachment) => {
    if (!masterKey) return;
    setErrorMsg("");
    setIsPreviewLoading(true);
    try {
      const { blob, metadata } = await downloadAttachmentFile(doc, masterKey);
      const url = URL.createObjectURL(blob);
      setPreviewFile({
        url,
        name: metadata.name,
        type: metadata.type || doc.decryptedMetadata?.type || "application/octet-stream"
      });
    } catch (err) {
      console.error("Preview error:", err);
      setErrorMsg("Decryption failed. Unable to preview file.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    if (previewFile) {
      URL.revokeObjectURL(previewFile.url);
      setPreviewFile(null);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm("Are you sure you want to permanently delete this document? This action cannot be undone.", {
      title: "Delete Document",
      confirmText: "Delete",
      cancelText: "Cancel",
      type: "danger"
    });
    if (!confirmed) return;
    setErrorMsg("");
    try {
      await deleteAttachmentFile(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
      
      // Clean up mapping
      setDocumentFolders(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });

      toast.success("Document deleted successfully.");
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Failed to delete document from server.");
    }
  };

  // Folder Handling
  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const newFolder: SecureFolder = {
      id: "fld_" + Math.random().toString(36).substr(2, 9),
      name: newFolderName.trim(),
      parentId: currentFolderId,
      createdAt: new Date().toISOString()
    };
    setFolders(prev => [...prev, newFolder]);
    setNewFolderName("");
    setIsCreateFolderOpen(false);
    setSuccessMsg(`Folder "${newFolder.name}" created successfully.`);
  };

  const handleDeleteFolder = async (folderId: string) => {
    const confirmed = await confirm("Are you sure you want to delete this folder? Files inside will be moved to root.", {
      title: "Delete Folder",
      confirmText: "Delete Folder",
      cancelText: "Cancel",
      type: "danger"
    });
    if (!confirmed) return;
    
    setFolders(prev => prev.filter(f => f.id !== folderId));
    
    // Move nested folders to root
    setFolders(prev => prev.map(f => f.parentId === folderId ? { ...f, parentId: null } : f));
    
    // Move nested files to root
    setDocumentFolders(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(key => {
        if (next[key] === folderId) {
          next[key] = null;
        }
      });
      return next;
    });

    if (currentFolderId === folderId) {
      setCurrentFolderId(null);
    }
    setActiveFolderMenuId(null);
    toast.success("Folder deleted successfully.");
  };

  const handleMoveFile = (docId: string, folderId: string | null) => {
    setDocumentFolders(prev => ({
      ...prev,
      [docId]: folderId
    }));
    setActiveMenuId(null);
    setMovingItemId(null);
    const destName = folderId ? folders.find(f => f.id === folderId)?.name : "Root Directory";
    setSuccessMsg(`Document successfully moved to "${destName}".`);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileIcon = (mimeType: string, className = "w-6 h-6") => {
    if (!mimeType) return <File className={`${className} text-slate-400`} />;
    if (mimeType.startsWith("image/")) return <Image className={`${className} text-sky-500`} />;
    if (mimeType.startsWith("video/")) return <Video className={`${className} text-indigo-500`} />;
    if (mimeType.startsWith("audio/")) return <Music className={`${className} text-pink-500`} />;
    if (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("text")) {
      return <FileText className={`${className} text-emerald-500`} />;
    }
    return <File className={`${className} text-slate-400`} />;
  };

  // Breadcrumbs Navigation builder
  const getBreadcrumbs = () => {
    const crumbs: { id: string | null; name: string }[] = [{ id: null, name: "All Documents" }];
    let currentId = currentFolderId;
    const path: { id: string | null; name: string }[] = [];
    while (currentId) {
      const folder = folders.find(f => f.id === currentId);
      if (folder) {
        path.unshift({ id: folder.id, name: folder.name });
        currentId = folder.parentId;
      } else {
        break;
      }
    }
    return [...crumbs, ...path];
  };

  // Filtering: If search is active, show global query matches, otherwise folder-restricted items
  const filteredFolders = folders.filter(f => {
    if (searchTerm) {
      return f.name.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return f.parentId === currentFolderId;
  });

  const filteredDocuments = documents.filter(doc => {
    const filename = doc.decryptedMetadata?.name || "Encrypted File";
    if (searchTerm) {
      return filename.toLowerCase().includes(searchTerm.toLowerCase());
    }
    const mappedFolder = documentFolders[doc.id] || null;
    return mappedFolder === currentFolderId;
  });

  return (
    <div className="flex-1 bg-slate-50 dark:bg-slate-950 w-full max-w-full h-full lg:h-screen overflow-hidden font-sans antialiased text-slate-800 dark:text-slate-100 flex flex-col relative">
      
      {/* 1. Header with Title & Action Controls */}
      <header className="bg-white border-b border-slate-200/60 px-6 py-4.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-sm font-extrabold text-slate-900 leading-snug">Secure Documents</h1>
            <p className="text-[10px] text-slate-400 font-semibold leading-none mt-0.5">End-to-end encrypted files and files organized inside folders</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleRefresh}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 bg-white transition-all shadow-sm"
            title="Refresh List"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          {onClose && (
            <button 
              onClick={onClose}
              className="text-xs font-bold text-slate-600 hover:text-slate-800 border border-slate-200 hover:bg-slate-50 bg-white px-3 md:px-4 py-2 rounded-xl shadow-sm transition-all"
            >
              ← Back to Vault
            </button>
          )}
        </div>
      </header>

      {/* 2. Top-Middle AI Message-Box Style Search & Upload Action Bar */}
      <div className="w-full shrink-0 px-6 py-6 bg-slate-50/50 flex flex-col items-center border-b border-slate-200/40">
        <div className="max-w-2xl w-full bg-white border border-slate-200 shadow-md shadow-slate-100/50 rounded-2xl p-1.5 focus-within:border-indigo-500 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all flex items-center">
          <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" />
          <input 
            type="text" 
            placeholder="Search secure files, folders, or document formats..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent pl-3 pr-4 py-2.5 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none"
          />
          <div className="flex items-center gap-1 pr-1.5 border-l border-slate-100 pl-2">
            <button 
              onClick={() => setIsCreateFolderOpen(true)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
              title="Create New Folder"
            >
              <FolderPlus className="w-4.5 h-4.5" />
            </button>
            <label className="p-2 rounded-xl text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 cursor-pointer transition-colors" title="Encrypt & Upload File">
              <input type="file" multiple onChange={handleFileUpload} className="hidden" disabled={isUploading || !masterKey} />
              <Upload className="w-4.5 h-4.5" />
            </label>
          </div>
        </div>

        {/* Upload progress message */}
        {isUploading && (
          <div className="w-full max-w-2xl mt-3 flex items-center justify-between bg-indigo-50/50 border border-indigo-100/50 px-4 py-2 rounded-xl text-[11px] text-indigo-700 font-bold">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{uploadProgress}</span>
            </div>
            <span className="uppercase tracking-wider text-[9px] bg-indigo-100 text-indigo-800 px-1.5 py-0.5 rounded-md">ZKA Encryption</span>
          </div>
        )}
      </div>

      {/* 3. Navigation Breadcrumbs & View-Mode Controllers */}
      <div className="px-6 py-4 bg-white border-b border-slate-150 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 overflow-x-auto pr-4 scrollbar-none">
          {getBreadcrumbs().map((crumb, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300" />}
              <button 
                onClick={() => { setCurrentFolderId(crumb.id); setSearchTerm(""); }}
                className={`transition-colors whitespace-nowrap px-1 py-0.5 rounded hover:bg-slate-50 ${
                  idx === getBreadcrumbs().length - 1 ? "text-slate-900 font-extrabold" : "hover:text-slate-700"
                }`}
              >
                {crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* View Switcher Controls */}
        <div className="flex items-center gap-1 bg-slate-50 p-1 border border-slate-200/60 rounded-xl shrink-0">
          <button 
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === "grid" ? "bg-white text-indigo-650 shadow-sm border border-slate-200/30" : "text-slate-400 hover:text-slate-600"
            }`}
            title="Grid View"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded-lg transition-all ${
              viewMode === "list" ? "bg-white text-indigo-650 shadow-sm border border-slate-200/30" : "text-slate-400 hover:text-slate-600"
            }`}
            title="List View"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 4. Main Documents Viewer Area */}
      <main className="vivago-scrollbar flex-1 p-6 md:p-8 overflow-y-auto space-y-6">
        
        {/* Status/Notification Banners */}
        {errorMsg && (
          <div className="p-4 bg-red-50 text-red-800 border border-red-150 rounded-2xl text-xs font-semibold flex items-center gap-2 max-w-4xl mx-auto shadow-sm">
            <ShieldAlert className="w-4.5 h-4.5 text-red-650" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-4 bg-emerald-50 text-emerald-800 border border-emerald-150 rounded-2xl text-xs font-semibold flex items-center justify-between gap-2 max-w-4xl mx-auto shadow-sm">
            <div className="flex items-center gap-2">
              <Check className="w-4.5 h-4.5 text-emerald-655" />
              <span>{successMsg}</span>
            </div>
            <button onClick={() => setSuccessMsg("")} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Global Loading Spinner */}
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-9 h-9 text-indigo-650 animate-spin" />
              <span className="text-xs font-semibold text-slate-400">Loading secure filesystem...</span>
            </div>
          </div>
        ) : filteredFolders.length === 0 && filteredDocuments.length === 0 ? (
          /* Empty Directory View */
          <div className="max-w-md mx-auto bg-white border border-slate-200/60 rounded-3xl p-10 flex flex-col items-center justify-center text-center space-y-4 shadow-sm py-16">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400 border border-slate-100 shadow-inner">
              <FolderOpen className="w-7 h-7" />
            </div>
            <div>
              <h4 className="text-sm font-extrabold text-slate-700">Empty Directory</h4>
              <p className="text-xs text-slate-400 font-medium mt-1 leading-normal max-w-[280px] mx-auto">
                No folders or secure items located here. Use the action bar above to add files.
              </p>
            </div>
          </div>
        ) : (
          /* Content Layout: Grid View vs. List View */
          <div className="max-w-7xl mx-auto space-y-8" ref={menuRef}>
            
            {/* --- FOLDERS SECTION --- */}
            {filteredFolders.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Folders</h3>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {filteredFolders.map((folder) => {
                    const childFiles = documents.filter(d => documentFolders[d.id] === folder.id);
                    const childFoldersCount = folders.filter(f => f.parentId === folder.id).length;
                    const itemsText = `${childFiles.length + childFoldersCount} item${(childFiles.length + childFoldersCount) !== 1 ? 's' : ''}`;

                    return (
                      <div 
                        key={folder.id}
                        onDoubleClick={() => { setCurrentFolderId(folder.id); setSearchTerm(""); }}
                        className="group bg-white border border-slate-200/70 rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.01)] hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/[0.02] hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[105px] relative"
                      >
                        <div className="flex items-start justify-between">
                          <div 
                            onClick={() => { setCurrentFolderId(folder.id); setSearchTerm(""); }}
                            className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-500 shadow-sm"
                          >
                            <Folder className="w-5 h-5 fill-amber-500/20" />
                          </div>
                          
                          {/* Folder Options Menu Button */}
                          <div className="relative">
                            <button 
                              onClick={() => {
                                setActiveFolderMenuId(activeFolderMenuId === folder.id ? null : folder.id);
                                setActiveMenuId(null);
                              }}
                              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>

                            {/* Dropdown Options */}
                            {activeFolderMenuId === folder.id && (
                              <div className="absolute right-0 mt-1 w-32 bg-white border border-slate-200/80 rounded-xl shadow-lg shadow-slate-100/50 py-1 z-30 font-semibold text-[11px] text-slate-700">
                                <button 
                                  onClick={() => handleDeleteFolder(folder.id)}
                                  className="w-full px-3 py-2 text-left hover:bg-rose-50 text-red-655 flex items-center gap-2"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Delete Folder
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-3">
                          <h4 
                            onClick={() => { setCurrentFolderId(folder.id); setSearchTerm(""); }}
                            className="text-xs font-bold text-slate-800 truncate leading-tight group-hover:text-indigo-650"
                            title={folder.name}
                          >
                            {folder.name}
                          </h4>
                          <span className="text-[9px] text-slate-400 font-bold block mt-1">
                            {itemsText}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* --- FILES SECTION --- */}
            {filteredDocuments.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Files</h3>

                {viewMode === "grid" ? (
                  /* Grid Layout */
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {filteredDocuments.map((doc) => {
                      const filename = doc.decryptedMetadata?.name || "Encrypted File";
                      const mime = doc.decryptedMetadata?.type || "";

                      return (
                        <div 
                          key={doc.id}
                          className="group bg-white border border-slate-200/70 rounded-2xl p-4 shadow-[0_1px_3px_rgba(0,0,0,0.01)] hover:border-indigo-200 hover:shadow-md hover:shadow-indigo-500/[0.02] hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between min-h-[140px] relative"
                        >
                          <div className="flex items-start justify-between">
                            <div 
                              onClick={() => handlePreview(doc)}
                              className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shadow-inner cursor-pointer hover:bg-slate-100 transition-colors"
                            >
                              {getFileIcon(mime, "w-5.5 h-5.5")}
                            </div>
                            
                            {/* File Options Dropdown */}
                            <div className="relative">
                              <button 
                                onClick={() => {
                                  setActiveMenuId(activeMenuId === doc.id ? null : doc.id);
                                  setActiveFolderMenuId(null);
                                  setMovingItemId(null);
                                }}
                                className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {activeMenuId === doc.id && (
                                <div className="absolute right-0 mt-1 w-40 bg-white border border-slate-200/80 rounded-xl shadow-lg shadow-slate-100/50 py-1 z-30 font-semibold text-[11px] text-slate-700">
                                  <button 
                                    onClick={() => handlePreview(doc)}
                                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-slate-400" /> Preview File
                                  </button>
                                  <button 
                                    onClick={() => handleDownload(doc)}
                                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                                  >
                                    <Download className="w-3.5 h-3.5 text-slate-400" /> Download
                                  </button>
                                  <button 
                                    onClick={() => setMovingItemId(doc.id)}
                                    className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-indigo-650"
                                  >
                                    <Move className="w-3.5 h-3.5" /> Move to Folder
                                  </button>
                                  <div className="border-t border-slate-100 my-1"></div>
                                  <button 
                                    onClick={() => handleDelete(doc.id)}
                                    className="w-full px-3 py-2 text-left hover:bg-rose-50 text-red-655 flex items-center gap-2"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> Delete File
                                  </button>
                                </div>
                              )}

                              {/* Nested: Move to Folder dialog popover */}
                              {movingItemId === doc.id && (
                                <div className="absolute right-0 mt-1 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-40 font-semibold text-[11px] text-slate-700">
                                  <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider">
                                    <span>Select Destination</span>
                                    <button onClick={() => setMovingItemId(null)} className="hover:text-slate-600"><X className="w-3 h-3" /></button>
                                  </div>
                                  <div className="max-h-40 overflow-y-auto">
                                    {currentFolderId !== null && (
                                      <button 
                                        onClick={() => handleMoveFile(doc.id, null)}
                                        className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-500"
                                      >
                                        <CornerUpLeft className="w-3.5 h-3.5" /> Move to Root (All)
                                      </button>
                                    )}
                                    {folders.filter(f => f.id !== currentFolderId).map(f => (
                                      <button 
                                        key={f.id}
                                        onClick={() => handleMoveFile(doc.id, f.id)}
                                        className="w-full px-3 py-2 text-left hover:bg-slate-50 truncate flex items-center gap-2"
                                      >
                                        <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" /> {f.name}
                                      </button>
                                    ))}
                                    {folders.filter(f => f.id !== currentFolderId).length === 0 && (
                                      <span className="block px-3 py-2 text-slate-400 italic">No other folders</span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-4">
                            <span className="text-[9px] font-bold bg-slate-50 border border-slate-200/60 text-slate-500 px-2 py-0.5 rounded-md uppercase tracking-wider font-mono">
                              {mime.split("/")[1] || "BINARY"}
                            </span>
                            <h4 
                              onClick={() => handlePreview(doc)}
                              className="text-xs font-bold text-slate-800 truncate mt-2 leading-tight group-hover:text-indigo-650 cursor-pointer" 
                              title={filename}
                            >
                              {filename}
                            </h4>
                            <div className="flex items-center justify-between text-[9px] text-slate-400 font-semibold mt-1">
                              <span>{formatSize(doc.fileSize)}</span>
                              <span>{new Date(doc.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            </div>
                            {doc.vaultItemId && vaultItemNames[doc.vaultItemId] && (
                              <div className="mt-2 pt-1.5 border-t border-slate-100 flex items-center gap-1 text-[9px] font-bold text-slate-500">
                                <Paperclip className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                                <span className="truncate">Linked: <span className="text-indigo-600">{vaultItemNames[doc.vaultItemId]}</span></span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* List Layout (Table) */
                  <div className="bg-white border border-slate-200/65 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.01)] overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50/70 border-b border-slate-200/60 text-[9px] font-extrabold text-slate-400 uppercase tracking-widest">
                            <th className="py-3 px-6">Document Name</th>
                            <th className="py-3 px-6 text-center">Size</th>
                            <th className="py-3 px-6 text-center">Format</th>
                            <th className="py-3 px-6 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredDocuments.map((doc) => {
                            const filename = doc.decryptedMetadata?.name || "Encrypted File";
                            const mime = doc.decryptedMetadata?.type || "";

                            return (
                              <tr key={doc.id} className="hover:bg-slate-50/40 transition-colors group">
                                <td className="py-3.5 px-6">
                                  <div className="flex items-center gap-3">
                                    <div 
                                      onClick={() => handlePreview(doc)}
                                      className="w-8.5 h-8.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 cursor-pointer hover:bg-slate-100 transition-colors"
                                    >
                                      {getFileIcon(mime, "w-5 h-5")}
                                    </div>
                                    <div className="min-w-0">
                                      <span 
                                        onClick={() => handlePreview(doc)}
                                        className="text-xs font-bold text-slate-900 truncate max-w-[280px] block cursor-pointer hover:text-indigo-650" 
                                        title={filename}
                                      >
                                        {filename}
                                      </span>
                                      <span className="text-[9px] text-slate-400 font-semibold block mt-0.5">
                                        Uploaded {new Date(doc.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                      </span>
                                      {doc.vaultItemId && vaultItemNames[doc.vaultItemId] && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-500 mt-1">
                                          <Paperclip className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                                          <span>Linked: <span className="text-indigo-600">{vaultItemNames[doc.vaultItemId]}</span></span>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                <td className="py-3.5 px-6 text-center text-xs font-semibold text-slate-600">
                                  {formatSize(doc.fileSize)}
                                </td>

                                <td className="py-3.5 px-6 text-center">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[9px] font-bold bg-slate-50 text-slate-500 border border-slate-200/50 uppercase tracking-wider font-mono">
                                    {mime.split("/")[1] || "BINARY"}
                                  </span>
                                </td>

                                <td className="py-3.5 px-6 text-right">
                                  <div className="flex items-center justify-end gap-2 relative">
                                    <button
                                      onClick={() => handlePreview(doc)}
                                      className="inline-flex items-center gap-1.5 text-[10px] font-extrabold text-slate-600 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200/60 px-2.5 py-1 rounded-xl transition-all"
                                      title="Preview"
                                    >
                                      <Eye className="w-3 h-3" /> Preview
                                    </button>

                                    <button 
                                      onClick={() => {
                                        setActiveMenuId(activeMenuId === doc.id ? null : doc.id);
                                        setMovingItemId(null);
                                      }}
                                      className="p-1.5 rounded-xl border border-slate-100 hover:bg-slate-50 text-slate-400 hover:text-slate-600 transition-all"
                                    >
                                      <MoreVertical className="w-3.5 h-3.5" />
                                    </button>

                                    {activeMenuId === doc.id && (
                                      <div className="absolute right-0 mt-8 w-40 bg-white border border-slate-200/80 rounded-xl shadow-lg py-1 z-30 font-semibold text-[11px] text-slate-700 text-left">
                                        <button 
                                          onClick={() => handleDownload(doc)}
                                          className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2"
                                        >
                                          <Download className="w-3.5 h-3.5 text-slate-400" /> Download
                                        </button>
                                        <button 
                                          onClick={() => setMovingItemId(doc.id)}
                                          className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-indigo-650"
                                        >
                                          <Move className="w-3.5 h-3.5" /> Move to Folder
                                        </button>
                                        <div className="border-t border-slate-100 my-1"></div>
                                        <button 
                                          onClick={() => handleDelete(doc.id)}
                                          className="w-full px-3 py-2 text-left hover:bg-rose-50 text-red-655 flex items-center gap-2"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" /> Delete File
                                        </button>
                                      </div>
                                    )}

                                    {/* Moving item list inside List View */}
                                    {movingItemId === doc.id && (
                                      <div className="absolute right-0 mt-8 w-52 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-40 font-semibold text-[11px] text-slate-700 text-left">
                                        <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between text-[10px] text-slate-400 uppercase tracking-wider">
                                          <span>Move file</span>
                                          <button onClick={() => setMovingItemId(null)} className="hover:text-slate-600"><X className="w-3 h-3" /></button>
                                        </div>
                                        <div className="max-h-40 overflow-y-auto">
                                          {currentFolderId !== null && (
                                            <button 
                                              onClick={() => handleMoveFile(doc.id, null)}
                                              className="w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center gap-2 text-slate-500"
                                            >
                                              <CornerUpLeft className="w-3.5 h-3.5" /> Move to Root (All)
                                            </button>
                                          )}
                                          {folders.filter(f => f.id !== currentFolderId).map(f => (
                                            <button 
                                              key={f.id}
                                              onClick={() => handleMoveFile(doc.id, f.id)}
                                              className="w-full px-3 py-2 text-left hover:bg-slate-50 truncate flex items-center gap-2"
                                            >
                                              <Folder className="w-3.5 h-3.5 text-amber-500" /> {f.name}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* --- CREATE FOLDER MODAL DIALOG --- */}
      {isCreateFolderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white w-full max-w-sm rounded-3xl border border-slate-200/50 shadow-2xl p-6 space-y-4">
            <div>
              <h3 className="text-sm font-extrabold text-slate-900">Create New Folder</h3>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Define a folder category to group secure documents together</p>
            </div>
            
            <input 
              type="text"
              placeholder="e.g. Tax Receipts 2026"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 bg-slate-50/50 focus:bg-white transition-all"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button 
                onClick={() => { setIsCreateFolderOpen(false); setNewFolderName(""); }}
                className="text-xs font-bold text-slate-500 hover:text-slate-900 px-3.5 py-2 rounded-xl hover:bg-slate-100 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={handleCreateFolder}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs px-4 py-2 rounded-xl shadow-sm transition-all active:scale-[0.98]"
              >
                Create Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- DECRYPTING PREVIEW LOADER OVERLAY --- */}
      {isPreviewLoading && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-900/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-slate-250 p-6 flex flex-col items-center gap-4 text-center max-w-xs shadow-2xl">
            <Loader2 className="w-8 h-8 text-indigo-650 animate-spin" />
            <div>
              <h4 className="text-xs font-bold text-slate-900">Decrypting File...</h4>
              <p className="text-[10px] text-slate-400 font-semibold mt-1 leading-normal">
                Verifying local credentials and decrypting file blocks inside your browser sandbox.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* --- PREVIEW VIEW MODAL DIALOG --- */}
      {previewFile && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-md p-4 md:p-8 animate-fade-in justify-between">
          {/* Top Panel bar */}
          <div className="flex items-center justify-between w-full max-w-7xl mx-auto py-2 border-b border-slate-200 dark:border-white/10 shrink-0 text-slate-800 dark:text-white">
            <div className="flex items-center gap-3 min-w-0 pr-4">
              <div className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/10 flex items-center justify-center shrink-0">
                {getFileIcon(previewFile.type, "w-4.5 h-4.5 text-slate-650 dark:text-white")}
              </div>
              <h3 className="text-xs md:text-sm font-extrabold truncate text-slate-900 dark:text-white" title={previewFile.name}>{previewFile.name}</h3>
            </div>
            <div className="flex items-center gap-2">
              <a 
                href={previewFile.url}
                download={previewFile.name}
                className="text-xs font-extrabold text-white bg-indigo-600 hover:bg-indigo-700 px-3.5 py-1.5 rounded-xl shadow-md transition-all flex items-center gap-1.5"
                title="Download Decrypted File"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
              <button 
                onClick={handleClosePreview}
                className="p-1.5 rounded-xl bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20 text-slate-700 dark:text-white transition-all"
                title="Close Preview"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>

          {/* Main Preview Container Body */}
          <div className="flex-1 w-full max-w-7xl mx-auto flex items-center justify-center py-6 overflow-hidden">
            {previewFile.type.startsWith("image/") ? (
              <img 
                src={previewFile.url} 
                alt={previewFile.name} 
                className="max-h-[75vh] max-w-full object-contain rounded-2xl shadow-2xl border border-slate-200 dark:border-white/5 animate-scale-up" 
              />
            ) : previewFile.type.startsWith("video/") ? (
              <video 
                src={previewFile.url} 
                controls 
                autoPlay
                className="max-h-[75vh] w-full max-w-4xl rounded-2xl shadow-2xl border border-slate-200 dark:border-white/5" 
              />
            ) : previewFile.type.startsWith("audio/") ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-8 max-w-md w-full text-center space-y-6 shadow-2xl">
                <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 flex items-center justify-center text-indigo-500 mx-auto border border-indigo-500/20">
                  <Music className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-xs mx-auto">{previewFile.name}</h4>
                  <span className="text-[10px] text-slate-400 font-semibold block mt-1 uppercase tracking-wider">{previewFile.type}</span>
                </div>
                <audio src={previewFile.url} controls className="mx-auto w-full max-w-xs" />
              </div>
            ) : previewFile.type.includes("pdf") ? (
              <iframe 
                src={previewFile.url} 
                title={previewFile.name}
                className="w-full h-[75vh] rounded-2xl border border-slate-200 dark:border-white/10 shadow-2xl bg-white" 
              />
            ) : (
              /* Preview Fallback for generic unsupported files */
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl p-10 max-w-md w-full text-center space-y-6 shadow-2xl">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-450 dark:text-slate-405 mx-auto border border-slate-200 dark:border-slate-700">
                  <File className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-xs mx-auto">{previewFile.name}</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-semibold max-w-[280px] mx-auto mt-2">
                    Format preview not natively supported in the browser. You can securely download the decrypted file to view it.
                  </p>
                </div>
                <a 
                  href={previewFile.url}
                  download={previewFile.name}
                  className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98] mt-4"
                >
                  <Download className="w-4 h-4" /> Download Decrypted File
                </a>
              </div>
            )}
          </div>

          {/* Footer Info bar */}
          <div className="w-full text-center py-2 text-[10px] text-slate-550 dark:text-slate-400 font-semibold shrink-0">
            🔒 Client-Side Decrypted. Temporary sandbox URL active.
          </div>
        </div>
      )}

      {/* Upload Queue Panel for sequential progress tracking */}
      {uploadQueue.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 w-80 bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 animate-slide-in flex flex-col gap-3 font-sans border-t-4 border-t-indigo-600">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-[11px] font-extrabold text-slate-700">
              Processing Uploads ({uploadQueue.filter(q => q.status === "completed").length}/{uploadQueue.length})
            </span>
            <span className="text-[9px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-bold">
              Sequential ZKA
            </span>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-2.5 pr-1 scrollbar-thin">
            {uploadQueue.map((item, idx) => (
              <div key={idx} className="flex flex-col gap-1 p-2 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-extrabold text-slate-700 truncate" title={item.name}>
                      {item.name}
                    </p>
                    <span className="text-[8px] text-slate-400 font-bold block">
                      {formatSize(item.size)}
                    </span>
                  </div>
                  <div className="shrink-0">
                    {item.status === "waiting" && (
                      <span className="text-[8px] font-extrabold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md">Queued</span>
                    )}
                    {item.status === "processing" && (
                      <div className="flex items-center gap-1 text-[8px] font-extrabold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-md">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                        <span>Processing</span>
                      </div>
                    )}
                    {item.status === "uploading" && (
                      <div className="flex items-center gap-1 text-[8px] font-extrabold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-md">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        <span>Uploading</span>
                      </div>
                    )}
                    {item.status === "completed" && (
                      <div className="flex items-center gap-1 text-[8px] font-extrabold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                        <Check className="w-2.5 h-2.5" />
                        <span>Done</span>
                      </div>
                    )}
                    {item.status === "failed" && (
                      <div className="flex items-center gap-1 text-[8px] font-extrabold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md">
                        <X className="w-2.5 h-2.5" />
                        <span>Failed</span>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-[9px] text-slate-500 font-semibold truncate italic pl-0.5">
                  {item.progressText}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
