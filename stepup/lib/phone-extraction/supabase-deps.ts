/**
 * La parte de la extracción que habla con la cuenta (sesión, funciones de la base, almacenamiento, lectura de los reportes ya importados), con el cliente REAL de
 * Supabase. Es el MISMO código que corre en el teléfono (se copia al parche) y el que se prueba en Node contra un destino aislado (un servidor local con la forma de
 * Supabase delante de un Postgres real): así lo que depende de la librería (forma de los errores, subida sin pisar, nombres de parámetros) se prueba de verdad.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunnerDeps } from "./runner.ts";

/** Copia exacta de los bytes como ArrayBuffer propio (la subida desde React Native usa un ArrayBuffer, no una vista parcial de otro). */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function supabaseDeps(client: SupabaseClient): Pick<RunnerDeps, "ownerId" | "rpc" | "upload" | "listReports"> {
  return {
    ownerId: async () => {
      const { data } = await client.auth.getUser();
      return data.user?.id ?? "";
    },
    rpc: async (name, args) => {
      const { data, error } = await client.rpc(name, args);
      return { data, error: error ? { message: error.message } : null };
    },
    upload: async (bucket, path, bytes, contentType) => {
      // upsert apagado: nunca se pisa un archivo que ya está (un «ya existe» se reconoce y sólo se vuelve a registrar).
      const { error } = await client.storage.from(bucket).upload(path, toArrayBuffer(bytes), { contentType, upsert: false });
      if (!error) return { error: null };
      const statusCode = (error as { statusCode?: string | number }).statusCode;
      return { error: { message: error.message, statusCode } };
    },
    listReports: async () => {
      const { data, error } = await client.from("report_records").select("id, student_id, legacy_mobile_id");
      // Un error NO se convierte en «no hay reportes»: se propaga y la extracción se detiene en lugar de saltear los PDF.
      if (error) throw new Error("No se pudo leer la lista de reportes de la cuenta.");
      return ((data ?? []) as Array<{ id: string; student_id: string; legacy_mobile_id: string | null }>).flatMap((r) => (r.legacy_mobile_id ? [{ id: r.id, student_id: r.student_id, legacy_mobile_id: r.legacy_mobile_id }] : []));
    },
  };
}
