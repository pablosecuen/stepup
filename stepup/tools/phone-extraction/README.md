# Extracción de archivos del teléfono (traslado Expo Go → web)

Qué es: una pantalla temporal para la app que **copia a la cuenta** los adjuntos de clases, los materiales y los PDF de reportes que viven sólo en el teléfono. **No borra, no mueve y no modifica nada** del teléfono. Ver `docs/TRASLADO_EXPO_GO_A_WEB.md` §5.

## Contenido

- `mobile-patch/src/features/transfer/PhoneTransferEntry.tsx` — botón «Traslado a la web» + pantalla (siempre renderiza su `<Modal>`; muestra sólo cantidades).
- `mobile-patch/src/features/transfer/phoneExtractionDeps.ts` — las capacidades reales del teléfono (lectura de claves y archivos, SHA-256, subida de copias).
- `mobile-patch/src/features/transfer/phoneExtraction/{plan,runner}.ts` — **generados** por `node tools/phone-extraction/build-mobile-patch.mjs` a partir de `lib/phone-extraction` (el mismo código que se prueba en Node con un teléfono simulado).

## Cómo aplicarlo (requiere autorización: la carpeta de la app es de sólo lectura para esta tarea)

1. Copiar `mobile-patch/src/features/transfer/` a `src/features/transfer/` de la app (carpeta nueva: no pisa nada).
2. Aplicar `tools/phone-extraction/BackupScreen.cambio.diff` a `src/features/backup/BackupScreen.tsx` (exactamente dos líneas agregadas: el import y `<PhoneTransferEntry />` al final del `ScrollView`). Antes, guardar una copia del archivo original.
3. `npm.cmd run typecheck` en la app (ya se comprobó contra una copia temporal: sin errores).
4. Recargar Expo Go.

## Cómo se usa en el teléfono

*Protección de datos* → *Traslado a la web* → **0. Revisar sin copiar** (sólo lectura; es lo único que ofrece la pantalla mientras `COPY_ENABLED = false`) → **1. Probar con un solo archivo** (elige primero una foto declarada HEIC) (esperar el resultado) → **2. Copiar todo** (dejar la app abierta hasta «Copia completa»). Requisito para 1 y 2: las migraciones del traslado aplicadas y la importación ya confirmada en la web, y `COPY_ENABLED = true` en `PhoneTransferEntry.tsx`. Cada copia se sube con su formato REAL (por los primeros bytes), no con el que declaraba la app. Se puede repetir: lo que ya se copió no se vuelve a copiar.

## Cómo se retira

Quitar la línea de `BackupScreen.tsx` y la carpeta `src/features/transfer/`. Los archivos ya copiados quedan en la cuenta (no hace falta borrarlos).
