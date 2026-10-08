import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { SkipLink } from "@/components/ui/skip-link";

// Rediseño visual v1 (docs/design/web-v1/01-fundamentos.md): Hanken Grotesk para la interfaz y Fraunces para títulos, cifras
// grandes y nombres. `next/font` las autoaloja (sin pedidos a Google al navegar; CSP `font-src 'self'`) y reserva el espacio
// con una fuente de reemplazo ajustada, así no hay saltos de diseño. Ambas son variables: no hace falta elegir pesos.
const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display", display: "swap", axes: ["opsz"] });

export const metadata: Metadata = {
  title: "TeacherFlow",
  description: "TeacherFlow — gestión de alumnos, calendario y cobros para profesoras particulares.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TeacherFlow",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1F1A14",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen max-w-screen overflow-x-hidden bg-background font-sans text-textPrimary antialiased">
        <SkipLink />
        {children}
      </body>
    </html>
  );
}
