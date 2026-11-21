"use client";

import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  Download,
  HeartHandshake,
  Lock,
  MapPin,
  Nfc,
  Printer,
  QrCode,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

export interface QrCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientFolio?: string | null;
  sampleFolio?: string | null;
  pseudonymCode: string;
  patientName?: string | null;
  community?: string | null;
  kioskId?: string | null;
  priority?: "rutinario" | "prioritario";
  deliveryMode?: "digital" | "acompanado" | null;
  status?: string;
  qrDataUrl?: string | null;
  pinHint?: string | null;
}

export default function QrCardModal({
  isOpen,
  onClose,
  patientFolio,
  sampleFolio,
  pseudonymCode,
  patientName,
  community,
  kioskId,
  priority,
  deliveryMode,
  qrDataUrl,
  pinHint,
}: QrCardModalProps) {
  const [generatedQrUrl, setGeneratedQrUrl] = useState<string>("");
  const [qrError, setQrError] = useState<string | null>(null);

  const qrPayload = useMemo(() => {
    return JSON.stringify({
      app: "EIRA",
      v: 1,
      pseudonym: pseudonymCode,
      patient_folio: patientFolio || undefined,
      sample_folio: sampleFolio || undefined,
      kiosk: kioskId || undefined,
    });
  }, [kioskId, patientFolio, pseudonymCode, sampleFolio]);

  useEffect(() => {
    if (!isOpen) return;
    if (qrDataUrl) {
      setGeneratedQrUrl(qrDataUrl);
      setQrError(null);
      return;
    }

    let cancelled = false;
    QRCode.toDataURL(qrPayload, {
      width: 260,
      margin: 2,
      errorCorrectionLevel: "M",
      color: {
        dark: "#0f172a",
        light: "#ffffff",
      },
    })
      .then((url) => {
        if (!cancelled) {
          setGeneratedQrUrl(url);
          setQrError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrError("No se pudo generar la imagen QR en este navegador.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, qrDataUrl, qrPayload]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isPriorityRoute = priority === "prioritario" || deliveryMode === "acompanado";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="eira-qr-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-3 sm:p-6 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #eira-printable-qr-card,
          #eira-printable-qr-card * {
            visibility: visible !important;
          }
          #eira-printable-qr-card {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            max-width: 680px !important;
            margin: 0 auto !important;
            box-shadow: none !important;
            border: 2px solid #be1254 !important;
            background: #ffffff !important;
          }
          .eira-no-print {
            display: none !important;
          }
        }
      `}</style>

      <div
        id="eira-printable-qr-card"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-4xl border-2 border-padi-line bg-white shadow-2xl overflow-hidden my-auto"
      >
        {/* Top EIRA Header */}
        <div className="bg-gradient-to-r from-padi-plum via-padi-berry to-eira-600 px-5 py-4 text-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold tracking-wide">
                  <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                  TARJETA SEMÁFORO CLÍNICO
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 border border-emerald-200/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-50">
                  <Nfc className="h-3.5 w-3.5" aria-hidden="true" />
                  QR / NFC-ready
                </span>
              </div>
              <h2 id="eira-qr-modal-title" className="mt-2 text-lg sm:text-xl font-bold">
                EIRA Movimiento Rosa A.C.
              </h2>
              <p className="text-xs sm:text-sm text-rose-100">
                Pase personal pseudonimizado para Kiosco Comunitario y Entrega Segura
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar tarjeta QR"
              className="eira-no-print inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 text-white hover:bg-white/25 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5">
          {/* Privacy Badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div className="flex items-center gap-2 text-emerald-900">
              <ShieldCheck className="h-5 w-5 text-emerald-700 shrink-0" aria-hidden="true" />
              <span className="text-sm font-bold">Sin diagnósticos en texto plano</span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800 border border-emerald-200">
              <Lock className="h-3 w-3" aria-hidden="true" />
              Cero enlaces públicos
            </span>
          </div>

          {/* QR + Identifiers Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-[210px_1fr] gap-5 items-center">
            <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-3">
              {generatedQrUrl ? (
                <img
                  src={generatedQrUrl}
                  alt={`Código QR pseudonimizado ${pseudonymCode}`}
                  className="h-44 w-44 rounded-xl bg-white p-1.5 shadow-sm border border-slate-200"
                />
              ) : (
                <div className="flex h-44 w-44 items-center justify-center rounded-xl bg-white text-center text-xs text-slate-500 p-4 border border-slate-200">
                  {qrError || "Generando código QR..."}
                </div>
              )}
              <span className="mt-2 text-[11px] font-mono font-semibold text-slate-600">
                {pseudonymCode}
              </span>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Código Pseudónimo (Mesh / LoRa / Kiosco)
                </p>
                <p className="mt-0.5 font-mono text-xl sm:text-2xl font-extrabold tracking-tight text-eira-700">
                  {pseudonymCode}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Folio de Paciente</p>
                  <p className="mt-0.5 font-mono text-sm font-bold text-slate-900">
                    {patientFolio || "Verificado en sede"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-[11px] font-semibold text-slate-500">Folio de Estudio</p>
                  <p className="mt-0.5 font-mono text-sm font-bold text-slate-900">
                    {sampleFolio || "N/D"}
                  </p>
                </div>
              </div>

              {(patientName || community || kioskId) && (
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-1">
                  {patientName && (
                    <p>
                      <span className="font-semibold text-slate-900">Titular:</span> {patientName}
                    </p>
                  )}
                  {(community || kioskId) && (
                    <p className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-eira-600 shrink-0" aria-hidden="true" />
                      <span>
                        {community || "Comunidad EIRA"}
                        {kioskId ? ` · Nodo ${kioskId}` : ""}
                      </span>
                    </p>
                  )}
                  {pinHint && (
                    <p className="text-amber-800 font-semibold">
                      PIN de comprobante impreso: <span className="font-mono">{pinHint}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Semáforo Clínico Indicator (Non-diagnostic visual guidance) */}
          <div
            className={`rounded-2xl border p-4 ${
              isPriorityRoute
                ? "border-rose-300 bg-rose-50/80 text-rose-950"
                : "border-emerald-300 bg-emerald-50/80 text-emerald-950"
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  isPriorityRoute ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"
                }`}
              >
                {isPriorityRoute ? (
                  <HeartHandshake className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Sparkles className="h-5 w-5" aria-hidden="true" />
                )}
              </div>
              <div>
                <p className="text-sm font-bold">
                  {isPriorityRoute
                    ? "Semáforo Clínico: Atención Acompañada Prioritaria"
                    : "Semáforo Clínico: Ruta de Entrega Habitual"}
                </p>
                <p className="mt-1 text-xs leading-relaxed opacity-90">
                  {isPriorityRoute
                    ? "Este código indica al personal de EIRA brindar orientación presencial o acompañada con calidez. Esta tarjeta no contiene resultados ni diagnósticos médicos."
                    : "Presenta este QR en tu Kiosco Comunitario EIRA o úsalo como respaldo en el portal seguro. La tarjeta no expone información clínica."}
                </p>
              </div>
            </div>
          </div>

          {/* Instructions for Kiosco Comunitario */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Instrucciones en Kiosco Comunitario EIRA (Sin Internet o Con Señal)
            </h3>
            <ol className="mt-2 space-y-1.5 text-xs sm:text-sm text-slate-700 list-decimal list-inside">
              <li>
                Muestra esta tarjeta impresa o en pantalla al lector QR/NFC de tu{" "}
                <strong className="text-slate-900">Kiosco Comunitario EIRA</strong> o a tu promotora de salud.
              </li>
              <li>
                Confirma tu <strong className="text-slate-900">fecha de nacimiento</strong> o{" "}
                <strong className="text-slate-900">PIN de comprobante</strong> para validar tu identidad.
              </li>
              <li>
                Recibirás tu reporte en sobre cerrado o descarga protegida, cerrando el ciclo de seguimiento (ACK).
              </li>
            </ol>
          </div>

          {/* Actions */}
          <div className="eira-no-print flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[48px] rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Cerrar
            </button>
            {generatedQrUrl && (
              <a
                href={generatedQrUrl}
                download={`QR_${pseudonymCode}.png`}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl border border-eira-300 bg-eira-50 px-5 py-2.5 text-sm font-bold text-eira-800 hover:bg-eira-100 transition"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Descargar QR (.png)
              </a>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-2xl bg-eira-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-eira-700 transition"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Imprimir Tarjeta QR / Semáforo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
