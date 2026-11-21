"use client";

import { useState } from "react";

/**
 * Entrega el PDF a la app que la titular elija (Briar, para quedárselo sin internet) con el menú de compartir del
 * dispositivo. Usa el mismo token de descarga de un solo uso que "Ver documento"; si el dispositivo no puede
 * compartir archivos, lo descarga para adjuntarlo a mano.
 */
export default function EnviarBriar({ estudioId }: { estudioId: string }) {
  const [estado, setEstado] = useState("");
  async function enviar() {
    setEstado("Preparando tu documento…");
    try {
      const fd = new FormData();
      fd.set("estudio_id", estudioId);
      const r = await fetch("/api/portal/solicitar", { method: "POST", body: fd });
      const blob = await r.blob();
      if (!r.ok || blob.type !== "application/pdf") throw new Error("no disponible");
      const archivo = new File([blob], "documento-eira.pdf", { type: "application/pdf" });
      if (navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: "Documento EIRA" });
        setEstado("Listo. Elige Briar y tu contacto para guardarlo.");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = archivo.name;
        a.click();
        setEstado("Este dispositivo no comparte archivos directo: se descargó el PDF. Adjúntalo desde Briar.");
      }
    } catch (e) {
      setEstado((e as Error).name === "AbortError" ? "" : "No pudimos preparar el documento. Intenta de nuevo.");
    }
  }
  return (
    <div className="space-y-1">
      <button type="button" onClick={enviar} className="btn-secondary w-full py-3 text-lg">Enviar a mi Briar (guardar sin internet)</button>
      {estado && <p className="text-sm text-slate-600" role="status">{estado}</p>}
      <p className="text-xs text-slate-500">Solo tú decides a quién se lo mandas. Queda registrado que lo abriste.</p>
    </div>
  );
}
