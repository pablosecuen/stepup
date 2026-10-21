"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { messageForUnsupported, PHOTO_MESSAGES, planPhotoPreview } from "@/lib/images/photo-preview";

type Phase = { state: "closed" } | { state: "working"; text: string } | { state: "ready"; url: string } | { state: "error"; text: string };

/** Trae los bytes del adjunto por el propio servidor de TeacherFlow (mismo origen, con la sesión). */
async function loadFromServer(id: string): Promise<Uint8Array> {
  const response = await fetch(`/api/archivos/adjunto/${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error("fetch");
  return new Uint8Array(await response.arrayBuffer());
}

/** Píxeles RGBA → imagen PNG temporal (sólo en el navegador de quien mira; el archivo guardado no se toca). */
async function rgbaToObjectUrl(photo: { width: number; height: number; rgba: Uint8ClampedArray }): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = photo.width;
  canvas.height = photo.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.putImageData(new ImageData(new Uint8ClampedArray(photo.rgba), photo.width, photo.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("canvas");
  return URL.createObjectURL(blob);
}

/**
 * Foto adjunta de una clase: «Ver foto» la muestra en la propia página. JPEG, PNG y WebP los muestra el navegador; una foto HEIC (la de las cámaras de iPhone) se
 * convierte ACÁ, en el navegador, y el decodificador se descarga sólo en ese momento. El archivo guardado nunca se modifica y «Descargar el original» siempre está.
 * `loadBytes` sólo se usa en pruebas (para no depender del servidor).
 */
export function LessonPhotoViewer({ id, name, loadBytes, downloadHref }: { id: string; name: string; loadBytes?: () => Promise<Uint8Array>; downloadHref?: string }) {
  const [phase, setPhase] = useState<Phase>({ state: "closed" });
  const currentUrl = useRef<string | null>(null);
  const run = useRef(0);

  const release = useCallback(() => {
    if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    currentUrl.current = null;
  }, []);
  useEffect(() => () => release(), [release]);

  const close = () => {
    run.current += 1;
    release();
    setPhase({ state: "closed" });
  };

  async function open() {
    const mine = (run.current += 1);
    release();
    setPhase({ state: "working", text: PHOTO_MESSAGES.loading });
    let bytes: Uint8Array;
    try {
      bytes = await (loadBytes ?? (() => loadFromServer(id)))();
    } catch {
      if (mine === run.current) setPhase({ state: "error", text: PHOTO_MESSAGES.fetchFailed });
      return;
    }
    if (mine !== run.current) return;
    const plan = planPhotoPreview(bytes);
    if (plan.mode === "unsupported") {
      setPhase({ state: "error", text: messageForUnsupported(plan.reason) });
      return;
    }
    try {
      let url: string;
      if (plan.mode === "native") {
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: plan.mime }));
      } else {
        setPhase({ state: "working", text: PHOTO_MESSAGES.preparing });
        const { decodeHeic } = await import("@/lib/images/heic-decode");
        url = await rgbaToObjectUrl(await decodeHeic(bytes));
      }
      if (mine !== run.current) {
        URL.revokeObjectURL(url);
        return;
      }
      currentUrl.current = url;
      setPhase({ state: "ready", url });
    } catch {
      if (mine === run.current) setPhase({ state: "error", text: PHOTO_MESSAGES.cannotShow });
    }
  }

  const href = downloadHref ?? `/api/archivos/adjunto/${encodeURIComponent(id)}?descargar=1`;
  const downloadLink = (
    <a href={href} download className={buttonClass({ variant: "secondary" })} aria-label={`Descargar el original de ${name}`}>
      Descargar el original
    </a>
  );

  return (
    <>
      {phase.state === "closed" ? (
        <Button variant="secondary" onClick={open} aria-label={`Ver la foto ${name}`}>
          Ver foto
        </Button>
      ) : (
        <Button variant="ghost" onClick={close} aria-label={`Cerrar la foto ${name}`}>
          Cerrar
        </Button>
      )}
      {phase.state !== "closed" && (
        <div className="basis-full space-y-2" data-testid="visor-foto">
          {phase.state === "working" && (
            <p role="status" className="text-[14px] text-textMuted">
              {phase.text}
            </p>
          )}
          {phase.state === "error" && (
            <div className="space-y-2">
              <p role="alert" className="text-[14px] text-bad">
                {phase.text}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={open}>
                  Reintentar
                </Button>
                {downloadLink}
              </div>
            </div>
          )}
          {phase.state === "ready" && (
            <div className="space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- imagen temporal (blob:) generada en el navegador; next/image no aplica */}
              <img
                src={phase.url}
                alt={`Foto ${name}`}
                className="max-h-[70vh] max-w-full rounded-md border border-borderMid object-contain"
                onError={() => setPhase({ state: "error", text: PHOTO_MESSAGES.cannotShow })}
              />
              <div>{downloadLink}</div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
