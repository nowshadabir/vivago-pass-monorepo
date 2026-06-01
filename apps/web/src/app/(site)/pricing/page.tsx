import type { Metadata } from "next";
import Link from "next/link";
import { Check, HelpCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple pricing for Vivago Pass. Zero-knowledge security on every plan.",
};

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    description: "Personal use with full zero-knowledge encryption.",
    highlighted: false,
    cta: "Get started",
    href: "/signup",
    features: [
      "Unlimited devices (web + extension)",
      "Unlimited vault items",
      "AES-256-GCM vault encryption",
      "TOTP authenticator",
      "Passkeys & backup codes",
      "Community support",
    ],
  },
  {
    id: "personal",
    name: "Personal",
    price: "$3",
    period: "/ month",
    description: "Power users who want sharing and priority support.",
    highlighted: true,
    cta: "Start Personal",
    href: "/signup?plan=personal",
    features: [
      "Everything in Free",
      "End-to-end item sharing (RSA-OAEP)",
      "Document attachments (encrypted)",
      "Import from Proton Pass & more",
      "Priority email support",
      "Security audit notifications",
    ],
  },
  {
    id: "family",
    name: "Family",
    price: "$7",
    period: "/ month",
    description: "Up to 6 members, each with an isolated ZKA vault.",
    highlighted: false,
    cta: "Start Family",
    href: "/signup?plan=family",
    features: [
      "Everything in Personal",
      "6 private vaults (invite members)",
      "Shared family emergency kit",
      "Admin recovery policies",
      "Dedicated onboarding",
      "SLA-backed support",
    ],
  },
];

const COMPARE_ROWS = [
  { label: "Client-side encryption", free: true, personal: true, family: true },
  { label: "PBKDF2 key derivation (600k)", free: true, personal: true, family: true },
  { label: "Passkey unlock (WebAuthn PRF)", free: true, personal: true, family: true },
  { label: "Browser extension", free: true, personal: true, family: true },
  { label: "E2E sharing", free: false, personal: true, family: true },
  { label: "Encrypted attachments", free: false, personal: true, family: true },
  { label: "Family members", free: "1", personal: "1", family: "6" },
];

export default function PricingPage() {
  return (
    <div className="pb-20">
      <section className="border-b border-slate-200/80 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Simple pricing. Same security everywhere.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Every plan uses identical zero-knowledge cryptography. We never upsell
            your privacy — paid tiers add sharing, storage, and support.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`relative flex flex-col rounded-2xl border p-8 shadow-sm ${
                plan.highlighted
                  ? "border-indigo-300 bg-white shadow-lg shadow-indigo-100 ring-2 ring-indigo-600/20"
                  : "border-slate-200 bg-white"
              }`}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}
              <h2 className="text-lg font-bold text-slate-900">{plan.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{plan.description}</p>
              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-extrabold text-slate-900">{plan.price}</span>
                <span className="text-sm font-medium text-slate-500">{plan.period}</span>
              </div>
              <ul className="mt-8 flex-1 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2.5 text-sm text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.href}
                className={`mt-8 block rounded-xl py-3 text-center text-sm font-bold transition ${
                  plan.highlighted
                    ? "bg-indigo-600 text-white shadow-md hover:bg-indigo-700"
                    : "border border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"
                }`}
              >
                {plan.cta}
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-8 flex items-start justify-center gap-2 text-center text-sm text-slate-500">
          <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Billing is handled securely. Payment details are never mixed with vault
          encryption keys.
        </p>
      </section>

      <section className="border-t border-slate-200/80 bg-white py-16">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-slate-900">
            Compare plans
          </h2>
          <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 font-bold text-slate-700">Feature</th>
                  <th className="px-4 py-3 font-bold text-slate-700">Free</th>
                  <th className="px-4 py-3 font-bold text-indigo-700">Personal</th>
                  <th className="px-4 py-3 font-bold text-slate-700">Family</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{row.label}</td>
                    {(["free", "personal", "family"] as const).map((col) => (
                      <td key={col} className="px-4 py-3 text-slate-600">
                        {typeof row[col] === "boolean" ? (
                          row[col] ? (
                            <Check className="h-4 w-4 text-indigo-600" />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )
                        ) : (
                          row[col]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-xl font-bold text-slate-900">Need a team plan?</h2>
        <p className="mt-2 text-slate-600">
          Contact us for volume licensing, SSO roadmap, and custom security reviews.
        </p>
        <Link
          href="/contact"
          className="mt-6 inline-block rounded-xl border border-slate-200 bg-white px-6 py-2.5 text-sm font-bold text-slate-800 shadow-sm hover:border-indigo-200"
        >
          Talk to sales
        </Link>
      </section>
    </div>
  );
}
