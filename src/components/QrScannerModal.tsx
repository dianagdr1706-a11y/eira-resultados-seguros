"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  AlertCircle,
  Camera,
  FolderOpen,
  QrCode,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";

interface QrScannerModalProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onDetected: (rawValue: string) => void;
}

export default function QrScannerModal({
  open,
  title = "Escanear Código QR",
  subtitle = "Usa la cámara de tu celular/webcam o selecciona una imagen QR desde tu computadora.",
  onClose,
  onDetected,
}: QrScannerModalProps) {
  const [mode, setMode] = useState<"camera" | "file">("camera");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraActive, setCameraActive] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("Iniciando cámara...");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [decodingFile, setDecodingFile] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectedOnceRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [onClose, stopCamera]);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    detectedOnceRef.current = false;
    setErrorMessage(null);
  }, [open, stopCamera]);

  useEffect(() => {
    if (!open || mode !== "camera") {
      stopCamera();
      return;
    }

    let cancelled = false;
    setErrorMessage(null);
    setStatusMessage("Solicitando permiso de cámara...");

    const startCamera = async () => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        if (!cancelled) {
          setErrorMessage(
            "Tu navegador no permite acceso directo a la cámara (o requiere HTTPS en móvil). Puedes buscar una imagen QR desde tu computadora o galería."
          );
          setStatusMessage("Cámara no disponible");
        }
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();

        setCameraActive(true);
        setStatusMessage("Apunta la cámara al código QR de la Tarjeta EIRA...");

        const scanFrame = () => {
          if (cancelled || detectedOnceRef.current) return;
          const v = videoRef.current;
          const c = canvasRef.current;
          if (v && c && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              ctx.drawImage(v, 0, 0, c.width, c.height);
              const imageData = ctx.getImageData(0, 0, c.width, c.height);
              const qr = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: "dontInvert",
              });
              if (qr?.data) {
                detectedOnceRef.current = true;
                stopCamera();
                onDetected(qr.data);
                onClose();
                return;
              }
            }
          }
          rafRef.current = requestAnimationFrame(scanFrame);
        };

        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error
              ? err.message
              : "No se pudo acceder a la cámara.";
          setErrorMessage(
            `No se pudo abrir la cámara (${msg}). Cambia a "Buscar imagen en PC / Galería" para escanear un archivo.`
          );
          setStatusMessage("Permiso denegado o sin cámara");
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, mode, facingMode, onDetected, onClose, stopCamera]);

  const handleImageFileChange = async (file: File | null) => {
    if (!file) return;
    setDecodingFile(true);
    setErrorMessage(null);

    try {
      const objectUrl = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
        el.src = objectUrl;
      });

      const canvas = document.createElement("canvas");
      const maxDim = 1600;
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      URL.revokeObjectURL(objectUrl);

      if (!ctx) throw new Error("No se pudo procesar la imagen en el navegador.");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });

      if (!decoded?.data) {
        throw new Error(
          "No se detectó ningún código QR legible en esa imagen. Prueba con una captura más nítida o acércate con la cámara."
        );
      }

      stopCamera();
      onDetected(decoded.data);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error al leer código QR.");
    } finally {
      setDecodingFile(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-4xl border-2 border-padi-line bg-white shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b-2 border-padi-line bg-padi-blush px-5 py-4">
          <div className="flex items-start gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-eira-600 text-white">
              <QrCode className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900">{title}</h2>
              <p className="text-xs text-slate-600">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Cerrar escáner"
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-full border-2 border-padi-line bg-padi-blush p-1">
            <button
              type="button"
              onClick={() => setMode("camera")}
              className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs sm:text-sm font-bold transition ${
                mode === "camera"
                  ? "bg-white text-eira-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              Cámara (Celular / Webcam)
            </button>
            <button
              type="button"
              onClick={() => setMode("file")}
              className={`min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs sm:text-sm font-bold transition ${
                mode === "file"
                  ? "bg-white text-eira-700 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FolderOpen className="h-4 w-4" aria-hidden="true" />
              Buscar imagen (PC / Galería)
            </button>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          )}

          {mode === "camera" ? (
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-2xl bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  className="h-full w-full object-cover"
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Scanning reticle */}
                {cameraActive && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="h-48 w-48 rounded-2xl border-4 border-eira-500/90 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
                  </div>
                )}

                {!cameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/90 text-slate-200 px-4 text-center">
                    <Camera className="h-8 w-8 text-eira-400" aria-hidden="true" />
                    <p className="text-xs font-semibold">{statusMessage}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">{statusMessage}</span>
                <button
                  type="button"
                  onClick={() =>
                    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))
                  }
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Cambiar cámara ({facingMode === "environment" ? "Trasera" : "Frontal"})
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-eira-300 bg-eira-50/40 p-6 text-center space-y-3">
              <Upload className="mx-auto h-9 w-9 text-eira-600" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold text-slate-900">
                  Selecciona una foto o captura del código QR
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  Compatible con PNG, JPG o foto directa desde el celular. El análisis se ejecuta
                  100% en tu navegador (funciona incluso sin internet).
                </p>
              </div>
              <label className="inline-flex min-h-[46px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-eira-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-eira-700 transition">
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                {decodingFile ? "Leyendo código QR..." : "Buscar imagen en computadora / celular"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  disabled={decodingFile}
                  onChange={(e) => void handleImageFileChange(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
