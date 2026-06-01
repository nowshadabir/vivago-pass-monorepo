# Project Plan — Pass Encryption (ZKA Platform)

## Purpose

This document is the canonical project plan for the Pass Encryption repository. It describes goals, repo layout, security systems, rules, workflows, and operational practices required to build and operate a Zero-Knowledge password & secrets manager across Web, Extension, and Mobile platforms.

## Objectives

- Deliver a Zero-Knowledge Architecture (ZKA) secrets manager with shared TypeScript crypto primitives.
- Keep plaintext secrets exclusively in client memory; servers persist only encrypted blobs and hardened authentication tokens.
- Maintain algebraic parity across platforms (Next.js & Flutter) for deterministic crypto.
- Enforce strict security, CI checks, audits, and documented operational procedures.

## Roadmap

- Phase 1: Web (Next.js frontend + Node.js API) — core features, KDF, AES encryption, account flows.
- Phase 2: Browser Extension — reuse `packages/ts-crypto` and `packages/types`, offline-first sync.
- Phase 3: Mobile (Flutter) — ensure crypto parity and secure key handling.

## Technology Stack

- Frontend: Next.js (React, TypeScript)
- Backend: Node.js (Express/Fastify, TypeScript)
- Database: MySQL (schema and migrations in `apps/api/schema.sql`)
- Shared packages: `packages/ts-crypto`, `packages/types`
- Web cryptography: Native WebCrypto (`crypto.subtle`) wrappers in `packages/ts-crypto`

## Repository Layout (current workspace)

- `apps/web/` — Next.js app (app router, pages: login/signup/profile/dashboard)
- `apps/api/` — Node.js API (DB access `src/db.ts`, server entry `src/index.ts`, `schema.sql`)
- `apps/extension/` — Browser extension package
- `apps/mobile/` — Mobile app (docs / Flutter)
- `packages/ts-crypto/` — Shared cryptography helpers and wrappers
- `packages/types/` — Shared TypeScript types and interfaces
- Top-level docs: `README.md`, `rules.md`, `project-plan.md`

Refer to the workspace tree for exact locations and owners of components.

## Core Security Systems and Practices

This project demands defense-in-depth. Below are the systems and rules to follow.

- Zero-Knowledge Architecture (ZKA):
  - Master Password and plaintext vault data must never be sent to the server.
  - Clients derive keys locally (see KDF below) and only upload encrypted blobs and authentication digests.

- Key Derivation Function (KDF):
  - PBKDF2-SHA256 (or Argon2id where available) with high iteration counts/parameters.
  - Current spec: PBKDF2-SHA256, 600,000 iterations, 512-bit output; split into two 256-bit keys (Encryption Key and Authentication Key).
  - Deterministic salt composition: `user_email + global_pepper` (pepper stored in environment, rotated occasionally).

- Symmetric Encryption:
  - AES-256-GCM for payload encryption with 12-byte random IVs; store IV + ciphertext + auth tag (Base64) server-side.

- Authentication & Sessions:
  - The Authentication Key (or a hash thereof) is used to derive a server-stored verifier (re-hash with Argon2id/bcrypt) for login validation.
  - Session management implemented in `apps/web/src/lib/sessionStore.ts` (or `apps/api` session middleware). Sessions must use secure, HttpOnly cookies with `SameSite=Lax` or `Strict` as appropriate.
  - Short-lived access tokens, refresh tokens rotated on use. Prefer server-side sessions where possible to minimize token leakage.

- Transport Security:
  - Enforce TLS 1.2+; HSTS; HTTP -> HTTPS redirects.
  - Use `Strict-Transport-Security`, certificate pinning for clients where practical (extensions/mobile).

- Web App Security Headers:
  - Content-Security-Policy (CSP)
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff
  - Referrer-Policy: strict-origin-when-cross-origin

- Cookie & CSRF Protections:
  - Cookies: `Secure`, `HttpOnly`, `SameSite=Strict/Lax` depending on flows.
  - CSRF tokens for state-changing endpoints or use double-submit cookie + SameSite.

- Input Validation & Output Encoding:
  - Strong server-side input validation on all API endpoints in `apps/api/src`.
  - Escape/encode outputs in the web UI; prefer attribute/textContent over innerHTML.

- CORS & Rate Limiting:
  - CORS restricted to allowed origins (configurable via env).
  - Rate limiting on auth endpoints and high-risk routes (login, password reset, API write endpoints).

