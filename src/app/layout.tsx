import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Bitcoin Paper Trader v2",
    description: "Autonomous AI Trading Bot",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body className="antialiased font-sans">
                {children}
                <Analytics />
            </body>
        </html>
    );
}
