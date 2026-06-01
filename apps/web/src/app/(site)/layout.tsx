import type { Metadata } from "next";
import SiteLayout from "@/components/marketing/site-layout";

export const metadata: Metadata = {
  title: {
    default: "Vivago Pass — Zero-Knowledge Password Manager",
    template: "%s · Vivago Pass",
  },
  description:
    "Vivago Pass encrypts your passwords and secrets on your device before they ever reach our servers. AES-256-GCM, PBKDF2, passkeys, and end-to-end sharing.",
};

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SiteLayout>{children}</SiteLayout>;
}
