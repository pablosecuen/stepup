import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "./components/navbar";
import Script from "next/script";
import Footer from "./components/footer/footer";
import { CartProvider } from "./providers/CartContextProvider";
import { Toaster } from "sonner";

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
      <body className={`${inter.className} max-w-screen overflow-x-hidden`}>
        <Toaster position="top-center" closeButton={true} />
        <CartProvider>
          <Navbar />
          {children}
        </CartProvider>
        <Footer />
        <Script src="../path/to/flowbite/dist/flowbite.min.js"></Script>
      </body>
    </html>
  );
}
