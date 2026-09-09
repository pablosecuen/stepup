import type { Metadata, Viewport } from "next";
import "./globals.css";

// TeacherFlow móvil no usa una fuente custom (ver src/theme/typography.ts:
// "Sin fuente custom por ahora... se apoya en la fuente de sistema") — la
// web reproduce la misma decisión, sin depender de una fuente externa.

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
  themeColor: "#080808",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="min-h-screen max-w-screen overflow-x-hidden bg-background text-textPrimary antialiased">
        {children}
      </body>
    </html>
  );
}
