/**
 * Medidas de las fotos de evidencia en el PDF. La app anterior las recortaba a un cuadrado de 140 px (`object-fit: cover`), lo que corta bordes, texto y ejercicios de una foto de cuaderno o
 * de pizarrón; acá cada foto se ve COMPLETA: se ajusta a una caja (`EVIDENCE_BOX`, dos por fila) respetando su proporción, vertical u horizontal. PURO.
 */
export const EVIDENCE_BOX = { width: 250, height: 330 } as const;

/** Ancho y alto de un JPEG leyendo su marcador SOF (sin decodificarlo). `null` si no se puede leer. */
export function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Marcadores sin longitud.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      const height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      const width = (bytes[offset + 7] << 8) | bytes[offset + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** Tamaño de la imagen dentro de la caja: la mayor que entra entera, con su proporción. Sin dimensiones legibles, un cuadrado dentro de la caja (`contain`). */
export function fitEvidenceSize(dimensions: { width: number; height: number } | null, box: { width: number; height: number } = EVIDENCE_BOX): { width: number; height: number } {
  if (!dimensions) {
    const side = Math.min(box.width, box.height);
    return { width: side, height: side };
  }
  const scale = Math.min(box.width / dimensions.width, box.height / dimensions.height);
  return { width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) };
}

/** Estilo de la imagen en el PDF: completa, sin recorte. */
export function fitEvidenceImage(jpeg: Uint8Array): { width: number; height: number; objectFit: "contain"; borderRadius: number } {
  return { ...fitEvidenceSize(jpegDimensions(jpeg)), objectFit: "contain", borderRadius: 4 };
}
