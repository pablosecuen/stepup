import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { getSupabaseClient } from '../account/lib/supabaseClient';
import type { RunnerDeps } from './phoneExtraction/runner';
import { supabaseDeps, toArrayBuffer } from './phoneExtraction/supabase-deps';

/**
 * Capacidades REALES del teléfono para la extracción (ver `phoneExtraction/runner.ts`, que es el mismo código que se prueba en Node con un teléfono simulado).
 * NO DESTRUCTIVO por construcción: acá sólo hay lecturas (claves de AsyncStorage y archivos) y la subida de COPIAS a la cuenta de la propia profesora; no existe
 * ninguna operación de borrar, mover ni escribir en el teléfono. La parte que habla con la cuenta (`supabase-deps.ts`) también se prueba contra un destino aislado.
 *
 * Usa la sesión que la app ya tiene para el respaldo en la nube (misma cuenta que la web): nunca pide ni guarda credenciales.
 */

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sólo lectura del teléfono (claves y archivos): lo único que necesita la revisión. No usa la cuenta ni la red. */
export function createPhoneReadDeps(): Pick<RunnerDeps, 'readKey' | 'fileInfo' | 'readBytes' | 'sha256Hex'> {
  return {
    readKey: (key) => AsyncStorage.getItem(key),
    fileInfo: async (uri) => {
      try {
        const file = new File(uri);
        return file.exists ? { exists: true, size: file.size } : { exists: false, size: null };
      } catch {
        return { exists: false, size: null };
      }
    },
    readBytes: async (uri) => new File(uri).bytes(),
    sha256Hex: async (bytes) => toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, toArrayBuffer(bytes))),
  };
}

export function createPhoneExtractionDeps(onProgress?: (done: number, total: number) => void): RunnerDeps | null {
  const client = getSupabaseClient();
  if (!client) return null;
  return {
    ...createPhoneReadDeps(),
    ...supabaseDeps(client),
    onProgress,
  };
}
