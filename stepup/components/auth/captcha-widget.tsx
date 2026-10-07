"use client";

import Script from "next/script";
import { useEffect, useId, useRef, useState } from "react";
import { CAPTCHA_FIELD, CAPTCHA_ORIGIN, readCaptchaSiteKey } from "@/lib/auth/captcha";

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Widget de Cloudflare Turnstile (R3). Sin `NEXT_PUBLIC_TURNSTILE_SITE_KEY` válida NO renderiza nada y NO carga ningún script de
 * terceros: los formularios quedan exactamente como antes. Con la clave, agrega un campo oculto `cf-turnstile-response` al
 * formulario que lo contiene y se reinicia después de cada envío (el token es de un solo uso, aun si el servidor rechazó el envío).
 *
 * `onToken` es para los botones que no son un <form> (p. ej. "Cambiar contraseña"): recibe el token vigente.
 */
export function CaptchaWidget({ onToken }: { onToken?: (token: string) => void }) {
  // Acceso directo a `process.env.NEXT_PUBLIC_*`: es lo único que Next reemplaza en el build del cliente.
  const siteKey = readCaptchaSiteKey({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY });
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState("");
  const [scriptReady, setScriptReady] = useState(false);
  const label = useId();

  useEffect(() => {
    if (!siteKey || !scriptReady || !containerRef.current || !window.turnstile || widgetId.current) return;
    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      language: "es",
      theme: "auto",
      callback: (value: string) => {
        setToken(value);
        onToken?.(value);
      },
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
    });
    const form = containerRef.current.closest("form");
    const reset = () => {
      // Después del envío (FormData ya capturado): el token se consumió.
      window.setTimeout(() => {
        setToken("");
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
      }, 0);
    };
    form?.addEventListener("submit", reset);
    return () => {
      form?.removeEventListener("submit", reset);
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, scriptReady, onToken]);

  if (!siteKey) return null;
  return (
    <div className="flex flex-col gap-1" aria-labelledby={label}>
      <span id={label} className="sr-only">
        Verificación de seguridad
      </span>
      <Script src={`${CAPTCHA_ORIGIN}/turnstile/v0/api.js?render=explicit`} strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <div ref={containerRef} />
      <input type="hidden" name={CAPTCHA_FIELD} value={token} />
    </div>
  );
}
