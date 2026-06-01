import * as openpgp from "openpgp";
import { encryptData } from "@vivago-pass/ts-crypto";

/** Proton Pass export JSON (decrypted from data.pgp) */
export interface ProtonExportRoot {
  vaults?: Record<string, ProtonVault>;
}

export interface ProtonVault {
  name?: string;
  items?: ProtonItem[];
}

export interface ProtonItem {
  itemId?: string;
  id?: string;
  type?: string | number;
  modifyTime?: number;
  createTime?: number;
  data?: {
    metadata?: { name?: string; note?: string };
    content?: Record<string, unknown>;
  };
}

/** Proton Pass stores login identifiers as itemUsername / itemEmail, not username / email */
function extractLoginUsername(content: Record<string, unknown>): string {
  const username = asString(
    content.itemUsername ?? content.username ?? content.userName ?? content.login
  );
  const email = asString(content.itemEmail ?? content.email ?? content.mail);
  if (username && email && username !== email) {
    return `${username} (${email})`;
  }
  return username || email;
}

function extractPassword(content: Record<string, unknown>): string {
  return asString(content.password ?? content.itemPassword ?? content.pass);
}

function extractNote(
  content: Record<string, unknown>,
  meta: { note?: string; name?: string }
): string {
  return asString(
    meta.note ?? content.note ?? content.notes ?? content.text ?? content.itemNote
  );
}

export interface VivagoImportDraft {
  id: string;
  type: "login" | "card" | "alias" | "note" | "identity";
  name: string;
  vaultID: string;
  url: string;
  urls: string[];
  username: string;
  password: string;
  totp: string;
  noteText: string;
  cardholderName: string;
  cardNumber: string;
  expirationDate: string;
  cvv: string;
  pin: string;
  aliasEmail: string;
  forwardTo: string;
}

export interface ImportProgress {
  total: number;
  done: number;
  current?: string;
  errors: string[];
}

