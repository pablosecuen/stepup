# Preparación pública para Rebill — 4/11/2026

## Confirmado por el titular

- Matías Ezequiel Metrailler, CUIT 20-39093458-1.
- Mantener los cuatro precios del catálogo: $24.900 mensual, $69.900 trimestral, $133.900 semestral y $249.000 anual.
- Destacar el ahorro solamente en el anual. Se usa «12 meses por el precio de 10», ahorro $49.800 respecto de doce pagos mensuales ($298.800); reemplaza el anuncio incoherente de 15 %.
- Precio completo y período visibles. Referencia diaria secundaria: 30 días por mes y 365 por año. Nunca modifica el total del checkout.

## Páginas públicas preparadas para publicación

- `/planes`, pública, selector de los cuatro períodos y mismos precios que el catálogo servidor.
- `/terminos-y-condiciones`, `/politica-de-privacidad` y `/contacto`, con plantilla común, identificación del titular y enlaces en el pie.
- Correo y domicilio en una única configuración, `lib/business/public-profile.ts`. Las páginas legales y sus enlaces quedan habilitados con el contacto corregido. La bandera de revisión de la integración de pagos no se cambia.
- Las páginas dicen que la contratación está en preparación. No se incorpora un checkout ficticio ni se activa la integración anterior de Mobbex.

## Contacto corregido

La captura aportada por el titular confirma `techflowapk@gmail.com`, sin la «a» de la primera transcripción. Se utiliza el domicilio declarado en el alta de Rebill: Pellegrini 3603, Rosario, Santa Fe, Argentina. `contactConfirmed` queda `true`.

## Documentación y activación externas

- Comprobante de domicilio a nombre del titular con antigüedad no mayor a tres meses, conforme al pedido de Rebill.
- Constancia de CVU con nombre del titular y CUIT.
- Enviar comprobantes y enlaces publicados como respuesta al hilo original y solicitar continuar la revisión, cuyo plazo original venció el 28/10/2026.
- Completar aprobación de Rebill e integración/ensayo de suscripciones, avisos de pago, cancelación, reintentos y conciliación antes de habilitar cobros reales. La implementación previa es para Mobbex y no se considera una integración Rebill.

## Referencias utilizadas para preparar los textos

- Información clara y condiciones de contratación: https://www.argentina.gob.ar/normativa/nacional/ley-24240-638/actualizacion
- Derechos sobre datos personales: https://www.argentina.gob.ar/aaip/datospersonales/derechos
- Protección de datos: https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion
- Baja y arrepentimiento: https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-3-2026-423007/texto

Los textos preparados no constituyen una certificación de cumplimiento ni de aprobación de Rebill. La página Contacto utiliza enlaces de correo; tocar uno no se presenta como una baja o devolución ejecutada.
