"use client";

import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextArea, TextInput } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { guardNetwork } from "@/lib/actions/network-guard";
import { domainErrorMessage } from "@/lib/errors/domain-error-message";
import { addMaterialAction, prepareAttachmentUploadAction, prepareMaterialUploadAction, registerAttachmentAction, removeAttachmentAction, setAttachmentCaptionAction } from "@/lib/actions/lesson-files";
import { checkPickedFile, cleanFileName, MAX_CAPTION_LENGTH, type AttachmentKind } from "@/lib/lessons/attachments";
import { SignedUploadError, uploadToSignedUrl } from "@/lib/lessons/signed-upload";
import type { LessonContentAttachment, LibraryMaterial } from "@/lib/repositories/lesson-content-mapping";
import { availabilityLabel } from "@/lib/repositories/lesson-content-mapping";
import { LessonPhotoViewer } from "./lesson-photo-viewer";
import { OpenLessonFileButton } from "./open-lesson-file-button";

const LABEL = "text-sm font-semibold text-textSecondary";

function uploadErrorMessage(error: unknown): string {
  if (error instanceof SignedUploadError) return error.status === 413 ? "El archivo es demasiado grande." : "No se pudo subir el archivo. Probá de nuevo.";
  // Una falla de red (el pedido no llegó a destino) se explica con el texto de red de siempre.
  if (error instanceof TypeError) return domainErrorMessage(error);
  return "No se pudo subir el archivo. Probá de nuevo.";
}

type Phase = { text: string } | null;

