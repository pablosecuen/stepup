# Textos de la suscripción — para revisión (25/11/2026)

## Por qué seguían apareciendo «[A DEFINIR]»

Había **dos fuentes** que nunca se conectaron:

| Fuente | Fecha | Contenido |
|---|---|---|
| `lib/billing/legal.ts` («Condiciones de la suscripción», dentro de Facturación) | 14/10/2026 (M3) | Se escribió antes de tener los datos del titular y dejó «[A DEFINIR: razón social, CUIT y domicilio]», «[A DEFINIR: aviso previo ante un cambio de precio]» y «[A DEFINIR: plazo… devolución]». El correo de soporte se pedía por una variable aparte (`BILLING_SUPPORT_EMAIL`) |
| `lib/business/public-profile.ts` + Términos, Privacidad, Contacto | 04/11/2026 | Se cargaron el titular (Matías Ezequiel Metrailler, CUIT 20-39093458-1, Pellegrini 3603, Rosario, Santa Fe) y `techflowapk@gmail.com`. Facturación nunca los leyó |

Resultado: la página pública decía una cosa y la de Facturación dejaba huecos (y dos redacciones distintas de baja/devoluciones).

## Qué se unificó

- `lib/business/public-profile.ts` es la **única** fuente de identidad y de contacto. Facturación (`legal.ts`) y el soporte (`support.ts`) la usan; `BILLING_SUPPORT_EMAIL` quedó como reemplazo **opcional**.
- `lib/business/subscription-terms.ts` guarda **una sola vez** lo que se repite: aviso ante cambio de precio, cómo se pide baja/arrepentimiento/devolución, y el estado de la contratación («en preparación» / habilitada, según el piloto). Los Términos y las Condiciones de Facturación lo importan.
- Los marcadores «[A DEFINIR]» **ya no están dentro del texto que lee la persona**: lo que sigue sin decidirse figura en `LEGAL_PENDING` (para quien revisa) y abajo. El aviso «Texto en revisión» sigue visible mientras `BILLING_LEGAL_REVIEWED` no sea `true`, y ese indicador **no se enciende** hasta que exista una revisión real.

## Decisiones/confirmaciones que necesita quien revisa (no se inventaron)

1. **Revisión legal** de las Condiciones, los Términos y la Privacidad. Consultar a la asesoría si corresponde el **botón de arrepentimiento** y el plazo de 10 días para contrataciones a distancia (Ley 24.240 art. 34 y Res. 424/2020 de la Secretaría de Comercio Interior — a confirmar, no se afirma en los textos).
2. **Devoluciones:** hoy el texto dice que se pueden solicitar por correo, que se aplican «conforme a la legislación y a las circunstancias» y que **no hay devoluciones automáticas**. No define plazo propio ni promete reembolso. Falta decidir la política comercial y su alcance respecto de las comisiones del servicio de cobro (Rebill no documenta su reintegro en una devolución normal).
3. **Aviso previo ante un cambio de precio:** hoy «se informará su alcance y la fecha de entrada en vigencia… con posibilidad de solicitar la baja antes del siguiente cobro». Falta, si se quiere, un plazo en días.
4. **Titular:** hoy una persona humana (CUIT 20-…). Confirmar que es quien debe figurar como responsable, o cargar una razón social si cambia.
5. **Cambio de plan:** el texto dice que por ahora no se ofrece desde la cuenta (sigue apagado hasta validarlo en sandbox).
6. **Cuenta nueva sin período de prueba:** al activar el control de acceso, una cuenta nueva queda en modo limitado hasta pagar. Decidir si habrá algún período gratuito (hoy los textos dicen «sin período de prueba»).

## Textos vigentes de renovación, cancelación y devoluciones (para leer juntos)

Ver `lib/billing/legal.ts` (secciones «Renovación automática», «Cancelación», «Si un cobro es rechazado», «Devoluciones y disputas») y `lib/business/subscription-terms.ts`. Se muestran en `/facturacion/condiciones` y, los compartidos, en `/terminos-y-condiciones`.
