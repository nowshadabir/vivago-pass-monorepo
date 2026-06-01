# System Plan & Project Context: Pass Encryption (ZKA Platform)

## 🎯 Role & Objective

Act as a Lead Security-Focused Full-Stack Developer. The goal of this project is to build "Pass Encryption" (Vivago Pass), a multi-platform password and secrets manager.

**Absolute Priority:** Security and Zero-Knowledge Architecture (ZKA).
**UI/UX Note:** The user is a professional UI/UX developer and will handle all interface design and styling. Do not generate CSS, Tailwind classes, or UI component structures unless explicitly requested to wire up logic. Focus entirely on cryptographic pipelines, backend architecture, data structures, and cross-platform consistency.

---

## 🏗️ Project Roadmap & Scale

- **Phase 1 (Completed/Active):** Web Application (Next.js Frontend + Express Node.js Backend).
- **Phase 2 (Pending):** Browser Extension (Sharing core TS logic/`ts-crypto` with the Web App).
- **Phase 3 (Pending):** Mobile Application (Flutter/Dart, requiring strict mathematical parity with the TS crypto implementation).

---

## 💻 Technology Stack & Current State

### Frontend Engine (apps/web)
- **Framework:** Next.js 16.2.6 (React 19, TypeScript, Turbopack)
- **Styling:** Tailwind CSS v4, PostCSS, `@tailwindcss/postcss`
- **UI Components:** Radix UI primitives (`@radix-ui/react-label`, `@radix-ui/react-slot`), Tailwind Animate, Lucide React
- **WebAuthn Integration:** `@simplewebauthn/browser` for passkey creation and authentication

### Backend Engine (apps/api)
- **Framework:** Node.js + Express (TypeScript)
- **Database:** MySQL
- **Mailing:** Nodemailer for secure email verification OTPs
- **Security Middleware:** CORS, `express-rate-limit` (brute-force prevention on authentication/OTP endpoints), and bcryptjs (hashing auth keys and backup codes)
- **WebAuthn Server:** `@simplewebauthn/server` for passkey option generation and response validation

### Shared Packages (packages/)
- **`ts-crypto`**: Shared TS library utilizing native Web Crypto API (`window.crypto.subtle` in browsers, Node.js `crypto` module in server/CLI environments). Prevents supply-chain attacks by avoiding external cryptographic dependencies.
- **`types`**: Shared TypeScript types and interfaces (e.g., `VaultItem`, `UserSession`).

---

## 🔐 Core Philosophy: Zero-Knowledge Architecture (ZKA)

The server acts **strictly as a blind storage drive**. The Node.js backend and MySQL database never receive, process, or store the unencrypted Master Password or the plaintext vault data.

### Cryptographic Pipelines (Cross-Platform Standards)

To ensure the Next.js app, browser extension, and future Flutter app can encrypt/decrypt the same data, they adhere to the following:

#### 1. Key Derivation (PBKDF2-SHA256)
- **Input:** User's Master Password + Deterministic Salt (e.g., `user_email + global_pepper`).
- **Pepper:** `"VIVAGO_PASS_PEPPER_KEY"`
- **Iterations:** 600,000 iterations.
- **Output:** A 512-bit hash.
- **Action:** Split the hash into:
  - `Encryption Key` (Bytes 0-31): AES-GCM 256-bit key. Stays strictly in client memory.
  - `Authentication Key` (Bytes 32-63): 256-bit hash converted to a 64-character hex string. Sent to the server for login/registration validation. The server hashes this *again* using bcrypt before database storage.

#### 2. Symmetric Vault Encryption (AES-256-GCM)
- **Payloads:** Credentials, Notes, Cards, Aliases, Identities, and Passkeys.
- **Process:** The client encrypts JSON payloads with the derived `Encryption Key` using a randomly generated 12-byte IV.
- **Passkeys (Third-Party):** Stored as a `passkey` item type, containing the relying party domain (e.g. `facebook.com`), username, credential ID, and client-side generated WebAuthn `ES256` public/private keypair in JWK format.
- **2FA TOTP:** Calculates real-time 6-digit verification codes using client-side Base32 decoding and dynamic HMAC-SHA1 signatures synchronized to the 30-second epoch cycle.
- **Output:** Base64-encoded Ciphertext, Base64-encoded IV, and Base64-encoded 128-bit Auth Tag.

