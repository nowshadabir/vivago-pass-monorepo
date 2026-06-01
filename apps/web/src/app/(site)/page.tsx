import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Puzzle,
  Fingerprint,
  Globe,
  KeyRound,
  Lock,
  Share2,
  Shield,
  Smartphone,
  Sparkles,
} from "lucide-react";

const TRUST_BADGES = [
  "AES-256-GCM",
  "PBKDF2 · 600k iterations",
  "Web Crypto API",
  "No plaintext on server",
];

const ZKA_STEPS = [
  {
    step: "01",
    title: "Derive keys on your device",
    body: "Your master password and email feed PBKDF2-SHA256 (600,000 iterations). The encryption key stays in memory; only an auth verifier is sent to our API.",
  },
  {
    step: "02",
    title: "Encrypt before upload",
    body: "Logins, cards, notes, identities, and passkeys are serialized to JSON and sealed with AES-256-GCM using a random 12-byte IV and auth tag.",
  },
  {
    step: "03",
    title: "Blind storage",
    body: "Our servers store ciphertext, IV, and auth tag only. We cannot decrypt your vault — even under compulsion — because we never have your master key.",
  },
];

const FEATURES = [
  {
    icon: KeyRound,
    title: "Unified vault",
    desc: "Logins, cards, secure notes, email aliases, identities, and passkeys in one encrypted vault.",
  },
  {
    icon: Fingerprint,
    title: "Passkey unlock",
    desc: "WebAuthn with PRF extension wraps your master key so biometrics can unlock without retyping your password.",
  },
  {
    icon: Sparkles,
    title: "Built-in 2FA",
    desc: "TOTP secrets stay encrypted; six-digit codes are generated locally every 30 seconds.",
  },
  {
    icon: Share2,
    title: "End-to-end sharing",
    desc: "RSA-OAEP 2048 envelopes let you share items with other users without exposing keys to the server.",
  },
  {
    icon: Shield,
    title: "Backup recovery",
    desc: "One-time backup codes derive wrapping keys client-side to recover your master key if you lose access.",
  },
  {
    icon: Puzzle,
    title: "Browser extension",
    desc: "Autofill, site-aware suggestions, and passkey support — same crypto stack as the web app.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200/80">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(99,102,241,0.18),transparent)]"
          aria-hidden
        />
        <div className="pointer-events-none absolute -left-32 top-20 h-72 w-72 rounded-full bg-indigo-200/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -right-24 bottom-0 h-64 w-64 rounded-full bg-violet-200/35 blur-3xl" aria-hidden />

        <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:py-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-200/80 bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-indigo-700 shadow-sm">
              <Lock className="h-3.5 w-3.5" />
              Zero-knowledge architecture
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
              Passwords you own.
              <span className="mt-2 block bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
                Servers we cannot read.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
              Vivago Pass is a multi-platform secrets manager built on native Web
              Crypto — no third-party crypto libraries. Your master password never
              leaves your device; our backend is a blind drive for encrypted blobs.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/30 transition hover:shadow-xl"
              >
                Start free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-7 py-3.5 text-sm font-bold text-slate-800 shadow-sm transition hover:border-slate-300"
              >
                View pricing
              </Link>
            </div>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-2">
              {TRUST_BADGES.map((badge) => (
                <span
                  key={badge}
                  className="rounded-lg border border-slate-200/90 bg-white/90 px-3 py-1.5 font-mono text-[11px] font-semibold text-slate-600 shadow-sm"
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>

          {/* Vault preview card */}
          <div className="mx-auto mt-16 max-w-lg">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10 ring-1 ring-slate-900/5">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <Image src="/logo.jpg" alt="" width={24} height={24} className="rounded-md" />
                <span className="text-sm font-bold text-slate-800">Vivago Pass</span>
                <span className="ml-auto rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                  Encrypted
                </span>
              </div>
              <div className="space-y-3 p-5 font-mono text-xs">
                <div className="rounded-lg bg-slate-50 p-3 text-slate-500">
                  <span className="text-slate-400">ciphertext</span>
                  <br />
                  U2FsdGVkX1+8K3v…9mQ2pL
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-indigo-50 p-2.5 text-indigo-800">
                    <span className="text-[10px] text-indigo-500">iv</span>
                    <br />
                    a8f3c2…
                  </div>
                  <div className="rounded-lg bg-violet-50 p-2.5 text-violet-800">
                    <span className="text-[10px] text-violet-500">authTag</span>
                    <br />
                    7b2e91…
                  </div>
                </div>
                <p className="text-center text-[11px] text-slate-400">
                  What our database stores — not your passwords.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ZKA flow */}
      <section id="security" className="border-b border-slate-200/80 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              How zero-knowledge works
            </h2>
            <p className="mt-4 text-slate-600">
              Every vault item follows the same pipeline across web, extension, and
              future mobile — derived from our shared{" "}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm text-indigo-700">
                ts-crypto
              </code>{" "}
              package.
            </p>
          </div>
          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {ZKA_STEPS.map((item) => (
              <article
                key={item.step}
                className="relative rounded-2xl border border-slate-200 bg-[#f8fafc] p-6 shadow-sm"
              >
                <span className="text-4xl font-black text-indigo-100">{item.step}</span>
                <h3 className="mt-2 text-lg font-bold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-center text-3xl font-extrabold text-slate-900">
            Everything encrypted. Nothing exposed.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-center text-slate-600">
            The same encryption key protects all item types — from a GitHub login to
            a credit card or shared document link.
          </p>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-indigo-200 hover:shadow-md"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-bold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Platforms */}
      <section className="border-y border-slate-200/80 bg-white py-16">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 sm:flex-row sm:justify-center sm:px-6">
          <div className="flex items-center gap-3 text-slate-700">
            <Globe className="h-8 w-8 text-indigo-600" />
            <div>
              <p className="font-bold text-slate-900">Web app</p>
              <p className="text-sm text-slate-500">Full vault & sharing</p>
            </div>
          </div>
          <div className="hidden h-10 w-px bg-slate-200 sm:block" />
          <div className="flex items-center gap-3 text-slate-700">
            <Puzzle className="h-8 w-8 text-indigo-600" />
            <div>
              <p className="font-bold text-slate-900">Browser extension</p>
              <p className="text-sm text-slate-500">Autofill & passkeys</p>
            </div>
          </div>
          <div className="hidden h-10 w-px bg-slate-200 sm:block" />
          <div className="flex items-center gap-3 text-slate-500">
            <Smartphone className="h-8 w-8 text-slate-400" />
            <div>
              <p className="font-bold text-slate-700">Mobile</p>
              <p className="text-sm text-slate-400">Coming soon</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-700 px-8 py-14 text-center shadow-xl shadow-indigo-900/20 sm:px-16">
            <h2 className="text-3xl font-extrabold text-white sm:text-4xl">
              Take back control of your secrets
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-indigo-100">
              Create a free account in minutes. Your vault is encrypted before the
              first item is saved.
            </p>
            <Link
              href="/signup"
              className="mt-8 inline-flex items-center gap-2 rounded-xl bg-white px-8 py-3.5 text-sm font-bold text-indigo-700 shadow-lg transition hover:bg-indigo-50"
            >
              Create your vault
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
