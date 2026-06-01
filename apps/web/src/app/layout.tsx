import type { Metadata } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import { ViewTransition } from "react";
import "./globals.css";
import { ToastProvider } from "../context/toast-context";
import { CommandPaletteProvider } from "../context/command-palette-context";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vivago Pass",
  description: "Zero-knowledge password and secrets manager",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${robotoMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col overflow-x-hidden" suppressHydrationWarning>
        <ToastProvider>
          <CommandPaletteProvider>
            <ViewTransition>
              {children}
            </ViewTransition>
          </CommandPaletteProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