#### 3. Backup Codes & Recovery
- **Generation:** 8 random alphanumeric backup codes are generated on registration or regeneration.
- **Derivation:** Each backup code derives a wrapping key via PBKDF2-SHA256 (100,000 iterations, salt: `user_email + "BACKUP_CODE_SALT_PEPPER"`).
- **Master Key Wrapping:** The `Encryption Key` is exported to raw bytes, converted to a hex string, and encrypted with the backup code's derived key (producing encrypted master key, IV, and auth tag).
- **Verification:** The server stores bcrypt hashes of the backup codes. The client transmits the raw backup code on recovery, the server verifies it, and returns the encrypted master key wrapping parameters. The client then unwraps the master key locally using the backup code.

#### 4. Passkey Master Key Recovery (WebAuthn PRF Extension)
- **Mechanism:** Leverages the WebAuthn `prf` (Pseudo-Random Function) extension.
- **Key Derivation:** The authenticator returns a deterministic salt-derived 32-byte secret (PRF value) on successful biometric authentication.
- **Wrapping:** The `Encryption Key` is wrapped (encrypted) using this PRF key. The encrypted payload is stored on the database server.
- **Unwrapping:** On login, the server retrieves the wrapped key parameters, the user authenticates with their passkey obtaining the same PRF value, and the client decrypts the `Encryption Key` locally.

#### 5. End-to-End Sharing (RSA-OAEP 2048 + AES-256-GCM)
- **Sharing Keys:** Each user generates an asymmetric RSA-OAEP 2048-bit key pair.
  - Public Key: Exported as SPKI Base64 and stored publicly on the server.
  - Private Key: Serialized as JWK, encrypted using the user's `Encryption Key` (AES-GCM), and stored on the server.
- **Sharing Pipeline:**
  1. Sender fetches the recipient's public RSA key.
  2. Sender generates a transient AES-GCM 256-bit key, encrypts the shared payload with it, and encrypts this transient AES key with the recipient's public RSA key.
  3. Receiver fetches the encrypted sharing package, decrypts their private RSA key using their master key, decrypts the transient AES key using their private RSA key, and decrypts the shared payload.

---

## 📁 Monorepo Structure & File Mapping

```text
/
├── apps/
│   ├── web/               # Next.js Frontend
│   │   ├── src/
│   │   │   └── app/
│   │   │       ├── dashboard/      # Vault view, item creator, E2E sharing panels
│   │   │       ├── forgot-password/# Reset passwords via OTP
│   │   │       ├── login/          # Password/Passkey entry
│   │   │       ├── profile/        # Profile editing, Passkey management, Sharing Key creation
│   │   │       ├── signup/         # Account creation, Backup code generation
│   │   │       └── globals.css     # Tailwind v4 globals
│   ├── api/               # Express Node.js Backend
│   │   ├── src/
│   │   │   ├── index.ts            # Route handlers (auth, vault, passkey, sharing)
│   │   │   └── db.ts               # MySQL connection & queries (prepared statements)
│   │   └── schema.sql              # Database structure
├── packages/
│   ├── ts-crypto/         # Shared WebCrypto cryptographic wrappers
│   │   └── index.ts        # PBKDF2, AES-GCM, RSA-OAEP, PRF functions
│   └── types/             # Shared TypeScript types
│       └── index.ts        # Common interfaces (e.g. VaultItem)
```

---

## 🗄️ Database Architecture (`schema.sql`)

The backend utilizes a MySQL schema comprising the following tables:
- **`users`**: Contains user metadata (`id`, `email`, `name`, `auth_key_hash`, `encrypted_master_key`, `master_key_iv`, `master_key_auth_tag`, `plan`, `is_verified`, `otp_code`, `otp_expires_at`, `created_at`).
- **`backup_codes`**: Hashed backup codes (`id`, `user_id`, `code_hash`, `encrypted_master_key`, `iv`, `auth_tag`, `used`, `used_at`, `created_at`).
- **`vault_items`**: User vault records (`id`, `user_id`, `ciphertext`, `iv`, `auth_tag`, `created_at`, `updated_at`).
- **`passkeys`**: WebAuthn credential metadata (`id`, `user_id`, `public_key`, `counter`, `encrypted_master_key`, `iv`, `auth_tag`, `created_at`).
- **`user_keys`**: Cryptographic asymmetric keys for sharing (`user_id`, `public_key`, `encrypted_private_key`, `iv`, `auth_tag`, `created_at`).
- **`shared_items`**: Envelope-encrypted shared items (`id`, `sender_id`, `receiver_id`, `type`, `name`, `ciphertext`, `encrypted_key`, `iv`, `auth_tag`, `created_at`).
