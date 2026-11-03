import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Krevia POS - Furniture & Internal Credit Management",
  description: "Multi-tenant POS & Self-Managed Installment Financing for Furniture Retail",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
