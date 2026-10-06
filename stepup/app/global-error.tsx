"use client";

import "./globals.css";

// Último recurso: sólo se usa si falla el propio layout raíz (reemplaza <html>/<body>). No depende de nada del resto de la app.
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;
  return (
    <html lang="es">
      <body className="min-h-screen bg-background text-textPrimary antialiased">
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-xl font-semibold">Algo salió mal</h1>
          <p className="text-sm text-textSecondary">No pudimos abrir TeacherFlow. Volvé a cargar la página.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-md bg-brandBlue px-5 text-sm font-semibold text-white shadow-card"
          >
            Volver a cargar
          </button>
        </main>
      </body>
    </html>
  );
}
