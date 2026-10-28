"use client";

import { useEffect, useState } from "react";
import { ArrowDownTrayIcon, ArrowTopRightOnSquareIcon, ClipboardDocumentIcon, ShareIcon } from "@heroicons/react/24/outline";
import { getReportSignedUrlAction } from "@/lib/actions/reports";
import { guardNetwork } from "@/lib/actions/network-guard";
import { Button, buttonClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { REPORT_SHARE_PRIVACY_NOTICE, buildReportShareMessage, canShareReportFiles, reportPdfFileName, shareReportPdf } from "@/lib/reports/share-pdf";

const NOTICE_SEEN_KEY = "teacherflow:reportes:aviso-compartir";

function readNoticeSeen(): boolean {
  try {
    return window.localStorage.getItem(NOTICE_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveNoticeSeen() {
  try {
    window.localStorage.setItem(NOTICE_SEEN_KEY, "1");
  } catch {
    // Sin almacenamiento (ventana privada): el aviso simplemente se vuelve a mostrar la próxima vez.
  }
}

/**
 * Compartir el PDF de UN reporte. Primero el aviso de privacidad del original (una sola vez; sólo se guarda que se vio). Después: «Compartir archivo» abre el selector del sistema con el PDF real
 * (desde ahí la profesora elige WhatsApp u otro medio y el contacto: nada se envía solo); si el navegador no puede compartir archivos se explica y quedan «Descargar PDF», «Copiar mensaje» y
 * «Abrir WhatsApp Web» (sin contacto ni texto). El archivo se pide con un enlace firmado de corta vida, nunca se publica una URL duradera, y la pantalla nunca afirma que el envío se completó.
 */
export function ShareReportDialog({ reportId, title, periodLabel, studentName, onClose }: { reportId: string; title: string; periodLabel: string; studentName: string; onClose: () => void }) {
  // El diálogo sólo se monta después de un toque (nunca en el servidor): el estado inicial puede leer el navegador sin provocar diferencias de hidratación.
  const [acknowledged, setAcknowledged] = useState(() => readNoticeSeen());
  const [supported, setSupported] = useState<boolean | null>(() => canShareReportFiles(navigator, (name, type) => new File([], name, { type })));
  const [busy, setBusy] = useState<null | "share">(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const shareMessage = buildReportShareMessage({ studentName, title, periodLabel });
  const [preparedPdf,setPreparedPdf]=useState<Blob|null>(null);
  const [downloadUrl,setDownloadUrl]=useState<string|null>(null);
  const [prepareError,setPrepareError]=useState<string|null>(null);
  const [prepareAttempt,setPrepareAttempt]=useState(0);
  useEffect(()=>{
    if(!acknowledged)return;
    let active=true;let objectUrl:string|null=null;
    async function prepare(){
      try{
        const result = await guardNetwork(() => getReportSignedUrlAction(reportId));
        if(result.error||!result.data?.url)throw new Error('prepare');
        const response=await fetch(result.data.url,{cache:'no-store'});
        if(!response.ok)throw new Error('download');
        const pdf=await response.blob();
        if(active){objectUrl=URL.createObjectURL(pdf);setDownloadUrl(objectUrl);setPreparedPdf(pdf);setPrepareError(null);}
      }catch{if(active)setPrepareError('No se pudo preparar el PDF. Podés reintentar o descargarlo.');}
    }
    void prepare();return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[acknowledged,reportId,prepareAttempt]);

  async function handleShare() {
    if(!preparedPdf)return;
    setBusy("share");
    setMessage(null);
    try {
      const outcome = await shareReportPdf({
        nav: navigator,
        preparedPdf,
        fetchPdf: async () => preparedPdf,
        makeFile: (blob, name, type) => new File([blob], name, { type }),
        fileName: reportPdfFileName(title),
        title,
        text: shareMessage,
      });
      if (outcome.status === "shared") setMessage({ tone: "info", text: "Se abrió el selector de tu dispositivo. Elegí por dónde enviarlo y a quién: el envío lo hacés vos." });
      else if (outcome.status === "cancelled") setMessage({ tone: "info", text: "No se compartió nada." });
      else {
        if (outcome.status === "unsupported") setSupported(false);
        setMessage({ tone: "bad", text: outcome.message });
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setMessage({ tone: "ok", text: "Mensaje copiado." });
    } catch {
      setMessage({ tone: "bad", text: "No se pudo copiar el mensaje. Seleccionalo y copialo a mano." });
    }
  }

  return (
    <Dialog title="Compartir reporte" size="sm" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}>
      <p className="text-[15px] font-[650] text-textPrimary [overflow-wrap:anywhere]">{title}</p>
      <p className="mb-3 text-[13.5px] text-textMuted">{periodLabel}</p>
      {!acknowledged ? (
        <div className="flex flex-col gap-3">
          <Notice tone="warn">{REPORT_SHARE_PRIVACY_NOTICE}</Notice>
          <Button
            variant="primary"
            onClick={() => {
              saveNoticeSeen();
              setAcknowledged(true);
            }}
          >
            Entendido
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {prepareError&&<><Notice tone="bad">{prepareError}</Notice><Button variant="secondary" onClick={()=>setPrepareAttempt(v=>v+1)}>Reintentar preparación</Button></>}
          {supported === false && <Notice tone="info">Este navegador no permite compartir el archivo directamente. Descargalo y adjuntalo donde quieras enviarlo.</Notice>}
          <Button variant="primary" onClick={handleShare} busy={busy === "share"} disabled={busy !== null || supported === false || !preparedPdf}>
            <ShareIcon className="h-4 w-4" aria-hidden />
            {supported && !preparedPdf && !prepareError ? "Preparando PDF…" : "Compartir archivo (WhatsApp u otro medio)"}
          </Button>
          {downloadUrl?<a href={downloadUrl} download={reportPdfFileName(title)} target="_blank" rel="noopener noreferrer" className={buttonClass({variant:'secondary'})}><ArrowDownTrayIcon className="h-4 w-4" aria-hidden />Descargar PDF</a>:<Button variant="secondary" disabled>Preparando PDF…</Button>}
          <Button variant="secondary" onClick={handleCopy}>
            <ClipboardDocumentIcon className="h-4 w-4" aria-hidden />
            Copiar mensaje
          </Button>
          <a href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: "ghost" })}>
            <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden />
            Abrir WhatsApp Web
          </a>
          <p className="text-[13px] text-textMuted">«Abrir WhatsApp Web» se abre sin contacto ni mensaje: descargá el PDF y adjuntalo en el chat que elijas.</p>
        </div>
      )}
    </Dialog>
  );
}
