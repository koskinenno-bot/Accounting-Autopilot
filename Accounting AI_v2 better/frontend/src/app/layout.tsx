import type { Metadata } from "next";
import "./globals.css";
import { CompanyProvider } from "@/context/CompanyContext";
import { LanguageProvider } from "@/context/LanguageContext";

export const metadata: Metadata = {
  title: "Accounting Autopilot",
  description: "Automated bookkeeping for Finnish housing companies",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <CompanyProvider>
          <LanguageProvider>
            {children}
          </LanguageProvider>
        </CompanyProvider>
      </body>
    </html>
  );
}
