import type { Metadata } from "next";
import { Fraunces, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { HouseholdProvider } from "@/lib/household-context";
import { AccountsProvider } from "@/lib/accounts-context";
import { ThemeProvider } from "@/lib/theme-context";
import Header from "@/components/Header";
import ToastProvider from "@/components/ToastProvider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Subscription Tracker",
  description: "Track and manage your subscriptions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} antialiased bg-paper text-ink`}
      >
        <ThemeProvider>
          <AuthProvider>
            <HouseholdProvider>
              <AccountsProvider>
                <div className="min-h-screen md:flex">
                  <Header />
                  <main className="min-w-0 flex-1">{children}</main>
                </div>
              </AccountsProvider>
            </HouseholdProvider>
          </AuthProvider>
          <ToastProvider />
        </ThemeProvider>
      </body>
    </html>
  );
}
