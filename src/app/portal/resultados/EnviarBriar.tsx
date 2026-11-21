"use client";

import { useState } from "react";

/**
 * Entrega el documento como foto a la app que la titular elija (Briar solo acepta texto e imágenes) con el menú de
 * compartir del dispositivo. Usa el mismo token de descarga de un solo uso que "Ver documento"; si el dispositivo
 * no puede compartir archivos, descarga la foto para adjuntarla a mano.
 */
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (o: { data: ArrayBuffer }) => { promise: Promise<{
    numPages: number;
    getPage: (n: number) => Promise<{
      getViewport: (o: { scale: number }) => { width: number; height: number };
      render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
    }>;
  }> };
};

// pdf.js 3.11.174 (Apache-2.0) servido desde /public/pdfjs: el PDF se convierte a imagen en el propio dispositivo.
function cargarPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  return new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = "/pdfjs/pdf.min.js";
    s.onload = () => {
      w.pdfjsLib!.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.js";
      ok(w.pdfjsLib!);
    };
    s.onerror = () => mal(new Error("pdfjs"));
    document.head.appendChild(s);
  });
}

async function pdfAFotos(datos: ArrayBuffer): Promise<File[]> {
  const pdf = await (await cargarPdfJs()).getDocument({ data: datos }).promise;
  const fotos: File[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const viewport = pagina.getViewport({ scale: 2 });
    const lienzo = document.createElement("canvas");
    lienzo.width = viewport.width;
    lienzo.height = viewport.height;
    const ctx = lienzo.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    await pagina.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => lienzo.toBlob(r, "image/jpeg", 0.9));
    if (!blob) throw new Error("imagen");
    fotos.push(new File([blob], `documento-eira-${n}.jpg`, { type: "image/jpeg" }));
  }
  return fotos;
}

export default function EnviarBriar({ estudioId }: { estudioId: string }) {
  const [estado, setEstado] = useState("");
  const [fotos, setFotos] = useState<{ archivo: File; url: string }[]>([]);

  // Paso 1: prepara la foto y la muestra. Paso 2 (otro toque): comparte, para que el menú se abra dentro del gesto de la usuaria.
  async function preparar() {
    setEstado("Preparando tu documento…");
    try {
      const fd = new FormData();
      fd.set("estudio_id", estudioId);
      const r = await fetch("/api/portal/solicitar", { method: "POST", body: fd });
      const blob = await r.blob();
      if (!r.ok || blob.type !== "application/pdf") throw new Error("no disponible");
      setFotos((await pdfAFotos(await blob.arrayBuffer())).map((archivo) => ({ archivo, url: URL.createObjectURL(archivo) })));
      setEstado("");
    } catch {
      setEstado("No pudimos preparar el documento. Intenta de nuevo.");
    }
  }

  async function compartir() {
    const files = fotos.map((f) => f.archivo);
    try {
      await navigator.share({ files, title: "Documento EIRA" });
      setEstado("Listo. Elige Briar y tu contacto para guardarlo.");
    } catch (e) {
      setEstado((e as Error).name === "AbortError" ? "" : "No se pudo abrir el menú para compartir. Intenta de nuevo.");
    }
  }

  const puedeCompartir = fotos.length > 0 && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: fotos.map((f) => f.archivo) });
  return (
    <div className="space-y-2">
      {fotos.length === 0 ? (
        <button type="button" onClick={preparar} className="btn-secondary w-full py-3 text-lg">Enviar a mi Briar como foto</button>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {fotos.map((f) => <img key={f.url} src={f.url} alt="Tu documento" className="w-full rounded border" />)}
          {puedeCompartir ? (
            <button type="button" onClick={compartir} className="btn-primary w-full py-3 text-lg">Foto lista: enviar por Briar</button>
          ) : (
            <p className="text-sm text-slate-600">
              Este dispositivo no puede compartir directo. Si es tu propio celular, puedes{" "}
              {fotos.map((f, i) => <a key={f.url} href={f.url} download={f.archivo.name} className="text-rose-700 underline">guardar la foto{fotos.length > 1 ? ` ${i + 1}` : ""} </a>)}
              y adjuntarla desde Briar. En un equipo compartido no la guardes.
            </p>
          )}
        </>
      )}
      {estado && <p className="text-sm text-slate-600" role="status">{estado}</p>}
      <p className="text-xs text-slate-500">Solo tú decides a quién se lo mandas. Queda registrado que lo abriste.</p>
    </div>
  );
}