function AttachmentRow({ attachment, onChange, onRemoved }: { attachment: LessonContentAttachment; onChange: (a: LessonContentAttachment) => void; onRemoved: (id: string) => void }) {
  const id = useId();
  const [caption, setCaption] = useState(attachment.caption ?? "");
  const [savedCaption, setSavedCaption] = useState(attachment.caption ?? "");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveCaption() {
    if (caption.trim() === savedCaption.trim()) return;
    setError(null);
    const result = await guardNetwork(() => setAttachmentCaptionAction(attachment.id, caption));
    if (result.error) {
      setError(result.error);
      return;
    }
    setSavedCaption(caption.trim());
    onChange({ ...attachment, caption: caption.trim() || null });
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const result = await guardNetwork(() => removeAttachmentAction(attachment.id));
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onRemoved(attachment.id);
  }

  return (
    <li className="min-w-0 space-y-2 rounded-md border-[1.5px] border-border bg-surface2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere]">
          {attachment.name} <span className="text-[13px] font-normal text-textMuted">· {attachment.kind === "image" ? "Foto" : "PDF"}</span>
          {attachment.availability !== "disponible" && <span className="block text-[13px] font-normal text-textMuted">{availabilityLabel(attachment.availability)}</span>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {attachment.availability === "disponible" && (attachment.kind === "image" ? <LessonPhotoViewer id={attachment.id} name={attachment.name} /> : <OpenLessonFileButton kind="attachment" id={attachment.id} label={`Abrir el archivo ${attachment.name}`} />)}
          {!confirming && (
            <Button variant="ghost" onClick={() => setConfirming(true)} aria-label={`Quitar ${attachment.kind === "image" ? "la foto" : "el archivo"} ${attachment.name}`}>
              Quitar
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <div role="group" aria-label="Confirmar quitar" className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-textSecondary">¿Quitarlo de la clase? El archivo queda guardado en tu cuenta.</span>
          <Button variant="danger" busy={busy} onClick={remove}>
            Sí, quitar
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>
            No
          </Button>
        </div>
      )}
      <Field label="Descripción (opcional)" htmlFor={`${id}-caption`}>
        <TextInput id={`${id}-caption`} value={caption} maxLength={MAX_CAPTION_LENGTH} onChange={(e) => setCaption(e.target.value)} onBlur={saveCaption} />
      </Field>
      {error && (
        <p role="alert" className="text-[13px] text-bad">
          {error}
        </p>
      )}
    </li>
  );
}

function MaterialsPicker({ library, selected, onSelectedChange, onAdded }: { library: LibraryMaterial[]; selected: string[]; onSelectedChange: (ids: string[]) => void; onAdded: (m: LibraryMaterial) => void }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const known = new Set(library.map((m) => m.legacyId));
  const orphans = selected.filter((legacyId) => !known.has(legacyId));

  function toggle(legacyId: string) {
    onSelectedChange(selected.includes(legacyId) ? selected.filter((x) => x !== legacyId) : [...selected, legacyId]);
  }

  function pickFile(next: File | null) {
    setError(null);
    if (!next) return setFile(null);
    const check = checkPickedFile({ name: next.name, type: next.type, size: next.size }, "pdf");
    if (!check.ok) {
      setError(check.message);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setFile(next);
  }

  async function save() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) return setError("Ponele un nombre al material antes de guardarlo.");
    setBusy(true);
    try {
      const materialId = crypto.randomUUID();
      let attachment: { name: string; mimeType: string; size: number; path: string } | null = null;
      if (file) {
        const prepared = await guardNetwork(() => prepareMaterialUploadAction({ materialId, name: file.name, type: file.type, size: file.size }));
        if (prepared.error || !prepared.data) return setError(prepared.error ?? "No se pudo preparar la subida.");
        setProgress(0);
        await uploadToSignedUrl({ signedUrl: prepared.data.signedUrl, file, mimeType: prepared.data.mimeType, onProgress: setProgress });
        attachment = { name: cleanFileName(file.name), mimeType: prepared.data.mimeType, size: file.size, path: prepared.data.path };
      }
      const result = await guardNetwork(() => addMaterialAction({ materialId, name: trimmed, note: note.trim() || null, attachment }));
      if (result.error || !result.data) return setError(result.error ?? "No se pudo guardar el material.");
      onAdded({ id: result.data.id, legacyId: result.data.legacyId, name: trimmed, note: note.trim() || null, hasFile: attachment !== null, availability: attachment ? "disponible" : "sin_archivo" });
      onSelectedChange([...selected, result.data.legacyId]);
      setName("");
      setNote("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setOpen(false);
    } catch (e) {
      setError(uploadErrorMessage(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className={LABEL}>Materiales utilizados</legend>
      <p className="text-sm text-textMuted">Opcional. Se reutilizan en cualquier clase futura, de cualquier alumno.</p>
      {(library.length > 0 || orphans.length > 0) && (
        <ul className="flex flex-wrap gap-2">
          {library.map((material) => {
            const checked = selected.includes(material.legacyId);
            return (
              <li key={material.legacyId}>
                <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border-[1.5px] px-3.5 text-sm font-[650] ${checked ? "border-ink bg-ink text-background" : "border-borderMid bg-surface text-textPrimary"}`}>
                  <input type="checkbox" className="h-4 w-4 accent-ink" checked={checked} onChange={() => toggle(material.legacyId)} />
                  <span className="[overflow-wrap:anywhere]">{material.name}</span>
                  {material.hasFile && <span className="text-[12px] font-normal opacity-80">· PDF</span>}
                </label>
              </li>
            );
          })}
          {orphans.map((legacyId) => (
            <li key={legacyId}>
              <label className="flex min-h-11 items-center gap-2 rounded-pill border-[1.5px] border-borderMid bg-surface px-3.5 text-sm text-textMuted">
                <input type="checkbox" className="h-4 w-4 accent-ink" checked onChange={() => toggle(legacyId)} />
                <span>Material sin identificar (todavía no se trasladó)</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)} aria-label="Agregar material nuevo a la biblioteca">
          + Agregar material nuevo
        </Button>
      ) : (
        <div className="space-y-3 rounded-md border-[1.5px] border-border bg-surface2 p-3">
          <Field label="Nombre del material" htmlFor={`${id}-name`}>
            <TextInput id={`${id}-name`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Nota (opcional)" htmlFor={`${id}-note`}>
            <TextArea id={`${id}-note`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="PDF (opcional)" htmlFor={`${id}-file`} hint="Hasta 20 MB.">
            <input id={`${id}-file`} ref={fileInput} type="file" accept="application/pdf,.pdf" className="text-sm" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </Field>
          {progress !== null && <p role="status" className="text-sm text-textSecondary">Subiendo el PDF… {Math.round(progress * 100)} %</p>}
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={busy} onClick={save}>
              Guardar material
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </fieldset>
  );
}

/**
 * «Evidencias y materiales de la clase»: fotos y PDF adjuntos (con descripción, abrir y quitar) y la biblioteca de materiales. Es lo que la app anterior permitía al registrar o editar una clase.
 * Los archivos se guardan en cuanto se suben (no esperan al botón de guardar de la clase); «Quitar» sólo oculta el adjunto, nunca borra el archivo. Los materiales elegidos viajan con el contenido de la clase.
 */
export function LessonFilesEditor({
  registrationId,
  attachments: initialAttachments,
  library: initialLibrary,
  materialIds,
  onMaterialIdsChange,
}: {
  registrationId: string;
  attachments: LessonContentAttachment[];
  library: LibraryMaterial[];
  materialIds: string[];
  onMaterialIdsChange: (ids: string[]) => void;
}) {
  const [attachments, setAttachments] = useState(initialAttachments);
  const [library, setLibrary] = useState(initialLibrary);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState<string | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  async function upload(file: File, expect: AttachmentKind) {
    setError(null);
    const check = checkPickedFile({ name: file.name, type: file.type, size: file.size }, expect);
    if (!check.ok) return setError(check.message);
    const attachmentId = crypto.randomUUID();
    try {
      setPhase({ text: "Preparando la subida…" });
      const prepared = await guardNetwork(() => prepareAttachmentUploadAction({ registrationId, attachmentId, name: file.name, type: file.type, size: file.size }));
      if (prepared.error || !prepared.data) return setError(prepared.error ?? "No se pudo preparar la subida.");
      setPhase({ text: "Subiendo… 0 %" });
      await uploadToSignedUrl({ signedUrl: prepared.data.signedUrl, file, mimeType: prepared.data.mimeType, onProgress: (f) => setPhase({ text: `Subiendo… ${Math.round(f * 100)} %` }) });
      setPhase({ text: "Guardando…" });
      const registered = await guardNetwork(() => registerAttachmentAction({ registrationId, attachmentId, name: file.name, kind: prepared.data!.kind, mimeType: prepared.data!.mimeType, size: file.size, path: prepared.data!.path, caption: null }));
      if (registered.error || !registered.data) return setError(registered.error ?? "No se pudo guardar el archivo.");
      setAttachments((current) => [...current, { id: registered.data!.id, name: cleanFileName(file.name), kind: prepared.data!.kind, caption: null, studentId: null, availability: "disponible" }]);
    } catch (e) {
      setError(uploadErrorMessage(e));
    } finally {
      setPhase(null);
    }
  }

  // Se elige el archivo y el campo se vacía enseguida: así se puede volver a elegir el mismo archivo.
  function picked(event: React.ChangeEvent<HTMLInputElement>, expect: AttachmentKind) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void upload(file, expect);
  }

  const busy = phase !== null;
  return (
    <div className="space-y-5">
      <fieldset className="min-w-0 space-y-2">
        <legend className={LABEL}>Evidencias y materiales de la clase</legend>
        {attachments.length > 0 && (
          <ul className="space-y-2">
            {attachments.map((attachment) => (
              <AttachmentRow key={attachment.id} attachment={attachment} onChange={(next) => setAttachments((current) => current.map((a) => (a.id === next.id ? next : a)))} onRemoved={(id) => setAttachments((current) => current.filter((a) => a.id !== id))} />
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => pdfInput.current?.click()} aria-label="Adjuntar PDF">
            Adjuntar PDF
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => photoInput.current?.click()} aria-label="Elegir foto">
            Elegir foto
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => cameraInput.current?.click()} aria-label="Tomar foto">
            Tomar foto
          </Button>
        </div>
        <input ref={pdfInput} aria-label="Archivo PDF a adjuntar" type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => picked(event, "pdf")} />
        <input ref={photoInput} aria-label="Foto a adjuntar" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => picked(event, "image")} />
        <input ref={cameraInput} aria-label="Foto tomada con la cámara" type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => picked(event, "image")} />
        <p className="text-[13px] text-textMuted">PDF hasta 20 MB; fotos hasta 10 MB (JPG, PNG, WebP o HEIC).</p>
        {phase && (
          <p role="status" className="text-sm text-textSecondary">
            {phase.text}
          </p>
        )}
        {error && <Notice tone="bad">{error}</Notice>}
      </fieldset>
      <MaterialsPicker library={library} selected={materialIds} onSelectedChange={onMaterialIdsChange} onAdded={(m) => setLibrary((current) => [...current, m])} />
    </div>
  );
}
