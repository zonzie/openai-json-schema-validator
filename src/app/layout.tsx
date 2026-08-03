import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";

import { SITE_URL } from "@/lib/site";

import "./globals.css";

const displayFont = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const bodyFont = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const googleSiteVerification =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "OpenAI JSON Schema Validator for Structured Outputs",
  description:
    "Validate JSON Schemas for OpenAI Structured Outputs. Find exact required, additionalProperties, nesting, enum, and unsupported-keyword errors.",
  applicationName: "Schema Signal",
  keywords: [
    "openai json schema validator",
    "openai structured output validator",
    "invalid schema for response_format",
    "structured outputs",
    "json schema",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Schema Signal",
    title: "OpenAI JSON Schema Validator for Structured Outputs",
    description:
      "Path-specific diagnostics and reviewable strict-mode patches for the documented OpenAI Structured Outputs schema subset.",
  },
  twitter: {
    card: "summary",
    title: "OpenAI JSON Schema Validator",
    description:
      "Validate Structured Outputs schemas before the OpenAI API does.",
  },
  robots: {
    index: true,
    follow: true,
  },
  verification: googleSiteVerification
    ? { google: googleSiteVerification }
    : undefined,
};

export const viewport: Viewport = {
  themeColor: "#eee8dc",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <body>
        {children}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
