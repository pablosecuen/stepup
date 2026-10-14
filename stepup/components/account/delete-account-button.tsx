"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteOwnAccountAction } from "@/lib/actions/account";
import { guardNetwork } from "@/lib/actions/network-guard";
import { FormErrorBox } from "@/components/auth/form-boxes";
import { CaptchaWidget } from "@/components/auth/captcha-widget";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

const CONFIRM_WORD = "ELIMINAR";

/**
 * Puerto de `confirmDeleteAccount()` (móvil, `AccountConnectedScreen.tsx`):
 * ahí un `Alert.alert` nativo basta como confirmación fuerte; la web no
 * tiene ese diálogo nativo, así que exige escribir la palabra "ELIMINAR"
 * para habilitar el botón — confirmación al menos igual de difícil de
 * disparar por accidente. Texto adaptado a la realidad de la web (a
 * diferencia del móvil, acá NO hay una copia local que sobreviva: todos los
 * datos viven en el servidor y se borran con la cuenta).
 *
 * R4: además de la palabra, pide la CONTRASEÑA (reautenticación): una sesión abierta u olvidada no alcanza para una acción
 * irreversible. La contraseña y la palabra se vuelven a validar en el servidor; nunca se guardan ni se muestran de nuevo.
 *
 * Teclado: la confirmación es un diálogo (hoja inferior en móvil) con el foco atrapado; entra al primer campo, Escape o
 * «Cancelar» lo cierran y el foco vuelve al botón «Eliminar cuenta».
 */
export function DeleteAccountButton({ billingEnabled = false }: { billingEnabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // CAPTCHA (R3, desactivado salvo que haya clave de sitio): la verificación de contraseña pasa por Supabase Auth, que lo pide si está activo.
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(undefined);
  const [captchaAttempt, setCaptchaAttempt] = useState(0);

  // El foco entra al primer campo (el diálogo ya lo atrapa). Se difiere un cuadro: el propio diálogo enfoca su contenedor al montarse
  // (y en desarrollo vuelve a hacerlo al re-ejecutar sus efectos), y el primer campo tiene que quedarse con el foco.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => document.getElementById("delete-confirm")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function cancel() {
    setOpen(false);
    setConfirmText("");
    setPassword("");
    setError(null);
  }

  const canConfirm = confirmText.trim() === CONFIRM_WORD && password.length > 0;

  return (
    <>
      <Button variant="dangerOutline" onClick={() => setOpen(true)} className="self-start" aria-haspopup="dialog">
        Eliminar cuenta
      </Button>

      {open && (
        <Dialog
          title="Eliminar cuenta"
          size="sm"
          onClose={cancel}
          busy={pending}
          footer={
            <>
              <Button variant="secondary" onClick={cancel}>
                Cancelar
              </Button>
              <Button
                variant="danger"
                disabled={!canConfirm}
                busy={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    const result = await guardNetwork(() => deleteOwnAccountAction({ password, confirmation: confirmText, captchaToken }));
                    // El token del CAPTCHA es de un solo uso, y la contraseña no queda en pantalla tras un intento fallido.
                    setCaptchaToken(undefined);
                    setCaptchaAttempt((n) => n + 1);
                    if (result?.error) {
                      setPassword("");
                      setError(result.error);
                    }
                  })
                }
              >
                {pending ? "Eliminando..." : "Eliminar definitivamente"}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3.5">
            <Notice tone="bad" role="status">
              <span id="delete-warning">
                Se va a eliminar tu cuenta y TODOS tus datos (alumnos, clases, pagos, reportes y sus archivos PDF) de forma permanente — esta
                acción no se puede deshacer.
              </span>
            </Notice>
            {billingEnabled && (
              <Notice tone="info" role="status">
                Si tenés una suscripción, la cancelamos primero en el servicio de cobro y confirmamos que no se te vuelva a cobrar; recién después se borran tus datos. De tus pagos sólo se conserva, por obligación fiscal, un registro mínimo y seudonimizado (referencia, fecha, importe y estado): sin tus datos personales, alumnos ni tarjeta.
              </Notice>
            )}
            <Field label={<>Escribí <span className="font-bold">{CONFIRM_WORD}</span> para confirmar</>} htmlFor="delete-confirm">
              <TextInput
                id="delete-confirm"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Tu contraseña" htmlFor="delete-password">
              <TextInput id="delete-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <CaptchaWidget key={captchaAttempt} onToken={setCaptchaToken} />
            {error && <FormErrorBox message={error} />}
          </div>
        </Dialog>
      )}
    </>
  );
}
