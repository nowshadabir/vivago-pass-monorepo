"use client";

import Link from "next/link";
import { useState } from "react";
import { Mail, MessageSquare, Shield, Send } from "lucide-react";

const TOPICS = [
  "General inquiry",
  "Billing & plans",
  "Security disclosure",
  "Bug report",
  "Feature request",
];

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = e.currentTarget;
    const data = new FormData(form);
    const subject = encodeURIComponent(
      `[Vivago Pass] ${data.get("topic") as string}`
    );
    const body = encodeURIComponent(
      `Name: ${data.get("name")}\nEmail: ${data.get("email")}\n\n${data.get("message")}`
    );
    window.location.href = `mailto:support@vivago.pass?subject=${subject}&body=${body}`;
    setSubmitted(true);
    setLoading(false);
  }

  return (
    <div className="pb-20">
      <section className="border-b border-slate-200/80 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Get in touch
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
            Questions about zero-knowledge security, billing, or the product roadmap —
            we are here to help. For vulnerabilities, use the security channel below.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 lg:grid-cols-5 lg:px-6">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Mail className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-bold text-slate-900">Support</h2>
            <p className="mt-2 text-sm text-slate-600">
              Account help, billing, and product questions.
            </p>
            <a
              href="mailto:support@vivago.pass"
              className="mt-3 inline-block text-sm font-semibold text-indigo-600 hover:underline"
            >
              support@vivago.pass
            </a>
          </div>

          <div className="rounded-2xl border border-amber-200/80 bg-amber-50/50 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <Shield className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-bold text-slate-900">Security reports</h2>
            <p className="mt-2 text-sm text-slate-600">
              Responsible disclosure for cryptographic or authentication issues.
              Please do not include live passwords or vault exports.
            </p>
            <a
              href="mailto:security@vivago.pass"
              className="mt-3 inline-block text-sm font-semibold text-amber-900 hover:underline"
            >
              security@vivago.pass
            </a>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm">
              <MessageSquare className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-bold text-slate-900">Before you write</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>We cannot reset your master password — only backup codes or passkeys can recover access.</li>
              <li>We cannot decrypt your vault on your behalf.</li>
              <li>
                See our{" "}
                <Link href="/#security" className="font-semibold text-indigo-600 hover:underline">
                  security model
                </Link>{" "}
                on the homepage.
              </li>
            </ul>
          </div>
        </div>

        <div className="lg:col-span-3">
          {submitted ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-10 text-center">
              <h2 className="text-xl font-bold text-emerald-900">Opening your mail app…</h2>
              <p className="mt-2 text-sm text-emerald-800">
                If nothing opened, email us directly at{" "}
                <a href="mailto:support@vivago.pass" className="font-semibold underline">
                  support@vivago.pass
                </a>
                .
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="mt-6 text-sm font-semibold text-emerald-700 hover:underline"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"
            >
              <h2 className="text-lg font-bold text-slate-900">Send a message</h2>
              <p className="mt-1 text-sm text-slate-500">
                Fields marked with * are required.
              </p>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="block sm:col-span-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Name *
                  </span>
                  <input
                    name="name"
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none ring-indigo-500/0 transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Your name"
                  />
                </label>
                <label className="block sm:col-span-1">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Email *
                  </span>
                  <input
                    name="email"
                    type="email"
                    required
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="you@example.com"
                  />
                </label>
              </div>

              <label className="mt-5 block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Topic *
                </span>
                <select
                  name="topic"
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                >
                  {TOPICS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mt-5 block">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Message *
                </span>
                <textarea
                  name="message"
                  required
                  rows={5}
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  placeholder="How can we help?"
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white shadow-md shadow-indigo-600/25 transition hover:bg-indigo-700 disabled:opacity-60 sm:w-auto sm:px-8"
              >
                <Send className="h-4 w-4" />
                {loading ? "Opening mail…" : "Send message"}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
