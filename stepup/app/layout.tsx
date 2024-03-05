import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "./components/navbar";
import Script from "next/script";
import Footer from "./components/footer/footer";
import { Toaster } from "sonner";
import MainProvider from "./App";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Step Up",
  description: "Sneaker freaks",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <link rel="icon" href="/favicon.ico" />
      <body className={`${inter.className} max-w-screen overflow-x-hidden`}>
        <MainProvider>
          <Toaster position="top-center" closeButton={true} />
          <Navbar />
          {children}
          <Footer />
        </MainProvider>
        <Script src="../path/to/flowbite/dist/flowbite.min.js"></Script>
      </body>
    </html>
  );
}
