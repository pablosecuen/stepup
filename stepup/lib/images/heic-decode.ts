import { MAX_HEIC_PIXELS } from "./photo-preview.ts";

/**
 * Decodificación de una foto HEIC a píxeles RGBA, con `libheif` (LGPL-3.0, paquete `libheif-js`, versión con el WebAssembly incluido).
 *
 * - El decodificador se carga SÓLO al llamar a esta función (importación dinámica → fragmento aparte): quien nunca abre una foto HEIC no lo descarga.
 * - `libheif` aplica la rotación y el espejado de la propia foto (cajas `irot`/`imir`), así que la orientación sale correcta.
 * - No modifica el archivo original: trabaja sobre una copia en memoria.
 */

export interface DecodedPhoto {
  width: number;
  height: number;
  /** width × height × 4 bytes (RGBA). */
  rgba: Uint8ClampedArray;
}

export class HeicDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeicDecodeError";
  }
}

interface LibheifImage {
  get_width(): number;
  get_height(): number;
  display(target: { data: Uint8ClampedArray; width: number; height: number }, done: (result: unknown) => void): void;
  free?(): void;
}
interface Libheif {
  HeifDecoder: new () => { decode(data: Uint8Array): LibheifImage[] };
}

export async function decodeHeic(bytes: Uint8Array): Promise<DecodedPhoto> {
  const loaded = (await import("libheif-js/wasm-bundle.js")) as unknown as { default?: Libheif } & Partial<Libheif>;
  const libheif = (loaded.default ?? loaded) as Libheif;
  let images: LibheifImage[];
  try {
    images = new libheif.HeifDecoder().decode(bytes);
  } catch {
    throw new HeicDecodeError("El archivo no es una foto HEIC válida.");
  }
  const image = images?.[0];
  if (!image) throw new HeicDecodeError("El archivo no es una foto HEIC válida.");
  try {
    const width = image.get_width();
    const height = image.get_height();
    if (!(width > 0 && height > 0) || width * height > MAX_HEIC_PIXELS) throw new HeicDecodeError("La foto tiene un tamaño que no se puede mostrar.");
    const target = { data: new Uint8ClampedArray(width * height * 4), width, height };
    const done = await new Promise<unknown>((resolve) => image.display(target, resolve));
    if (!done) throw new HeicDecodeError("No se pudo decodificar la foto.");
    return { width, height, rgba: target.data };
  } finally {
    try {
      image.free?.();
    } catch {
      /* ya liberada */
    }
  }
}
