import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact Vivago Pass support or report a security issue.",
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
