"use client";

import { useState } from "react";

/**
 * Miniatura de una foto adjunta (selección de evidencias del reporte y filas de fotos de la clase). La hace el servidor (`?miniatura=1`, también para HEIC) y sólo se pide cuando
 * la fila entra en pantalla (`loading="lazy"`). Si no se puede generar, queda un marcador con texto: la foto igual se puede elegir por su nombre y fecha.
 */
export function LessonPhotoThumbnail({ id, name, sizePx = 56 }: { id: string; name: string; sizePx?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: sizePx, height: sizePx };
  if (failed) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-md border border-borderMid bg-surface2 px-1 text-center text-[10px] font-semibold leading-tight text-textMuted" style={box} data-testid="miniatura-no-disponible">
        Sin vista previa
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- miniatura privada de la sesión (ruta propia, sin caché compartida); next/image no aplica
    <img
      src={`/api/archivos/adjunto/${encodeURIComponent(id)}?miniatura=1`}
      alt={`Miniatura de ${name}`}
      width={sizePx}
      height={sizePx}
      loading="lazy"
      decoding="async"
      className="shrink-0 rounded-md border border-borderMid bg-surface2 object-cover"
      style={box}
      onError={() => setFailed(true)}
      data-testid="miniatura"
    />
  );
}
