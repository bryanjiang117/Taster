import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taster",
  description: "Determine a dish's authentic taste profile from native-language recipes.",
  openGraph: {
    title: "Taster",
    description: "Determine a dish's authentic taste profile from native-language recipes.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Taster",
    description: "Determine a dish's authentic taste profile from native-language recipes.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
