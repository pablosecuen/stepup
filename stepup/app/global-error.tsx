"use client";

import "./globals.css";

// Último recurso: sólo se usa si falla el propio layout raíz (reemplaza <html>/<body>). No depende de nada del resto de la app
// (ni de las fuentes de `next/font`, que viven en ese layout: acá se usa la fuente del sistema).
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-textPrimary antialiased">
        <main id="contenido" tabIndex={-1} className="focus:outline-none mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="font-serif text-[26px] font-medium">Algo salió mal</h1>
          <p className="text-[15px] text-textSecondary">No pudimos abrir TeacherFlow. Volvé a cargar la página.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-md border-[1.5px] border-ink bg-ink px-5 text-[14.5px] font-semibold text-background shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            Volver a cargar
          </button>
        </main>
      </body>
    </html>
  );
}