- Secrets & Key Management:
  - Do not commit secrets. Use environment variables (e.g., `.env.local` for dev, CI secrets for pipelines).
  - Use a secrets store for production (GitHub Actions secrets, Vault, AWS Secrets Manager, etc.).
  - Rotate server-side peppers and backup encryption keys on a documented schedule.

- Dependency & Supply-Chain Security:
  - Enable Dependabot or equivalent automations for dependency updates.
  - Run `npm audit`/`yarn audit` in CI, and fail builds on high/critical vulnerabilities unless triaged.
  - Pin critical packages and prefer audited, minimally sized crypto code paths.

- Static Analysis, Scanning & Testing:
  - ESLint (strict), TypeScript `--strict`, Prettier formatting.
  - Static application security testing (SAST) in CI.
  - Fuzzing and unit tests for crypto edge-cases in `packages/ts-crypto`.

- Logging, Monitoring & Alerting:
  - Audit logs for auth events, key rotations, backup restores.
  - Centralized logging (structured JSON), redact PII and any sensitive ciphertext fields.
  - Set up SLOs & alerts for API error rates, auth failure spikes, suspicious activity.

- Database Security & Backups:
  - Principle of least privilege for DB users.
  - Regular backups of MySQL with encryption at rest and testable restore procedures.
  - Migrations tracked and versioned; avoid destructive schema changes without backups & rollbacks.

- Backup & Disaster Recovery (DR):
  - Daily backups; weekly offsite encrypted backups.
  - DR playbook documenting recovery steps and RTO/RPO targets.

## Rules, Conventions & Workflows

These are the team rules and repo conventions to ensure quality and security.

- Branching & Releases:
  - Main `main` (or `master`) is always deployable. Feature branches from `develop` or directly from `main` depending on workflow.
  - Use pull requests for all changes; require at least one approving review and passing CI.

- Commit Messages & PRs:
  - Use conventional commits or a clear short summary. Include a brief description and link to issue.
  - PR checklist: tests pass, lint passes, change log updated (if applicable), security impact assessed.

- Code Review & Ownership:
  - All PRs reviewed by at least one maintainer. Sensitive changes (crypto, auth, DB migrations) require two reviewers.
  - Tag reviewers and security owners for critical changes.

- Tests & CI:
  - CI should run: typecheck, lint, unit tests, package build, SAST, dependency audit.
  - E2E tests for critical flows (signup, login, vault CRUD, export/import).

- Linting & Formatting:
  - Enforce ESLint and Prettier configurations. `tsconfig.json` with `strict` enabled across apps and packages.

- Security Review Gate:
  - Any change touching `packages/ts-crypto`, auth flows, or `apps/api/src/db.ts` must include a short security review in the PR description.

## API & Data Contracts

- Keep API contracts in `packages/types` and prefer schema-first design for stable client/server integration.
- Store encrypted vault entries as typed blobs: { iv, ciphertext, tag, v: version, meta }.
- Version blobs to allow algorithm upgrades and backward compatibility.

## Operational & Deployment Notes

- CI/CD: Build pipelines should publish artifacts and deploy when `main` receives a release tag.
- Use immutable deployments and environment-specific config: `staging`, `production`.
- Rolling key rotations require clients to support re-encrypting blobs under a new envelope when users relogin.

## Testing & Crypto Verification

- Unit tests and property-based tests for `packages/ts-crypto` to ensure deterministic outputs for same inputs across platforms.
- Cross-platform test vectors: store canonical test vectors and run them in CI to guarantee parity (especially important for Flutter).

## Documentation & Onboarding

- Keep `README.md`, `rules.md`, and this `project-plan.md` up to date.
- Add a `SECURITY.md` describing how to report vulnerabilities and contact security maintainers.

## Incident Response

- Maintain an incident playbook covering: detection, containment, eradication, recovery, and post-incident review.
- Rotate any keys or peppers if a server breach is suspected; communicate to users if necessary per policy.

## Owners & Contacts

- Maintain a `MAINTAINERS.md` or update repository settings with owner emails/team handles. For now, add owners in PRs and `README.md`.

---

If you want, I can:

- Add a `SECURITY.md` and `MAINTAINERS.md` next.
- Wire up CI checks (ESLint, TypeScript, audit) in GitHub Actions.

References: `rules.md`, `apps/api/schema.sql`, `apps/api/src/db.ts`, `apps/web/src/lib/sessionStore.ts`, `packages/ts-crypto`, `packages/types`.
