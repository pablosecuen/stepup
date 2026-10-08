import type { MetadataRoute } from "next";

// PWA inicial (Fase A): manifest básico e instalable. Sin service worker ni
// caché offline todavía — a propósito, para no dejar versiones viejas
// bloqueadas en el navegador (se agrega en una fase posterior).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TeacherFlow",
    short_name: "TeacherFlow",
    description: "Gestión de alumnos, calendario y cobros para profesoras particulares.",
    start_url: "/",
    display: "standalone",
    background_color: "#1F1A14",
    theme_color: "#1F1A14",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
