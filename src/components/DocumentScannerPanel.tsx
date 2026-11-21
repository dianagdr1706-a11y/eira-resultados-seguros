"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  FilePlus2,
  FolderOpen,
  RefreshCw,
  Trash2,
  VideoOff,
} from "lucide-react";

interface DocumentScannerPanelProps {
  selectedFile: File | null;
  onPdfReady: (file: File | null) => void;
}

interface CapturedPage {
  id: string;
  dataUrl: string;
  label: string;
}

async function imageDataUrlToJpegBytes(dataUrl: string): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("No se pudo procesar la imagen escaneada."));
    el.src = dataUrl;
  });

  const maxDim = 1800;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible en el navegador.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.88);
  const res = await fetch(jpegDataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

async function buildPdfFileFromPages(pages: CapturedPage[], filename: string): Promise<File> {
  const pdfDoc = await PDFDocument.create();
  for (const pageItem of pages) {
    const jpgBytes = await imageDataUrlToJpegBytes(pageItem.dataUrl);
    const jpgImage = await pdfDoc.embedJpg(jpgBytes);
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 24;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;
    const scale = Math.min(maxW / jpgImage.width, maxH / jpgImage.height);
    const drawW = jpgImage.width * scale;
    const drawH = jpgImage.height * scale;

    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawImage(jpgImage, {
      x: (pageWidth - drawW) / 2,
      y: (pageHeight - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }

  const pdfBytes = await pdfDoc.save();
  const normalizedBytes = Uint8Array.from(pdfBytes);
  return new File([normalizedBytes], filename, { type: "application/pdf" });
}

export default function DocumentScannerPanel({
  selectedFile,
  onPdfReady,
}: DocumentScannerPanelProps) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
  const [converting, setConverting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, []);

  const startCamera = useCallback(
    async (targetFacing: "environment" | "user") => {
      setErrorMsg(null);
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setErrorMsg(
          "Tu navegador no permite abrir la cámara directamente. Usa el botón 'Buscar escaneo en computadora / foto' debajo."
        );
        return;
      }

      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: targetFacing },
            width: { ideal: 1600 },
            height: { ideal: 1200 },
          },
          audio: false,
        });
        streamRef.current = stream;
        setCameraOpen(true);

        requestAnimationFrame(() => {
          const video = videoRef.current;
          if (video) {
            video.srcObject = stream;
            video.setAttribute("playsinline", "true");
            void video.play();
          }
        });
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? `No se pudo abrir la cámara (${err.message}). Puedes buscar el escaneo directamente desde tu computadora.`
            : "No se pudo abrir la cámara."
        );
        setCameraOpen(false);
      }
    },
    []
  );

  const handleCapturePage = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const nextPages: CapturedPage[] = [
      ...capturedPages,
      {
        id: `pg-${Date.now()}`,
        dataUrl,
        label: `Página ${capturedPages.length + 1}`,
      },
    ];
    setCapturedPages(nextPages);
    setErrorMsg(null);

    // Automatically compile captured pages into a ready-to-upload PDF file
    setConverting(true);
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const pdfFile = await buildPdfFileFromPages(nextPages, `escaneo_eira_${stamp}.pdf`);
      onPdfReady(pdfFile);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo convertir la captura a PDF."
      );
    } finally {
      setConverting(false);
    }
  };

  const handleBuildPdfFromCaptures = async (pagesToConvert: CapturedPage[]) => {
    if (pagesToConvert.length === 0) return;
    setConverting(true);
    setErrorMsg(null);
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const pdfFile = await buildPdfFileFromPages(
        pagesToConvert,
        `escaneo_eira_${stamp}.pdf`
      );
      onPdfReady(pdfFile);
      stopCamera();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo convertir el escaneo a PDF."
      );
    } finally {
      setConverting(false);
    }
  };

  const handlePickFilesFromComputer = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    const files = Array.from(fileList);

    // Direct PDF selected
    if (files.length === 1 && files[0].type === "application/pdf") {
      setCapturedPages([]);
      onPdfReady(files[0]);
      return;
    }

    // One or more scanned images -> convert automatically to real PDF
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      setErrorMsg("Selecciona un archivo PDF o una imagen escaneada (JPG, PNG, WebP).");
      return;
    }

    setConverting(true);
    try {
      const loadedPages: CapturedPage[] = [];
      for (let i = 0; i < imageFiles.length; i += 1) {
        const f = imageFiles[i];
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(`No se pudo leer ${f.name}`));
          reader.readAsDataURL(f);
        });
        loadedPages.push({
          id: `file-${i}-${Date.now()}`,
          dataUrl,
          label: f.name,
        });
      }
      setCapturedPages(loadedPages);
      const baseName = imageFiles[0].name.replace(/\.[^.]+$/, "");
      const pdfFile = await buildPdfFileFromPages(loadedPages, `${baseName}_escaneado.pdf`);
      onPdfReady(pdfFile);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "No se pudo convertir la imagen escaneada a PDF."
      );
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="rounded-2xl border-2 border-dashed border-eira-300 bg-eira-50/35 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-padi-plum">
            Escáner de Resultado Impreso (Cámara del celular / Búsqueda de escaneo en PC)
          </p>
          <p className="text-xs text-padi-ink mt-0.5">
            Captura hojas impresas con la cámara o busca un escaneo (PDF o foto JPG/PNG) en tu
            computadora. Las fotos se convierten automáticamente a un PDF cifrado con SHA-256.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {!cameraOpen ? (
            <button
              type="button"
              onClick={() => void startCamera(facingMode)}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-full min-h-[48px] bg-eira-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-eira-700 transition"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Abrir Cámara (Celular / Webcam)
            </button>
          ) : (
            <button
              type="button"
              onClick={stopCamera}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-2xl border border-padi-line bg-white px-4 py-2 text-xs font-bold text-padi-ink hover:bg-padi-blush/60 transition"
            >
              <VideoOff className="h-4 w-4" aria-hidden="true" />
              Cerrar Cámara
            </button>
          )}

          <label className="min-h-[44px] inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-eira-300 bg-white px-4 py-2 text-xs font-bold text-eira-800 hover:bg-eira-50 transition">
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Buscar escaneo en PC (PDF / Foto)
            <input
              type="file"
              accept="application/pdf,image/*"
              multiple
              capture="environment"
              onChange={(e) => void handlePickFilesFromComputer(e.target.files)}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Live Camera Capture View */}
      {cameraOpen && (
        <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-3">
          <div className="relative overflow-hidden rounded-2xl bg-black aspect-[4/3] max-h-[380px] mx-auto">
            <video
              ref={videoRef}
              muted
              playsInline
              className="h-full w-full object-contain"
            />
            <div className="pointer-events-none absolute inset-4 rounded-2xl border-2 border-dashed border-eira-400/80" />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                const next = facingMode === "environment" ? "user" : "environment";
                setFacingMode(next);
                void startCamera(next);
              }}
              className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-100 hover:bg-slate-700"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Cambiar cámara ({facingMode === "environment" ? "Trasera" : "Frontal"})
            </button>

            <button
              type="button"
              onClick={handleCapturePage}
              className="inline-flex items-center gap-2 rounded-full min-h-[48px] bg-eira-600 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white hover:bg-eira-500 shadow-sm"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Tomar foto de página ({capturedPages.length + 1})
            </button>
          </div>
        </div>
      )}

      {/* Captured Pages Strip */}
      {capturedPages.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-padi-line bg-white p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-padi-plum">
              Páginas escaneadas ({capturedPages.length})
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCapturedPages([]);
                  onPdfReady(null);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-padi-line px-2.5 py-1 text-xs font-semibold text-padi-ink hover:bg-padi-blush/60"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Limpiar
              </button>
              <button
                type="button"
                disabled={converting}
                onClick={() => void handleBuildPdfFromCaptures(capturedPages)}
                className="inline-flex items-center gap-1.5 rounded-full min-h-[44px] bg-eira-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-eira-700 disabled:opacity-60"
              >
                <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" />
                {converting
                  ? "Generando PDF..."
                  : `Convertir ${capturedPages.length} página(s) a PDF`}
              </button>
            </div>
          </div>

          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {capturedPages.map((pg, idx) => (
              <div
                key={pg.id}
                className="relative shrink-0 w-24 rounded-2xl border border-padi-line bg-padi-blush/60 p-1.5 text-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pg.dataUrl}
                  alt={pg.label}
                  className="h-24 w-full rounded-lg object-cover"
                />
                <p className="mt-1 truncate text-[10px] font-semibold text-padi-ink">
                  Pág. {idx + 1}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setCapturedPages((prev) => prev.filter((item) => item.id !== pg.id))
                  }
                  aria-label={`Quitar página ${idx + 1}`}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-600 p-1 text-white shadow hover:bg-rose-700"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ready PDF Confirmation */}
      {selectedFile && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-3.5 py-2.5 text-xs font-semibold text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>
              PDF listo para repositorio privado: <strong>{selectedFile.name}</strong> (
              {(selectedFile.size / 1024).toFixed(1)} KB)
            </span>
          </div>
          <button
            type="button"
            onClick={() => onPdfReady(null)}
            className="text-emerald-800 underline hover:text-emerald-950"
          >
            Quitar archivo
          </button>
        </div>
      )}
    </div>
  );
}
