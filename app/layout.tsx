import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taster",
  description: "Estimate a dish's taste profile from native-language recipes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
