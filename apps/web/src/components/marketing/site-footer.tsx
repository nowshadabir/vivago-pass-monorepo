import Image from "next/image";
import Link from "next/link";
import { Shield } from "lucide-react";

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/logo.jpg"
                alt=""
                width={32}
                height={32}
                className="rounded-lg"
              />
              <span className="font-bold text-slate-900">Vivago Pass</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-600">
              Zero-knowledge password and secrets manager. Your master password
              and vault data never touch our servers in plaintext.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Product
            </h3>
            <ul className="mt-3 space-y-2 text-sm font-medium text-slate-700">
              <li>
                <Link href="/pricing" className="hover:text-indigo-600">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/signup" className="hover:text-indigo-600">
                  Create account
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-indigo-600">
                  Sign in
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Company
            </h3>
            <ul className="mt-3 space-y-2 text-sm font-medium text-slate-700">
              <li>
                <Link href="/contact" className="hover:text-indigo-600">
                  Contact
                </Link>
              </li>
              <li>
                <a href="#security" className="hover:text-indigo-600">
                  Security model
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Cryptography
            </h3>
            <ul className="mt-3 space-y-2 font-mono text-xs text-slate-600">
              <li>PBKDF2-SHA256 · 600k</li>
              <li>AES-256-GCM</li>
              <li>RSA-OAEP 2048</li>
              <li>Web Crypto API</li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-200 pt-8 sm:flex-row">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} Vivago Pass. All rights reserved.
          </p>
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <Shield className="h-3.5 w-3.5 text-indigo-600" />
            Zero-knowledge by design — we cannot read your vault.
          </p>
        </div>
      </div>
    </footer>
  );
}
