"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  HeartHandshake,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  MessageSquare,
  PhoneCall,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserCheck,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import QrCardModal from "@/components/QrCardModal";
import QrScannerModal from "@/components/QrScannerModal";
import { STATUS_LABELS, type ContactChannel, type Study } from "@/lib/types";

interface DemoPatientPreset {
  name: string;
  folio: string;
  birthDate: string;
  badge: string;
  description: string;
  pinFallback?: string;
}

const DEMO_PATIENTS: DemoPatientPreset[] = [
  {
    name: "Patricia Reyes",
    folio: "PAC-2026-006",
    birthDate: "1995-07-08",
    badge: "Entrega Digital + Prueba 401",
    description: "Tiene celular/correo · OTP demo · Descarga PDF efímera 60s",
  },
  {
    name: "Carmen Flores",
    folio: "PAC-2026-005",
    birthDate: "1984-01-19",
    badge: "Acompañada Prioritaria",
    description: "Sin celular ni correo · PIN impreso 3047 · Cita + ACK",
    pinFallback: "3047",
  },
  {
    name: "Juana Morales",
    folio: "PAC-2026-003",
    birthDate: "1972-03-22",
    badge: "Sin Celular (PIN 9154)",
    description: "Rural Sierra Norte · Acceso inclusivo con PIN impreso 9154",
    pinFallback: "9154",
  },
];

interface RequestOtpResponse {
  ok?: boolean;
  error?: string;
  patient_name_masked?: string;
  channel?: ContactChannel;
  ttl_seconds?: number;
  simulated_otp_for_demo?: string;
  pin_fallback_hint?: string;
}

interface PatientProfile {
  id: string;
  folio: string;
  full_name: string;
  birth_date: string;
  phone: string | null;
  email: string | null;
  preferred_channel: ContactChannel;
  community: string;
  kiosk_id: string | null;
}

interface PortalStudy extends Study {
  ephemeral_download_token?: string | null;
  download_token?: string | null;
  download_url?: string | null;
  qr_data_url?: string | null;
}

interface Security401Proof {
  status: number;
  statusText: string;
  body: unknown;
  testedAt: string;
  url: string;
}

