import { 
  encryptData, 
  decryptData, 
  encryptBinary, 
  decryptBinary, 
  base64ToArrayBuffer, 
  arrayBufferToBase64 
} from "@vivago-pass/ts-crypto";
import { CONFIG, getStorage } from "./sessionStore";

export interface AttachmentMetadata {
  name: string;
  type: string;
  size: number;
}

export interface Attachment {
  id: string;
  userId: string;
  vaultItemId: string | null;
  encryptedMetadata: string;
  metadataIv: string;
  metadataAuthTag: string;
  filePath: string;
  fileSize: number;
  uploadedAt: string;
  // Decrypted fields
  decryptedMetadata?: AttachmentMetadata;
}

// 1. Client-Side Lossless Compression using native CompressionStream
export async function compressBuffer(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(buffer).body?.pipeThrough(new CompressionStream("gzip"));
  if (!stream) throw new Error("Compression stream not supported");
  return await new Response(stream).arrayBuffer();
}

export async function decompressBuffer(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(buffer).body?.pipeThrough(new DecompressionStream("gzip"));
  if (!stream) throw new Error("Decompression stream not supported");
  return await new Response(stream).arrayBuffer();
}

// 2. Client-Side HEIC to JPEG Conversion
export async function convertHeicToJpeg(file: File): Promise<Blob> {
  try {
    const heic2any = (await import("heic2any")).default;
    const result = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality: 0.85
    });
    return Array.isArray(result) ? result[0] : result;
  } catch (err) {
    console.error("HEIC conversion failed:", err);
    throw new Error("Failed to convert HEIC image: " + (err as Error).message);
  }
}

// 3. Client-Side Canvas Image Compression (WebP)
export async function compressImage(imageBlob: Blob, maxWidth = 1920, maxHeight = 1080): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(imageBlob);
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas compression failed"));
        },
        "image/webp",
        0.8 // WebP 80% quality offers great compression losslessly-looking
      );
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(img.src);
      reject(err);
    };
  });
}

// 4. Encrypt file and metadata (ZKA format: [12-byte IV] + [Ciphertext] + [16-byte Auth Tag])
export async function encryptAttachment(
  file: File,
  vaultItemId: string | null,
  masterKey: CryptoKey
): Promise<{
  encryptedBlob: Blob;
  encryptedMetadata: string;
  metadataIv: string;
  metadataAuthTag: string;
  originalMetadata: AttachmentMetadata;
}> {
  let fileBlob: Blob = file;
  let fileName = file.name;
  let fileType = file.type;

  // 4a. HEIC check and convert
  const isHeic = file.name.toLowerCase().endsWith(".heic") || file.type === "image/heic";
  if (isHeic) {
    fileBlob = await convertHeicToJpeg(file);
    fileName = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
    fileType = "image/jpeg";
  }

  // 4b. Image compress check
  const isImage = fileType.startsWith("image/") && !fileType.includes("svg") && !fileType.includes("gif");
  if (isImage) {
    fileBlob = await compressImage(fileBlob);
    if (!fileName.toLowerCase().endsWith(".webp")) {
      fileName = fileName.replace(/\.[^/.]+$/, "") + ".webp";
    }
    fileType = "image/webp";
  }

  // 4c. Lossless compression for non-image files or generic data
  let rawBuffer = await fileBlob.arrayBuffer();
  if (!isImage) {
    try {
      rawBuffer = await compressBuffer(rawBuffer);
      fileType = fileType || "application/octet-stream";
    } catch (compressionErr) {
      console.warn("Native CompressionStream failed, fallback to raw buffer:", compressionErr);
    }
  }

  // 4d. Encrypt raw binary file contents
  const fileEnc = await encryptBinary(rawBuffer, masterKey);
  const ivBytes = new Uint8Array(base64ToArrayBuffer(fileEnc.iv));
  const authTagBytes = new Uint8Array(base64ToArrayBuffer(fileEnc.authTag));
  const ciphertextBytes = new Uint8Array(base64ToArrayBuffer(fileEnc.ciphertext));

  // Construct packed byte array: [12-byte IV] + [Ciphertext] + [16-byte Auth Tag]
  const packedBytes = new Uint8Array(ivBytes.length + ciphertextBytes.length + authTagBytes.length);
  packedBytes.set(ivBytes, 0);
  packedBytes.set(ciphertextBytes, ivBytes.length);
  packedBytes.set(authTagBytes, ivBytes.length + ciphertextBytes.length);

  const encryptedBlob = new Blob([packedBytes], { type: "application/octet-stream" });

  // 4e. Encrypt Metadata (Filename, MIME type, size)
  const metadataObj: AttachmentMetadata = {
    name: fileName,
    type: fileType,
    size: file.size
  };
  const { ciphertext: metaCipher, iv: metaIv, authTag: metaAuthTag } = await encryptData(
    JSON.stringify(metadataObj),
    masterKey
  );

  return {
    encryptedBlob,
    encryptedMetadata: metaCipher,
    metadataIv: metaIv,
    metadataAuthTag: metaAuthTag,
    originalMetadata: metadataObj
  };
}

