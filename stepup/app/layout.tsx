import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";
import "./globals.css";
import "./natural-theme.css";
import { SkipLink } from "@/components/ui/skip-link";
import { NumberWheelGuard } from "@/components/ui/number-wheel-guard";
import { STREAMING_REVEAL_SCRIPT } from "@/lib/ui/streaming-reveal-script";

// Rediseño visual v1 (docs/design/web-v1/01-fundamentos.md): DM Sans para la interfaz y DM Serif Display para títulos, cifras
// grandes y nombres. `next/font` las autoaloja (sin pedidos a Google al navegar; CSP `font-src 'self'`) y reserva el espacio
// con una fuente de reemplazo ajustada, así no hay saltos de diseño. La serifa conserva su peso real de 400.
const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = DM_Serif_Display({ subsets: ["latin"], variable: "--font-display", display: "swap", weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "TeacherFlow",
  description: "TeacherFlow es la plataforma web para profesoras y profesores independientes: alumnos, clases y series, registro de clases y cobros en un solo lugar.",
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
  themeColor: "#583B1F",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${sans.variable} ${display.variable}`}>
      <head>
        {/* El contenido que llega por streaming reemplaza a su esqueleto aunque la pestaña esté en segundo plano (ver el comentario del módulo). */}
        <script dangerouslySetInnerHTML={{ __html: STREAMING_REVEAL_SCRIPT }} />
      </head>
      <body className="min-h-screen max-w-screen overflow-x-hidden bg-background font-sans text-textPrimary antialiased">
        <SkipLink />
        {children}
        <NumberWheelGuard />
      </body>
    </html>
  );
}
