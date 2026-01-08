import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Task Thrower",
  description: "Throw tasks forward with one tap",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="antialiased bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
