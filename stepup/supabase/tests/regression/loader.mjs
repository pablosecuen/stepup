// Cargador de módulos para correr el código REAL de los repositorios de la web (TypeScript, alias «@/», «server-only») fuera de Next.js, en pruebas.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
