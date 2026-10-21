/**
 * Sube UN archivo a la URL firmada que preparó el servidor (almacenamiento privado de la cuenta). Corre en el navegador: el archivo viaja directo al almacenamiento, sin pasar por las funciones del servidor
 * (que tienen un tope de 4,5 MB por pedido). La URL ya autoriza ESE único objeto, por eso no hace falta ninguna credencial de la persona; sólo se manda la clave pública del proyecto.
 *
 * Replica el pedido que hace `@supabase/storage-js` (`uploadToSignedUrl`): `PUT` con un formulario `cacheControl` + el archivo, sin sobrescribir (`x-upsert: false`).
 */
export interface SignedUploadOptions {
  signedUrl: string;
  file: Blob;
  mimeType: string;
  /** Avance de 0 a 1. */
  onProgress?: (fraction: number) => void;
  /** Sólo pruebas: reemplaza el constructor de pedidos. */
  createRequest?: () => XMLHttpRequest;
  publishableKey?: string;
}

export class SignedUploadError extends Error {
  readonly status: number;
  constructor(status: number) {
    super("No se pudo subir el archivo.");
    this.name = "SignedUploadError";
    this.status = status;
  }
}

export function uploadToSignedUrl({ signedUrl, file, mimeType, onProgress, createRequest, publishableKey }: SignedUploadOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = (createRequest ?? (() => new XMLHttpRequest()))();
    const body = new FormData();
    body.append("cacheControl", "3600");
    // El tipo del archivo se fija acá (el navegador lo deja vacío para algunas fotos HEIC): el almacenamiento lo valida contra los tipos permitidos.
    body.append("", new Blob([file], { type: mimeType }));
    request.open("PUT", signedUrl);
    request.setRequestHeader("x-upsert", "false");
    const key = publishableKey ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (key) request.setRequestHeader("apikey", key);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => (request.status >= 200 && request.status < 300 ? resolve() : reject(new SignedUploadError(request.status)));
    request.onerror = () => reject(new TypeError("Failed to fetch"));
    request.onabort = () => reject(new TypeError("Failed to fetch"));
    request.send(body);
  });
}
