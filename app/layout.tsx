import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist_Mono, Outfit } from "next/font/google";
import "./globals.css";

// Outfit for body copy, Bricolage Grotesque for headings (both from Google Fonts, self-hosted by Next)
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"] });

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "National Safety Week 2027 — MCCIA Proforma Invoices",
    template: "%s · MCCIA Safety Week 2027",
  },
  description:
    "Proforma Invoice system for MCCIA National Safety Week 2027 safety-awareness material sales.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${bricolage.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
