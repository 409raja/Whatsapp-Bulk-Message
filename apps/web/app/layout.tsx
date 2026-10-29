import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "WhatsApp Bulk Message | Business Messaging",
  description: "Professional WhatsApp business messaging platform",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