// 5. Decrypt downloaded attachment
export async function decryptAttachment(
  encryptedBlob: Blob,
  metadataIv: string,
  metadataAuthTag: string,
  encryptedMetadata: string,
  masterKey: CryptoKey
): Promise<{ blob: Blob; metadata: AttachmentMetadata }> {
  // 5a. Decrypt Metadata
  const metadataStr = await decryptData(encryptedMetadata, metadataIv, metadataAuthTag, masterKey);
  const metadata: AttachmentMetadata = JSON.parse(metadataStr);

  // 5b. Unpack binary file contents
  const packedBytes = new Uint8Array(await encryptedBlob.arrayBuffer());
  const ivBase64 = arrayBufferToBase64(packedBytes.slice(0, 12).buffer);
  const authTagBase64 = arrayBufferToBase64(packedBytes.slice(packedBytes.length - 16).buffer);
  const ciphertextBase64 = arrayBufferToBase64(packedBytes.slice(12, packedBytes.length - 16).buffer);

  // 5c. Decrypt binary contents
  let decryptedBuffer = await decryptBinary(ciphertextBase64, ivBase64, authTagBase64, masterKey);

  // 5d. Decompress if non-image format (losslessly compressed)
  const isImage = metadata.type === "image/webp" || metadata.type === "image/jpeg" || metadata.type === "image/png";
  if (!isImage) {
    try {
      decryptedBuffer = await decompressBuffer(decryptedBuffer);
    } catch (decompressionErr) {
      console.warn("Decompression failed, returning raw decrypted buffer:", decompressionErr);
    }
  }

  const decryptedBlob = new Blob([decryptedBuffer], { type: metadata.type });
  return { blob: decryptedBlob, metadata };
}

// API Communication Wrappers
export async function uploadAttachmentFile(
  file: File,
  vaultItemId: string | null,
  masterKey: CryptoKey
): Promise<Attachment> {
  const { encryptedBlob, encryptedMetadata, metadataIv, metadataAuthTag, originalMetadata } = 
    await encryptAttachment(file, vaultItemId, masterKey);

  const formData = new FormData();
  formData.append("file", encryptedBlob, file.name);
  formData.append("encryptedMetadata", encryptedMetadata);
  formData.append("metadataIv", metadataIv);
  formData.append("metadataAuthTag", metadataAuthTag);
  if (vaultItemId) {
    formData.append("vaultItemId", vaultItemId);
  }

  const storage = getStorage();
  const userId = storage.getItem("x-user-id") || "";
  const sessionToken = storage.getItem("session-token") || "";

  const res = await fetch(`${CONFIG.API_URL}/api/attachments`, {
    method: "POST",
    headers: {
      "x-user-id": userId,
      "session-token": sessionToken
    },
    body: formData
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || "Attachment upload failed");
  }

  const attachment: Attachment = await res.json();
  attachment.decryptedMetadata = originalMetadata;
  return attachment;
}

export async function fetchAttachmentsList(masterKey: CryptoKey): Promise<Attachment[]> {
  const storage = getStorage();
  const userId = storage.getItem("x-user-id") || "";
  const sessionToken = storage.getItem("session-token") || "";

  const res = await fetch(`${CONFIG.API_URL}/api/attachments`, {
    headers: {
      "x-user-id": userId,
      "session-token": sessionToken
    }
  });

  if (!res.ok) {
    throw new Error("Failed to fetch attachments list");
  }

  const data = await res.json();
  const list: Attachment[] = data.attachments || [];

  // Decrypt metadata for all items locally
  for (const att of list) {
    try {
      const metaStr = await decryptData(att.encryptedMetadata, att.metadataIv, att.metadataAuthTag, masterKey);
      att.decryptedMetadata = JSON.parse(metaStr);
    } catch (err) {
      console.error("Failed to decrypt metadata for attachment ID:", att.id, err);
      att.decryptedMetadata = {
        name: "Encrypted File",
        type: "application/octet-stream",
        size: att.fileSize
      };
    }
  }

  return list;
}

export async function downloadAttachmentFile(
  attachment: Attachment,
  masterKey: CryptoKey
): Promise<{ blob: Blob; metadata: AttachmentMetadata }> {
  const storage = getStorage();
  const userId = storage.getItem("x-user-id") || "";
  const sessionToken = storage.getItem("session-token") || "";

  const res = await fetch(`${CONFIG.API_URL}/api/attachments/${attachment.id}`, {
    headers: {
      "x-user-id": userId,
      "session-token": sessionToken
    }
  });

  if (!res.ok) {
    throw new Error("Failed to download encrypted attachment file");
  }

  const encryptedBlob = await res.blob();
  return await decryptAttachment(
    encryptedBlob,
    attachment.metadataIv,
    attachment.metadataAuthTag,
    attachment.encryptedMetadata,
    masterKey
  );
}

export async function deleteAttachmentFile(id: string): Promise<void> {
  const storage = getStorage();
  const userId = storage.getItem("x-user-id") || "";
  const sessionToken = storage.getItem("session-token") || "";

  const res = await fetch(`${CONFIG.API_URL}/api/attachments/${id}`, {
    method: "DELETE",
    headers: {
      "x-user-id": userId,
      "session-token": sessionToken
    }
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || "Failed to delete attachment");
  }
}
