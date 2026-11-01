import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Figtree, Instrument_Sans, Inter_Tight, JetBrains_Mono } from "next/font/google";
import LockGate from "@/components/LockGate";
import { SkinBackdrop } from "@/components/skin/Backdrop";
import StartScreen from "@/components/skin/StartScreen";
import { SKIN_BOOT_SCRIPT } from "@/lib/skin";
import "./globals.css";
import "./skins.css";

// Terminal: one mono face, every glyph the same width, numbers included.
const mono = JetBrains_Mono({
  variable: "--font-mono-jb",
  subsets: ["latin"],
  weight: ["400", "700", "800"],
});
// The other looks. Not preloaded: a face only downloads once text uses it.
// Instrument Sans (Cypher Capital) and Chakra Petch (Sibal) are the sites' own
// fonts; Figtree and Inter Tight stand in for Cyera's Haffer and Atmos's Neue
// Montreal, which are paid fonts.
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: ["400", "500", "600"], preload: false });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"], weight: ["400", "500"], preload: false });
const instrument = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"], weight: ["400", "500"], preload: false });
const chakra = Chakra_Petch({ variable: "--font-chakra", subsets: ["latin"], weight: ["400", "600", "700"], preload: false });

export const metadata: Metadata = {
  title: "networth(1) — my little networth",
  description: "Net worth across cash, bank, stocks and crypto, live.",
};

export const viewport: Viewport = {
  themeColor: "#050505",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The boot script sets data-skin on <html> before React hydrates.
    <html lang="en" className={`${mono.variable} ${figtree.variable} ${interTight.variable} ${instrument.variable} ${chakra.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SKIN_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <StartScreen />
        <LockGate />
        <SkinBackdrop />
        {children}
      </body>
    </html>
  );
}