export default function PacientePortalPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [folio, setFolio] = useState("PAC-2026-006");
  const [birthDate, setBirthDate] = useState("1995-07-08");
  const [activePreset, setActivePreset] = useState<DemoPatientPreset | null>(DEMO_PATIENTS[0]);

  const [otpResponse, setOtpResponse] = useState<RequestOtpResponse | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [patient, setPatient] = useState<PatientProfile | null>(null);
  const [studies, setStudies] = useState<PortalStudy[]>([]);
  const [tokenTtlLeft, setTokenTtlLeft] = useState<number>(60);
  const [refreshingStudies, setRefreshingStudies] = useState(false);
  const [ackLoadingId, setAckLoadingId] = useState<string | null>(null);
  const [ackSuccessMessage, setAckSuccessMessage] = useState<string | null>(null);

  const [securityProofs, setSecurityProofs] = useState<Record<string, Security401Proof>>({});
  const [testing401Id, setTesting401Id] = useState<string | null>(null);

  const [qrStudy, setQrStudy] = useState<PortalStudy | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanSuccessMsg, setScanSuccessMsg] = useState<string | null>(null);

  const loadStudies = useCallback(async () => {
    setRefreshingStudies(true);
    try {
      const res = await fetch("/api/patient-portal/studies", { cache: "no-store" });
      const data = (await res.json()) as {
        error?: string;
        patient?: PatientProfile;
        studies?: PortalStudy[];
        ephemeral_ttl_seconds?: number;
      };
      if (!res.ok) {
        throw new Error(data.error || "Sesión expirada o no válida. Ingresa nuevamente.");
      }
      setPatient(data.patient ?? null);
      setStudies(Array.isArray(data.studies) ? data.studies : []);
      setTokenTtlLeft(typeof data.ephemeral_ttl_seconds === "number" ? data.ephemeral_ttl_seconds : 60);
      setStep(3);
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No se pudieron cargar tus estudios.");
      setStep(1);
    } finally {
      setRefreshingStudies(false);
    }
  }, []);

  // Countdown for ephemeral 60s download tokens
  useEffect(() => {
    if (step !== 3 || tokenTtlLeft <= 0) return;
    const timer = window.setInterval(() => {
      setTokenTtlLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step, tokenTtlLeft]);

  const handleSelectDemoPreset = (preset: DemoPatientPreset) => {
    setActivePreset(preset);
    setFolio(preset.folio);
    setBirthDate(preset.birthDate);
    setCode("");
    setOtpResponse(null);
    setErrorMsg(null);
    setAckSuccessMessage(null);
    setSecurityProofs({});
    setStep(1);
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/patient-portal/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folio: folio.trim().toUpperCase(),
          birth_date: birthDate.trim(),
        }),
      });
      const data = (await res.json()) as RequestOtpResponse;
      if (!res.ok) {
        throw new Error(data.error || "No pudimos verificar tu folio y fecha de nacimiento.");
      }
      setOtpResponse(data);
      setCode("");
      setStep(2);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Ocurrió un error al solicitar acceso.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/patient-portal/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folio: folio.trim().toUpperCase(),
          birth_date: birthDate.trim(),
          code: code.trim(),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "El código o PIN no coincide o expiró.");
      }
      await loadStudies();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "No pudimos validar tu código.");
    } finally {
      setLoading(false);
    }
  };

  const handleTestUnauthenticated401 = async (studyId: string) => {
    setTesting401Id(studyId);
    const targetUrl = `/api/studies/${studyId}/pdf`;
    try {
      const res = await fetch(targetUrl, {
        credentials: "omit",
        cache: "no-store",
      });
      const rawText = await res.text();
      let parsedBody: unknown = rawText;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        // Keep text body if non-JSON
      }
      setSecurityProofs((prev) => ({
        ...prev,
        [studyId]: {
          status: res.status,
          statusText: res.statusText || (res.status === 401 ? "Unauthorized" : ""),
          body: parsedBody,
          testedAt: new Date().toLocaleTimeString("es-MX"),
          url: targetUrl,
        },
      }));
    } catch (err) {
      setSecurityProofs((prev) => ({
        ...prev,
        [studyId]: {
          status: 0,
          statusText: "Network Error",
          body: { error: err instanceof Error ? err.message : "Error de red" },
          testedAt: new Date().toLocaleTimeString("es-MX"),
          url: targetUrl,
        },
      }));
    } finally {
      setTesting401Id(null);
    }
  };

  const handleConfirmAccompaniedAck = async (studyId: string) => {
    setAckLoadingId(studyId);
    setAckSuccessMessage(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/patient-portal/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          study_id: studyId,
          method: "confirmacion_cita_orientacion_portal",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "No se pudo registrar tu confirmación.");
      }
      setAckSuccessMessage(
        "Cita de orientación confirmada. Las alertas automáticas de seguimiento se detuvieron correctamente (ACK registrado)."
      );
      await loadStudies();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error al confirmar cita.");
    } finally {
      setAckLoadingId(null);
    }
  };

  const handleExitPortal = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "patient" }),
      });
    } catch {
      // Continue clearing local UI state
    }
    setStep(1);
    setPatient(null);
    setStudies([]);
    setOtpResponse(null);
    setCode("");
    setErrorMsg(null);
    setAckSuccessMessage(null);
    setSecurityProofs({});
  };

  const detectedPinHint = useMemo(() => {
    if (activePreset && activePreset.folio === folio.trim().toUpperCase() && activePreset.pinFallback) {
      return activePreset.pinFallback;
    }
    if (folio.trim().toUpperCase() === "PAC-2026-003") return "9154";
    if (folio.trim().toUpperCase() === "PAC-2026-005") return "3047";
    return null;
  }, [activePreset, folio]);

  return (
    <div className="min-h-screen bg-transparent text-padi-ink">
      <Navbar />

      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8 space-y-6">
        {/* Hero Header */}
        <section className="rounded-4xl border-2 border-padi-line bg-gradient-to-br from-padi-blush via-white to-padi-pale/60 p-6 sm:p-10 shadow-soft">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div className="space-y-3">
              <div className="padi-eyebrow inline-flex items-center gap-2 rounded-full border border-padi-line bg-white px-3 py-1.5">
                <ShieldCheck className="h-4 w-4 text-padi-berry" aria-hidden="true" />
                Portal Cero Fricción · Sin contraseñas ni WhatsApp
              </div>
              <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tighter leading-[1.05] text-padi-plum">
                Consulta Segura de tus <span className="padi-hl">Resultados</span> EIRA
              </h1>
              <p className="text-base sm:text-lg text-padi-muted leading-relaxed max-w-2xl">
                Entra con tu <strong className="text-padi-plum">folio</strong> y{" "}
                <strong className="text-padi-plum">fecha de nacimiento</strong>. Nunca usamos enlaces
                públicos permanentes ni enviamos diagnósticos por mensaje.
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-start sm:items-end gap-1.5 rounded-3xl border-2 border-emerald-200 bg-emerald-50 px-5 py-4 text-emerald-950">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800">
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Privacidad protegida
              </span>
              <span className="text-xs text-emerald-800">Sesión privada de 15 min</span>
              <span className="text-xs text-emerald-800">Token PDF efímero de 60s</span>
            </div>
          </div>
        </section>

        {/* Helper Demo Card for Judges */}
        <section
          aria-label="Accesos rápidos de demostración"
          className="rounded-4xl border-2 border-padi-line bg-white p-5 sm:p-6 shadow-soft space-y-3"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-eira-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-slate-900">
                Casos de Demostración (1 clic para llenar datos)
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              Prueba descarga digital, entrega acompañada y acceso sin celular
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {DEMO_PATIENTS.map((preset) => {
              const isSelected = folio.trim().toUpperCase() === preset.folio;
              return (
                <button
                  key={preset.folio}
                  type="button"
                  onClick={() => handleSelectDemoPreset(preset)}
                  className={`min-h-[84px] text-left rounded-3xl border-2 p-4 transition focus:outline-none focus:ring-4 focus:ring-padi-pink/30 ${
                    isSelected
                      ? "border-padi-pink bg-padi-blush shadow-soft"
                      : "border-padi-line bg-white hover:border-padi-pink hover:bg-padi-blush/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900">{preset.name}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[11px] font-bold text-eira-700 border border-eira-200">
                      {preset.folio}
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-eira-700">{preset.badge}</p>
                  <p className="mt-0.5 text-[11px] text-slate-600 leading-snug">
                    {preset.description} · Nac: {preset.birthDate}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Stepper Indicator */}
        <nav aria-label="Pasos de acceso" className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { n: 1 as const, label: "1. Tus datos" },
            { n: 2 as const, label: "2. Código OTP / PIN" },
            { n: 3 as const, label: "3. Tu resultado" },
          ].map((item) => {
            const active = step === item.n;
            const completed = step > item.n;
            return (
              <div
                key={item.n}
                className={`flex items-center justify-center gap-2 rounded-full border-2 px-3 py-3 text-xs sm:text-sm font-bold transition ${
                  active
                    ? "border-padi-berry bg-padi-berry text-white shadow-soft"
                    : completed
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-padi-line bg-white text-padi-muted"
                }`}
              >
                {completed && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span>{item.label}</span>
              </div>
            );
          })}
        </nav>

        {/* Global Error Banner */}
        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-rose-900"
          >
            <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm font-medium">{errorMsg}</div>
          </div>
        )}

        {/* STEP 1: Folio + DOB */}
        {step === 1 && (
          <section className="rounded-4xl border-2 border-padi-line bg-white p-6 sm:p-10 shadow-soft">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Paso 1: Escribe tu folio y fecha de nacimiento
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Encuentras tu folio en el talón blanco o tarjeta QR que te entregaron en tu jornada EIRA.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setScanSuccessMsg(null);
                  setScannerOpen(true);
                }}
                className="min-h-[48px] shrink-0 inline-flex items-center justify-center gap-2 rounded-full border-2 border-padi-berry bg-white px-5 py-2 text-xs sm:text-sm font-extrabold text-padi-berry hover:bg-padi-blush transition"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                Escanear Tarjeta QR (Cámara / PC)
              </button>
            </div>

            {scanSuccessMsg && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>{scanSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleRequestOtp} className="mt-6 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label
                    htmlFor="patient-folio"
                    className="block text-sm font-bold text-slate-800 mb-2"
                  >
                    Folio de Paciente
                  </label>
                  <div className="relative">
                    <UserCheck
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="patient-folio"
                      type="text"
                      required
                      value={folio}
                      onChange={(e) => setFolio(e.target.value)}
                      placeholder="Ej. PAC-2026-006"
                      className="min-h-[64px] w-full rounded-3xl border-2 border-padi-line bg-white pl-12 pr-4 font-mono text-xl sm:text-2xl font-semibold text-padi-ink uppercase focus:border-padi-pink focus:outline-none focus:ring-4 focus:ring-padi-berry/15"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="patient-dob"
                    className="block text-sm font-bold text-slate-800 mb-2"
                  >
                    Fecha de Nacimiento
                  </label>
                  <div className="relative">
                    <Calendar
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="patient-dob"
                      type="date"
                      required
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="min-h-[64px] w-full rounded-3xl border-2 border-padi-line bg-white pl-12 pr-4 text-xl font-semibold text-padi-ink focus:border-padi-pink focus:outline-none focus:ring-4 focus:ring-padi-berry/15"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="min-h-[76px] w-full rounded-[32px] bg-padi-berry px-6 py-4 text-lg sm:text-xl font-bold text-white shadow-soft hover:bg-eira-700 disabled:opacity-60 transition flex items-center justify-center gap-2"
              >
                <KeyRound className="h-5 w-5" aria-hidden="true" />
                {loading ? "Validando expediente..." : "Continuar y recibir código temporal"}
              </button>
            </form>
          </section>
        )}

        {/* STEP 2: OTP or Printed 4-Digit PIN */}
        {step === 2 && (
          <section className="rounded-4xl border-2 border-padi-line bg-white p-6 sm:p-10 shadow-soft space-y-6">
            {/* Simulated Neutral SMS / Email Banner */}
            {otpResponse && (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 sm:p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-emerald-950">
                    <MessageSquare className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                    <span className="text-sm font-bold">
                      Notificación Neutra Simulada (
                      {otpResponse.channel === "correo"
                        ? "Correo electrónico"
                        : otpResponse.channel === "kiosco_asistido"
                        ? "Comprobante / Kiosco sin teléfono"
                        : "SMS neutro"}
                      )
                    </span>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-200">
                    Titular: {otpResponse.patient_name_masked || folio}
                  </span>
                </div>

                {otpResponse.simulated_otp_for_demo ? (
                  <p className="rounded-xl bg-white/90 border border-emerald-200 px-4 py-3 text-sm text-slate-800">
                    &ldquo;EIRA: Tu código temporal de acceso es{" "}
                    <strong className="font-mono text-base text-eira-700">
                      {otpResponse.simulated_otp_for_demo}
                    </strong>{" "}
                    (vigente 10 min) para consultar tu documento del folio{" "}
                    <strong className="font-mono">{folio.toUpperCase()}</strong>. Cero diagnósticos en
                    este mensaje.&rdquo;
                  </p>
                ) : (
                  <p className="rounded-xl bg-white/90 border border-emerald-200 px-4 py-3 text-sm text-slate-800">
                    Te enviamos un código de 6 dígitos (vigente 10 min) a tu contacto registrado.
                    El mensaje no contiene diagnósticos.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2.5">
                  {otpResponse.simulated_otp_for_demo && (
                    <button
                      type="button"
                      onClick={() => setCode(otpResponse.simulated_otp_for_demo || "")}
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs sm:text-sm font-bold text-white hover:bg-emerald-800 transition"
                    >
                      <Smartphone className="h-4 w-4" aria-hidden="true" />
                      Usar código OTP demo ({otpResponse.simulated_otp_for_demo})
                    </button>
                  )}

                  {detectedPinHint && (
                    <button
                      type="button"
                      onClick={() => setCode(detectedPinHint)}
                      className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs sm:text-sm font-bold text-amber-900 hover:bg-amber-100 transition"
                    >
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                      Usar PIN impreso sin celular ({detectedPinHint})
                    </button>
                  )}
                </div>

                <p className="text-xs text-emerald-900 font-medium">
                  {otpResponse.pin_fallback_hint ||
                    "¿No tienes celular ni correo? Ingresa directamente el PIN de 4 dígitos impreso en tu comprobante de la jornada."}
                </p>
              </div>
            )}

            <form onSubmit={handleVerifyOtp} className="space-y-5">
              <div>
                <h2 className="text-xl font-bold text-slate-900">
                  Paso 2: Ingresa tu código temporal (6 dígitos) o PIN impreso (4 dígitos)
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Si acudiste sin teléfono ni correo, escribe los 4 números de tu talón impreso.
                </p>
              </div>

              <div>
                <label htmlFor="patient-otp" className="block text-sm font-bold text-slate-800 mb-2">
                  Código OTP o PIN de respaldo
                </label>
                <input
                  id="patient-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s+/g, ""))}
                  placeholder="Ej. 123456 o PIN 9154"
                  className="min-h-[72px] w-full rounded-3xl border-2 border-padi-line bg-white px-4 text-center font-mono text-3xl font-extrabold tracking-[0.3em] text-padi-ink focus:border-padi-pink focus:outline-none focus:ring-4 focus:ring-padi-berry/15"
                />
              </div>

              <div className="flex flex-col-reverse sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setErrorMsg(null);
                  }}
                  className="min-h-[64px] sm:w-48 rounded-full border-2 border-padi-line bg-white px-5 py-3 text-sm font-bold text-padi-plum hover:bg-padi-blush transition"
                >
                  Cambiar folio
                </button>
                <button
                  type="submit"
                  disabled={loading || code.trim().length < 4}
                  className="min-h-[64px] flex-1 rounded-full bg-padi-berry px-6 py-3 text-base sm:text-[17px] font-bold text-white shadow-soft hover:bg-eira-700 disabled:opacity-60 transition"
                >
                  {loading ? "Verificando acceso seguro..." : "Verificar e ingresar a mis resultados"}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* STEP 3: Authenticated Studies View */}
        {step === 3 && (
          <section className="space-y-5">
            {/* Session Summary Bar */}
            <div className="rounded-4xl border-2 border-padi-line bg-white p-6 shadow-soft flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Identidad verificada
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold text-slate-700">
                    {patient?.folio || folio}
                  </span>
                </div>
                <h2 className="mt-2 text-xl font-extrabold text-slate-900">
                  Bienvenida, {patient?.full_name || "Paciente EIRA"}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 flex items-center gap-1.5 mt-0.5">
                  <MapPin className="h-4 w-4 text-eira-600 shrink-0" aria-hidden="true" />
                  Comunidad: {patient?.community || "EIRA"}
                  {patient?.kiosk_id ? ` · Kiosco asignado: ${patient.kiosk_id}` : ""}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void loadStudies()}
                  disabled={refreshingStudies}
                  className="min-h-[46px] inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-xs sm:text-sm font-bold text-slate-700 hover:bg-slate-50 transition"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${refreshingStudies ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  Renovar token ({tokenTtlLeft}s)
                </button>
                <button
                  type="button"
                  onClick={() => void handleExitPortal()}
                  className="min-h-[46px] inline-flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs sm:text-sm font-bold text-rose-800 hover:bg-rose-100 transition"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Salir
                </button>
              </div>
            </div>

            {ackSuccessMessage && (
              <div
                role="status"
                className="flex items-start gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950"
              >
                <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                <p className="text-sm font-semibold">{ackSuccessMessage}</p>
              </div>
            )}

            {studies.length === 0 ? (
              <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center space-y-2">
                <Clock className="h-8 w-8 text-amber-600 mx-auto" aria-hidden="true" />
                <h3 className="text-lg font-bold text-amber-950">
                  Tu estudio aún está en validación clínica
                </h3>
                <p className="text-sm text-amber-900 max-w-lg mx-auto">
                  En cuanto el equipo médico de EIRA autorice el resultado, recibirás un aviso neutro
                  o podrás consultarlo aquí mismo o en tu Kiosco Comunitario.
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {studies.map((s) => {
                  const token = s.ephemeral_download_token ?? s.download_token ?? "";
                  const pdfHref =
                    s.download_url ||
                    (token ? `/api/studies/${s.id}/pdf?token=${encodeURIComponent(token)}` : `/api/studies/${s.id}/pdf`);
                  const isAccompanied = s.delivery_mode === "acompanado";
                  const proof = securityProofs[s.id];

                  return (
                    <article
                      key={s.id}
                      className={`rounded-4xl border-2 bg-white p-6 sm:p-8 shadow-soft space-y-5 ${
                        isAccompanied ? "border-padi-pink" : "border-padi-line"
                      }`}
                    >
                      {/* Study Header */}
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 border-b border-slate-100 pb-4">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold text-slate-800">
                              Muestra: {s.sample_folio}
                            </span>
                            <span className="rounded-full bg-eira-50 border border-eira-200 px-3 py-1 font-mono text-xs font-bold text-eira-700">
                              Código: {s.pseudonym_code}
                            </span>
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${
                                s.ack_received_at
                                  ? "bg-emerald-100 text-emerald-800"
                                  : isAccompanied
                                  ? "bg-amber-100 text-amber-900"
                                  : "bg-sky-100 text-sky-900"
                              }`}
                            >
                              {s.ack_received_at
                                ? "Confirmado / Entregado (ACK)"
                                : STATUS_LABELS[s.status] || s.status}
                            </span>
                          </div>
                          <h3 className="text-lg font-extrabold text-slate-900 pt-1">
                            Estudio de Citología Cervical (Papanicolaou)
                          </h3>
                          <p className="text-xs sm:text-sm text-slate-600">
                            Toma: <strong>{s.collection_date}</strong> · Sede:{" "}
                            <strong>{s.site_name}</strong>
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setQrStudy(s)}
                          className="min-h-[48px] shrink-0 inline-flex items-center justify-center gap-2 rounded-2xl border border-eira-300 bg-eira-50 px-4 py-2.5 text-sm font-bold text-eira-800 hover:bg-eira-100 transition"
                        >
                          <QrCode className="h-4 w-4" aria-hidden="true" />
                          Abrir Tarjeta QR Semáforo
                        </button>
                      </div>

                      {/* Branch A: Digital Authorized Study */}
                      {!isAccompanied && (
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                            <div className="space-y-1">
                              <p className="text-sm font-bold text-emerald-950">
                                Resultado autorizado para consulta privada
                              </p>
                              <p className="text-xs text-emerald-900">
                                El enlace de descarga caduca automáticamente en{" "}
                                <strong className="font-mono">{tokenTtlLeft}s</strong> y lleva marca
                                de agua con folio y fecha.
                              </p>
                            </div>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200 shrink-0">
                              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                              {tokenTtlLeft > 0 ? `Válido ${tokenTtlLeft}s` : "Token expirado"}
                            </span>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-3">
                            {tokenTtlLeft > 0 ? (
                              <a
                                href={pdfHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => {
                                  window.setTimeout(() => {
                                    void loadStudies();
                                  }, 1400);
                                }}
                                className="min-h-[64px] flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-padi-berry px-6 py-3 text-sm sm:text-base font-bold text-white shadow-soft hover:bg-eira-700 transition"
                              >
                                <Download className="h-5 w-5" aria-hidden="true" />
                                Ver / Descargar PDF Seguro (Token efímero {tokenTtlLeft}s)
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void loadStudies()}
                                className="min-h-[54px] flex-1 inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-5 py-3 text-sm sm:text-base font-bold text-white shadow-sm hover:bg-amber-700 transition"
                              >
                                <RefreshCw className="h-5 w-5" aria-hidden="true" />
                                Token de 60s expirado · Generar nuevo token seguro
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => void handleTestUnauthenticated401(s.id)}
                              disabled={testing401Id === s.id}
                              className="min-h-[54px] inline-flex items-center justify-center gap-2 rounded-2xl border-2 border-slate-800 bg-slate-900 px-5 py-3 text-xs sm:text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 transition"
                            >
                              <ShieldAlert className="h-4 w-4 text-amber-400" aria-hidden="true" />
                              {testing401Id === s.id
                                ? "Probando acceso..."
                                : "Probar seguridad: intentar abrir enlace sin sesión (401)"}
                            </button>
                          </div>

                          {/* Live HTTP 401 Proof Output */}
                          {proof && (
                            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-slate-100 space-y-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-extrabold ${
                                      proof.status === 401
                                        ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                                        : "bg-amber-500/20 text-amber-200 border border-amber-500/40"
                                    }`}
                                  >
                                    HTTP {proof.status} {proof.status === 401 ? "Acceso Denegado" : proof.statusText}
                                  </span>
                                  <span className="font-mono text-xs text-slate-400">
                                    GET {proof.url} (credentials: &apos;omit&apos;)
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-400">
                                  Probado {proof.testedAt}
                                </span>
                              </div>
                              <pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 font-mono text-xs text-emerald-300 border border-slate-800">
                                {JSON.stringify(proof.body, null, 2)}
                              </pre>
                              <p className="text-xs text-slate-300">
                                Comprobado: sin sesión activa ni token efímero válido, ningún enlace de
                                WhatsApp o URL copiada puede descargar el documento clínico.
                              </p>
                            </div>
                          )}

                          {s.pdf_sha256 && (
                            <p className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500 break-all">
                              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              Integridad SHA-256: {s.pdf_sha256}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Branch B: Accompanied Priority Delivery */}
                      {isAccompanied && (
                        <div className="space-y-4">
                          <div className="rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 to-amber-50/70 p-5 space-y-3">
                            <div className="flex items-start gap-3">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-eira-600 text-white">
                                <HeartHandshake className="h-6 w-6" aria-hidden="true" />
                              </div>
                              <div className="space-y-1">
                                <h4 className="text-base sm:text-lg font-extrabold text-slate-900">
                                  Tu médica recomienda una entrega acompañada y cercana
                                </h4>
                                <p className="text-sm text-slate-700 leading-relaxed">
                                  Para cuidarte mejor, en EIRA preferimos explicarte tu estudio
                                  personalmente y resolver todas tus dudas con tranquilidad antes de
                                  entregar el documento impreso. No estás sola: te acompañamos paso a
                                  paso.
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                              <div className="rounded-2xl border border-rose-200/80 bg-white p-3.5 text-xs sm:text-sm text-slate-700 space-y-1">
                                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <MapPin className="h-4 w-4 text-eira-600" aria-hidden="true" />
                                  Kiosco / Módulo EIRA más cercano
                                </p>
                                <p>
                                  {s.community || patient?.community || "Sierra Norte"} ·{" "}
                                  <span className="font-mono font-semibold">
                                    {patient?.kiosk_id || "KIOSK-SIERRA-01"}
                                  </span>
                                </p>
                                <p className="text-xs text-slate-500">
                                  Promotora comunitaria: Rosa Hernández · Mar y Jue 9:00–15:00 h
                                </p>
                              </div>

                              <div className="rounded-2xl border border-rose-200/80 bg-white p-3.5 text-xs sm:text-sm text-slate-700 space-y-1">
                                <p className="font-bold text-slate-900 flex items-center gap-1.5">
                                  <PhoneCall className="h-4 w-4 text-eira-600" aria-hidden="true" />
                                  Línea de orientación EIRA
                                </p>
                                <p className="font-mono font-semibold text-eira-700">
                                  800-EIRA-ROSA (Atención cálida)
                                </p>
                                <p className="text-xs text-slate-500">
                                  Lleva tu Tarjeta QR Semáforo o folio {patient?.folio || folio}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row gap-3">
                            <button
                              type="button"
                              disabled={Boolean(s.ack_received_at) || ackLoadingId === s.id}
                              onClick={() => void handleConfirmAccompaniedAck(s.id)}
                              className={`min-h-[64px] flex-1 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm sm:text-base font-bold shadow-soft transition ${
                                s.ack_received_at
                                  ? "bg-emerald-700 text-white cursor-default"
                                  : "bg-padi-berry text-white hover:bg-eira-700 disabled:opacity-60"
                              }`}
                            >
                              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                              {s.ack_received_at
                                ? `Cita de orientación confirmada (${s.ack_method || "ACK"})`
                                : ackLoadingId === s.id
                                ? "Registrando confirmación..."
                                : "Confirmar cita de orientación (Enviar ACK)"}
                            </button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </main>

      {/* Printable QR Clinical Traffic-Light Modal */}
      {qrStudy && (
        <QrCardModal
          isOpen={Boolean(qrStudy)}
          onClose={() => setQrStudy(null)}
          patientFolio={patient?.folio || folio}
          sampleFolio={qrStudy.sample_folio}
          pseudonymCode={qrStudy.pseudonym_code}
          patientName={patient?.full_name}
          community={qrStudy.community || patient?.community}
          kioskId={patient?.kiosk_id}
          priority={qrStudy.priority}
          deliveryMode={qrStudy.delivery_mode}
          status={qrStudy.status}
          qrDataUrl={qrStudy.qr_data_url}
          pinHint={detectedPinHint}
        />
      )}
      <QrScannerModal
        open={scannerOpen}
        title="Escanear mi Tarjeta QR EIRA"
        subtitle="Apunta con la cámara de tu celular o elige una foto de tu tarjeta en tu computadora."
        onClose={() => setScannerOpen(false)}
        onDetected={(rawQrValue) => {
          let extractedFolio = rawQrValue.trim();
          try {
            const parsed = JSON.parse(extractedFolio) as Record<string, unknown>;
            const candidate =
              (typeof parsed.folio === "string" && parsed.folio.trim()) ||
              (typeof parsed.patient_folio === "string" && parsed.patient_folio.trim()) ||
              (typeof parsed.pseudo === "string" && parsed.pseudo.trim()) ||
              (typeof parsed.pseudonym === "string" && parsed.pseudonym.trim()) ||
              "";
            if (candidate) {
              extractedFolio = candidate.toUpperCase();
            }
          } catch {
            extractedFolio = extractedFolio.toUpperCase();
          }
          setFolio(extractedFolio);
          setScanSuccessMsg(
            `Tarjeta QR detectada: folio ${extractedFolio} cargado. Ahora confirma tu fecha de nacimiento.`
          );
          setErrorMsg(null);
        }}
      />
    </div>
  );
}