function protonVaultId(category: string): string {
  const map: Record<string, string> = {
    personal: "vlt_personal",
    trash: "vlt_trash",
  };
  const key = category.toLowerCase();
  if (map[key]) return map[key];
  const clean = key.replace(/[^a-z0-9]/g, "_");
  return `vlt_${clean}`;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function pickUrls(content: Record<string, unknown>): string[] {
  const urls = content.urls ?? content.url;
  if (Array.isArray(urls)) {
    return urls.map(asString).filter(Boolean);
  }
  const single = asString(urls);
  return single ? [single] : [];
}

function resolveProtonType(item: ProtonItem, content: Record<string, unknown>): string {
  const raw = item.type ?? content.type ?? content.itemType;
  if (typeof raw === "string") return raw.toLowerCase();
  if (typeof raw === "number") {
    const map: Record<number, string> = {
      1: "login",
      2: "alias",
      3: "note",
      4: "creditcard",
      5: "identity",
    };
    return map[raw] ?? "login";
  }
  if (content.cardNumber || content.number || content.itemCardNumber) return "creditcard";
  if (content.aliasEmail || content.itemAliasEmail || content.mailbox) return "alias";
  const hasLoginFields =
    content.itemUsername ||
    content.itemEmail ||
    content.username ||
    content.email ||
    content.password ||
    content.itemPassword;
  if (
    (content.note || content.text) &&
    !hasLoginFields &&
    !content.cardNumber
  ) {
    return "note";
  }
  return "login";
}

export function mapProtonExportToDrafts(exportData: ProtonExportRoot): VivagoImportDraft[] {
  const drafts: VivagoImportDraft[] = [];
  const vaults = exportData.vaults ?? {};

  for (const vault of Object.values(vaults)) {
    const vaultName = vault.name ?? "Personal";
    if (/recycle\s*bin/i.test(vaultName)) continue;

    const vaultID = protonVaultId(vaultName);

    for (const item of vault.items ?? []) {
      const content = (item.data?.content ?? {}) as Record<string, unknown>;
      const meta = item.data?.metadata ?? {};
      const name = asString(meta.name) || "Imported item";
      const protonType = resolveProtonType(item, content);
      const urls = pickUrls(content);
      const id =
        asString(item.itemId) ||
        asString(item.id) ||
        `item_${Math.random().toString(36).slice(2, 11)}`;

      let type: VivagoImportDraft["type"] = "login";
      const draft: VivagoImportDraft = {
        id: id.startsWith("item_") ? id : `item_${id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 24)}`,
        type: "login",
        name,
        vaultID,
        url: urls[0] ?? "",
        urls,
        username: "",
        password: "",
        totp: "",
        noteText: "",
        cardholderName: "",
        cardNumber: "",
        expirationDate: "",
        cvv: "",
        pin: "",
        aliasEmail: "",
        forwardTo: "",
      };

      if (protonType === "note") {
        type = "note";
        draft.noteText = extractNote(content, meta);
      } else if (protonType === "alias") {
        type = "alias";
        draft.aliasEmail = asString(
          content.aliasEmail ?? content.itemAliasEmail ?? content.email ?? content.itemEmail
        );
        const mailboxes = content.mailboxes ?? content.forwardTo ?? content.itemMailboxes;
        draft.forwardTo = Array.isArray(mailboxes)
          ? asString(mailboxes[0])
          : asString(mailboxes);
      } else if (protonType === "creditcard" || protonType === "card") {
        type = "card";
        draft.cardholderName = asString(
          content.cardholderName ?? content.itemCardholder ?? content.cardholder
        );
        draft.cardNumber = asString(content.cardNumber ?? content.itemCardNumber ?? content.number);
        draft.expirationDate = asString(
          content.expirationDate ?? content.itemExpirationDate ?? content.expiry
        );
        draft.cvv = asString(content.verificationNumber ?? content.cvv ?? content.itemCvv);
        draft.pin = asString(content.pin ?? content.itemPin);
        draft.noteText = extractNote(content, meta);
      } else {
        type = "login";
        draft.username = extractLoginUsername(content);
        draft.password = extractPassword(content);
        draft.totp = asString(content.totpUri ?? content.itemTotpUri ?? content.totp);
        draft.noteText = extractNote(content, meta);
      }

      draft.type = type;
      drafts.push(draft);
    }
  }

  return drafts;
}

export async function decryptProtonPassExport(
  armoredOrBinary: string | Uint8Array,
  passphrase: string
): Promise<ProtonExportRoot> {
  const message =
    typeof armoredOrBinary === "string"
      ? await openpgp.readMessage({ armoredMessage: armoredOrBinary })
      : await openpgp.readMessage({ binaryMessage: armoredOrBinary });

  const { data } = await openpgp.decrypt({
    message,
    passwords: [passphrase],
    format: "utf8",
  });

  const text = typeof data === "string" ? data : new TextDecoder().decode(data);
  return JSON.parse(text) as ProtonExportRoot;
}

async function importKeyFromHex(keyHex: string): Promise<CryptoKey> {
  const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.importKey(
    "raw",
    keyBytes.buffer,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

function buildEncryptedPayload(draft: VivagoImportDraft) {
  return {
    url: draft.url,
    username: draft.username,
    password: draft.password,
    totp: draft.totp,
    cardholderName: draft.cardholderName,
    cardNumber: draft.cardNumber,
    expirationDate: draft.expirationDate,
    cvv: draft.cvv,
    pin: draft.pin,
    noteText: draft.noteText,
    aliasEmail: draft.aliasEmail,
    forwardTo: draft.forwardTo,
    urls: draft.urls,
    itemID: draft.id,
    shareID: `shr_${draft.id}`,
    vaultID: draft.vaultID,
    passkeyRelyingParty: "",
    passkeyUserName: "",
    passkeyCredentialId: "",
    passkeyPublicKey: "",
    passkeyPrivateKey: "",
    identityFirstName: "",
    identityLastName: "",
    identityGender: "",
    identityBirthDate: "",
    identityPhone: "",
    identityEmail: "",
    identityAddress: "",
    identityCity: "",
    identityState: "",
    identityZip: "",
    identityCountry: "",
    identitySsn: "",
    identityPassport: "",
  };
}

export async function importDraftsToVault(
  drafts: VivagoImportDraft[],
  masterKeyHex: string,
  apiUrl: string,
  userId: string,
  sessionToken: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportProgress> {
  const key = await importKeyFromHex(masterKeyHex);
  const errors: string[] = [];
  let done = 0;

  for (const draft of drafts) {
    onProgress?.({
      total: drafts.length,
      done,
      current: draft.name,
      errors: [...errors],
    });

    try {
      const encrypted = await encryptData(JSON.stringify(buildEncryptedPayload(draft)), key);
      const res = await fetch(`${apiUrl}/api/vault`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId,
          "session-token": sessionToken,
        },
        body: JSON.stringify({
          id: draft.id,
          type: draft.type,
          name: draft.name,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          lastModified: Date.now(),
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        errors.push(`${draft.name}: server ${res.status} — ${body}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${draft.name}: ${msg}`);
    }
    done += 1;
  }

  const result: ImportProgress = { total: drafts.length, done, errors };
  onProgress?.(result);
  return result;
}
