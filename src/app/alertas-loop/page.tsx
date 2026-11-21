"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Cpu,
  FastForward,
  Lock,
  MessageSquare,
  Radio,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Wifi,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import type { LoopChannel, LoopEvent, NotificationRecord, StaffUser, StudyWithPatient } from "@/lib/types";

interface LoopSummary {
  active: number;
  escalated: number;
  closed_ack: number;
  total_attempts: number;
}

interface LoopApiResponse {
  studies: StudyWithPatient[];
  events: LoopEvent[];
  summary: LoopSummary;
}

const CHANNEL_LABELS: Record<LoopChannel, { label: string; layer: string; badgeClass: string }> = {
  sms_neutro: {
    label: "SMS Neutro",
    layer: "Capa 1 · Con señal",
    badgeClass: "bg-sky-100 text-sky-800 border-sky-200",
  },
  correo_neutro: {
    label: "Correo Neutro",
    layer: "Capa 1 · Con señal",
    badgeClass: "bg-sky-100 text-sky-800 border-sky-200",
  },
  kiosco_wifi_local: {
    label: "Kiosco RPi Wi-Fi Local",
    layer: "Capa 2 · 0–100m sin señal",
    badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
  nearby_p2p_brigadista: {
    label: "Nearby P2P Brigadista",
    layer: "Capa 2 · Mesh cercano",
    badgeClass: "bg-indigo-100 text-indigo-800 border-indigo-200",
  },
  lora_modulo_comunitario: {
    label: "LoRa 433MHz Comunitario",
    layer: "Capa 3 · 1–10km rural",
    badgeClass: "bg-amber-100 text-amber-900 border-amber-300",
  },
  escalamiento_promotora: {
    label: "Promotora Comunitaria",
    layer: "Capa 4 · Escalamiento humano",
    badgeClass: "bg-rose-100 text-rose-800 border-rose-300",
  },
};

const ESCALATION_STEPS = [
  { level: 1, title: "Nivel 1", subtitle: "SMS / Correo / Kiosco" },
  { level: 2, title: "Nivel 2", subtitle: "Kiosco Wi-Fi / P2P" },
  { level: 3, title: "Nivel 3 LoRa", subtitle: "LoRa 433MHz 1–10km" },
  { level: 4, title: "Nivel 4 Promotora", subtitle: "Escalamiento Humano" },
] as const;

export default function AlertasLoopPage() {
  const [studies, setStudies] = useState<StudyWithPatient[]>([]);
  const [events, setEvents] = useState<LoopEvent[]>([]);
  const [summary, setSummary] = useState<LoopSummary>({
    active: 0,
    escalated: 0,
    closed_ack: 0,
    total_attempts: 0,
  });
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Guards against out-of-order responses (e.g. an initial 401 arriving after the post-login reload).
  const fetchSeqRef = useRef(0);
  const fetchAll = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
    try {
      const [loopRes, notifRes] = await Promise.all([
        fetch("/api/loop", { cache: "no-store" }),
        fetch("/api/notifications", { cache: "no-store" }),
      ]);

      if (seq !== fetchSeqRef.current) {
        await Promise.all([loopRes.body?.cancel(), notifRes.body?.cancel()]).catch(() => undefined);
        return;
      }
      if (loopRes.status === 401 || loopRes.status === 403) {
        const errData = (await loopRes.json().catch(() => ({}))) as { error?: string };
        await notifRes.body?.cancel().catch(() => undefined); // don't leave the stream open
        setStudies([]);
        setEvents([]);
        setNotifications([]);
        setFeedbackBanner({
          type: "error",
          text: errData.error || "Inicia sesión como personal para ver el motor Closed-Loop.",
        });
        return;
      }
      if (loopRes.ok) {
        const loopData = (await loopRes.json()) as LoopApiResponse;
        setStudies(Array.isArray(loopData.studies) ? loopData.studies : []);
        setEvents(Array.isArray(loopData.events) ? loopData.events : []);
        if (loopData.summary) setSummary(loopData.summary);
      }
      if (notifRes.ok) {
        const notifData = (await notifRes.json()) as { notifications?: NotificationRecord[] };
        setNotifications(Array.isArray(notifData.notifications) ? notifData.notifications : []);
      }
    } catch {
      setFeedbackBanner({
        type: "error",
        text: "No se pudo consultar el estado del motor Closed-Loop.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // Reload once the Navbar finishes (auto-)login; staff APIs return 401 without a session.
  const lastStaffIdRef = useRef<string | null>(null);
  const handleStaffChange = useCallback(
    (staff: StaffUser | null) => {
      const nextId = staff?.id ?? null;
      if (nextId === lastStaffIdRef.current) return;
      lastStaffIdRef.current = nextId;
      if (staff) setFeedbackBanner(null);
      void fetchAll();
    },
    [fetchAll]
  );

  const handleAdvanceLoop = async (hours: 24 | 48, studyId?: string) => {
    const actionId = studyId ? `adv-${studyId}-${hours}` : `adv-all-${hours}`;
    setBusyKey(actionId);
    setFeedbackBanner(null);
    try {
      const res = await fetch("/api/loop/advance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(studyId ? { study_id: studyId, hours } : { hours }),
      });
      const data = (await res.json()) as {
        updated_count?: number;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "No se pudo simular el avance del loop.");
      }

      const updatedCount = data.updated_count ?? 0;
      setFeedbackBanner({
        type: "success",
        text:
          updatedCount > 0
            ? `Simulación +${hours}h aplicada: ${updatedCount} estudio(s) sin respuesta escalaron al siguiente canal (los estudios con ACK permanecieron detenidos).`
            : `Simulación +${hours}h ejecutada: todos los estudios elegibles ya cuentan con ACK cerrado.`,
      });
      await fetchAll();
    } catch (err) {
      setFeedbackBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Error al avanzar loop.",
      });
    } finally {
      setBusyKey(null);
    }
  };

  const handleStopWithAck = async (study: StudyWithPatient) => {
    setBusyKey(`ack-${study.id}`);
    setFeedbackBanner(null);
    try {
      const res = await fetch("/api/loop/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          study_id: study.id,
          ack_method: "feedback_consola_closed_loop",
          notes: `Confirmación registrada desde Consola Closed-Loop para ${study.pseudonym_code}`,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(data.error || "No se pudo registrar el ACK.");
      }

      setFeedbackBanner({
        type: "success",
        text: `DETENIDO POR ACK: El ciclo de alertas para ${study.pseudonym_code} (${study.sample_folio}) se cerró inmediatamente.`,
      });
      await fetchAll();
    } catch (err) {
      setFeedbackBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Error al detener el loop con ACK.",
      });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-padi-ink">
      <Navbar onStaffChange={handleStaffChange} />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* Header & Global Controls */}
        <section className="rounded-4xl border border-padi-line bg-white p-5 sm:p-7 shadow-soft space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div className="space-y-1.5">
              <div className="padi-eyebrow inline-flex items-center gap-2">
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                Motor Closed-Loop · Red Híbrida Sin Señal
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-padi-plum">
                Consola de Alertas Insistentes y Escalamiento LoRa / Mesh
              </h1>
              <p className="text-sm text-slate-600 max-w-3xl">
                Garantiza cero resultados abandonados: si una paciente no confirma recepción (ACK),
                el sistema escala automáticamente por capas sin exponer jamás diagnósticos ni datos
                personales en texto plano.
              </p>
            </div>

            {/* Global Hackathon Demo Controls */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleAdvanceLoop(24)}
                className="min-h-[48px] inline-flex items-center gap-2 rounded-full bg-amber-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-amber-600/25 hover:bg-amber-700 disabled:opacity-60 transition"
              >
                <Clock className="h-4 w-4" aria-hidden="true" />
                {busyKey === "adv-all-24" ? "Avanzando..." : "+24h Simular sin respuesta"}
              </button>
              <button
                type="button"
                disabled={busyKey !== null}
                onClick={() => void handleAdvanceLoop(48)}
                className="min-h-[48px] inline-flex items-center gap-2 rounded-full bg-eira-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-eira-600/25 hover:bg-eira-700 disabled:opacity-60 transition"
              >
                <FastForward className="h-4 w-4" aria-hidden="true" />
                {busyKey === "adv-all-48" ? "Escalando..." : "+48h Simular rezago crítico"}
              </button>
              <button
                type="button"
                onClick={() => void fetchAll()}
                className="min-h-[48px] inline-flex items-center gap-2 rounded-full border-2 border-eira-600 bg-white px-5 py-2.5 text-sm font-bold text-eira-600 hover:bg-eira-50 transition"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Actualizar
              </button>
            </div>
          </div>

          {/* 4-Layer Hybrid Network Architecture Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
            <div className="rounded-3xl border border-sky-200 bg-sky-50/70 p-4 shadow-soft transition hover:border-eira-400">
              <div className="flex items-center gap-2 text-sky-900 font-bold text-xs uppercase tracking-wider">
                <Smartphone className="h-4 w-4 text-sky-700" aria-hidden="true" />
                Capa 1 · Con Señal
              </div>
              <p className="mt-1 text-sm font-bold text-slate-900">SMS / Correo Neutro</p>
              <p className="mt-0.5 text-xs text-slate-600">
                Aviso sin diagnósticos ni enlaces públicos permanentes.
              </p>
            </div>

            <div className="rounded-3xl border border-indigo-200 bg-indigo-50/70 p-4 shadow-soft transition hover:border-eira-400">
              <div className="flex items-center gap-2 text-indigo-900 font-bold text-xs uppercase tracking-wider">
                <Wifi className="h-4 w-4 text-indigo-700" aria-hidden="true" />
                Capa 2 · 0–100m Sin Señal
              </div>
              <p className="mt-1 text-sm font-bold text-slate-900">
                Kiosco RPi Wi-Fi + Nearby P2P
              </p>
              <p className="mt-0.5 text-xs text-slate-600">
                Hotspot local Raspberry Pi y salto cercano con brigadista offline.
              </p>
            </div>

            <div className="rounded-3xl border border-amber-300 bg-amber-50/80 p-4 shadow-soft transition hover:border-eira-400">
              <div className="flex items-center gap-2 text-amber-950 font-bold text-xs uppercase tracking-wider">
                <Cpu className="h-4 w-4 text-amber-700" aria-hidden="true" />
                Capa 3 · 1–10km Rural
              </div>
              <p className="mt-1 text-sm font-bold text-slate-900">Módulo LoRa 433MHz</p>
              <p className="mt-0.5 text-xs text-slate-700">
                Paquete pseudonimizado (<code className="font-mono">EIRA-ALR-XXXX</code>), cero PII
                ni diagnóstico.
              </p>
            </div>

            <div className="rounded-3xl border border-rose-200 bg-rose-50/80 p-4 shadow-soft transition hover:border-eira-400">
              <div className="flex items-center gap-2 text-rose-900 font-bold text-xs uppercase tracking-wider">
                <UserCheck className="h-4 w-4 text-rose-700" aria-hidden="true" />
                Capa 4 · Sin ACK tras SLA
              </div>
              <p className="mt-1 text-sm font-bold text-slate-900">Escalamiento a Promotora</p>
              <p className="mt-0.5 text-xs text-slate-700">
                Contacto humano respetuoso en comunidad; se detiene al instante al recibir ACK.
              </p>
            </div>
          </div>

          {/* Summary KPI Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-3xl border border-padi-line bg-white px-5 py-4 shadow-soft">
              <p className="text-[11px] font-bold uppercase tracking-wider text-eira-600">Ciclos Activos</p>
              <p className="mt-0.5 text-4xl font-extrabold text-eira-600">{summary.active}</p>
            </div>
            <div className="rounded-3xl border border-rose-200 bg-rose-50 px-5 py-4">
              <p className="text-xs font-semibold text-rose-700">Escalados a Promotora</p>
              <p className="mt-0.5 text-4xl font-extrabold text-rose-900">{summary.escalated}</p>
            </div>
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <p className="text-xs font-semibold text-emerald-700">Detenidos por ACK</p>
              <p className="mt-0.5 text-4xl font-extrabold text-emerald-900">{summary.closed_ack}</p>
            </div>
            <div className="rounded-3xl border border-padi-line bg-white px-5 py-4 shadow-soft">
              <p className="text-[11px] font-bold uppercase tracking-wider text-eira-600">Intentos Emitidos</p>
              <p className="mt-0.5 text-4xl font-extrabold text-eira-600">
                {summary.total_attempts}
              </p>
            </div>
          </div>
        </section>

        {/* Action Feedback Banner */}
        {feedbackBanner && (
          <div
            role="status"
            className={`flex items-start gap-3 rounded-2xl border p-4 text-sm font-semibold ${
              feedbackBanner.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                : "border-rose-300 bg-rose-50 text-rose-900"
            }`}
          >
            {feedbackBanner.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span>{feedbackBanner.text}</span>
          </div>
        )}

        {/* Per-Study Closed-Loop Trackers */}
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg sm:text-xl font-extrabold text-padi-plum flex items-center gap-2">
              <Activity className="h-5 w-5 text-eira-600" aria-hidden="true" />
              Seguimiento por Estudio ({studies.length})
            </h2>
            <span className="text-xs text-slate-500">
              Prioritarios escalan a LoRa en 24h y a Promotora en 48h
            </span>
          </div>

          {loading ? (
            <div className="rounded-4xl border border-padi-line bg-white p-8 text-center text-sm text-slate-500">
              Cargando ciclos activos del motor Closed-Loop...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {studies.map((s) => {
                const isClosed = s.loop_status === "cerrado_ack" || Boolean(s.ack_received_at);
                const isEscalated = s.loop_status === "escalado_promotora" && !isClosed;
                const isPriority = s.priority === "prioritario";
                const kioskId = s.patient?.kiosk_id || "KIOSK-SIERRA-01";
                const pseudoPacket = {
                  pseudonym_code: s.pseudonym_code,
                  kiosk_id: kioskId,
                  priority_flag: isPriority,
                  action: "ACUDIR_MODULO_EIRA",
                  pii_included: false,
                  diagnosis_included: false,
                };

                return (
                  <article
                    key={s.id}
                    className={`rounded-4xl border bg-white p-5 sm:p-7 shadow-soft space-y-5 ${
                      isClosed
                        ? "border-emerald-300 bg-emerald-50/20"
                        : isEscalated
                        ? "border-rose-300"
                        : isPriority
                        ? "border-amber-300"
                        : "border-slate-200"
                    }`}
                  >
                    {/* Top Row */}
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-eira-600 px-3 py-1 font-mono text-[11px] font-extrabold text-white">
                            {s.pseudonym_code}
                          </span>
                          <span className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-bold text-slate-700">
                            {s.sample_folio}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-[11px] font-bold border ${
                              isPriority
                                ? "bg-rose-100 text-rose-800 border-rose-200"
                                : "bg-slate-100 text-slate-700 border-slate-200"
                            }`}
                          >
                            {isPriority ? "PRIORITARIO" : "Rutinario"} ·{" "}
                            {s.delivery_mode === "acompanado" ? "Entrega Acompañada" : "Digital"}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-extrabold border ${
                              isClosed
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : isEscalated
                                ? "bg-rose-100 text-rose-900 border-rose-300"
                                : "bg-amber-100 text-amber-900 border-amber-300"
                            }`}
                          >
                            {isClosed ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                DETENIDO POR ACK
                              </>
                            ) : isEscalated ? (
                              "ESCALADO A PROMOTORA"
                            ) : (
                              `LOOP ACTIVO · NIVEL ${s.loop_level}`
                            )}
                          </span>
                        </div>

                        <p className="text-sm text-slate-700">
                          <strong>Comunidad:</strong> {s.community} · <strong>Nodo:</strong>{" "}
                          <span className="font-mono">{kioskId}</span> ·{" "}
                          <strong>Horas simuladas:</strong>{" "}
                          <span className="font-mono font-bold">+{s.simulated_hours_elapsed}h</span>{" "}
                          · <strong>Intentos:</strong> {s.loop_attempts}
                        </p>
                      </div>

                      {/* Per-study Demo Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isClosed || busyKey !== null}
                          onClick={() => void handleAdvanceLoop(24, s.id)}
                          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-full border-2 border-amber-500 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-950 hover:bg-amber-100 disabled:opacity-45 transition"
                        >
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          +24h Simular
                        </button>
                        <button
                          type="button"
                          disabled={isClosed || busyKey !== null}
                          onClick={() => void handleAdvanceLoop(48, s.id)}
                          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-full border-2 border-eira-600 bg-eira-50 px-4 py-2 text-xs font-bold text-eira-800 hover:bg-eira-100 disabled:opacity-45 transition"
                        >
                          <FastForward className="h-3.5 w-3.5" aria-hidden="true" />
                          +48h Crítico
                        </button>
                        <button
                          type="button"
                          disabled={isClosed || busyKey !== null}
                          onClick={() => void handleStopWithAck(s)}
                          className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold shadow-lg shadow-emerald-600/20 transition ${
                            isClosed
                              ? "bg-emerald-600 text-white cursor-default"
                              : "bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          }`}
                        >
                          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                          {isClosed
                            ? "ACK Recibido"
                            : busyKey === `ack-${s.id}`
                            ? "Cerrando..."
                            : "Registrar Feedback ACK (Detener Loop)"}
                        </button>
                      </div>
                    </div>

                    {/* Visual 4-Step Escalation Progress Bar + DETENIDO POR ACK */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                      {ESCALATION_STEPS.map((stepMeta) => {
                        const reached = s.loop_level >= stepMeta.level;
                        const isCurrent = !isClosed && s.loop_level === stepMeta.level;
                        return (
                          <div
                            key={stepMeta.level}
                            className={`rounded-3xl border p-3 transition ${
                              isCurrent
                                ? "border-eira-500 bg-eira-50 ring-2 ring-eira-200"
                                : reached
                                ? "border-amber-300 bg-amber-50/70"
                                : "border-slate-200 bg-slate-50 opacity-65"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-extrabold text-slate-900">
                                {stepMeta.title}
                              </span>
                              {reached && (
                                <span
                                  className={`h-3 w-3 rounded-full ${
                                    isCurrent ? "bg-eira-600 animate-pulse" : "bg-amber-500"
                                  }`}
                                />
                              )}
                            </div>
                            <p className="mt-0.5 text-[11px] font-medium text-slate-600">
                              {stepMeta.subtitle}
                            </p>
                          </div>
                        );
                      })}

                      {/* Terminal State: DETENIDO POR ACK */}
                      <div
                        className={`col-span-2 sm:col-span-1 rounded-2xl border p-3 transition ${
                          isClosed
                            ? "border-emerald-500 bg-emerald-100 ring-2 ring-emerald-200 text-emerald-950"
                            : "border-dashed border-slate-300 bg-slate-50 text-slate-400"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 text-xs font-extrabold">
                          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          DETENIDO POR ACK
                        </div>
                        <p className="mt-0.5 text-[11px] font-medium">
                          {isClosed
                            ? `Vía: ${s.ack_method || "confirmado"}`
                            : "Se detiene al confirmar"}
                        </p>
                      </div>
                    </div>

                    {/* Pseudonymous Packet Preview (Zero PII / Zero Diagnosis) */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3.5 text-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          Paquete Pseudonimizado LoRa / Mesh (0 PII · 0 Diagnósticos)
                        </div>
                        <pre className="overflow-x-auto font-mono text-xs text-slate-200">
                          {JSON.stringify(pseudoPacket)}
                        </pre>
                      </div>
                      {isClosed && s.ack_received_at && (
                        <div className="shrink-0 rounded-xl bg-emerald-500/20 border border-emerald-400/40 px-3 py-2 text-xs text-emerald-200 font-semibold">
                          ACK: {new Date(s.ack_received_at).toLocaleString("es-MX")}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* Live Feed: Loop Events & Neutral Notifications */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Loop Events Feed */}
          <div className="rounded-4xl border border-padi-line bg-white p-5 sm:p-7 shadow-soft space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <Radio className="h-5 w-5 text-eira-600" aria-hidden="true" />
                Paquetes Emitidos por el Motor ({events.length})
              </h2>
              <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                100% Pseudonimizados
              </span>
            </div>

            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {events.map((ev) => {
                const isAckStop = ev.status === "detenido_ack";
                const channelMeta = CHANNEL_LABELS[ev.channel] || {
                  label: ev.channel,
                  layer: "Red EIRA",
                  badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
                };

                return (
                  <div
                    key={ev.id}
                    className={`rounded-2xl border p-3.5 space-y-2 ${
                      isAckStop
                        ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-200"
                        : "border-slate-200 bg-slate-50/70"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-900 px-2.5 py-0.5 font-mono text-[11px] font-bold text-white">
                          {ev.pseudonym_code}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${channelMeta.badgeClass}`}
                        >
                          {channelMeta.label}
                        </span>
                        <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                          +{ev.hours_mark}h · N{ev.level}
                        </span>
                      </div>

                      {isAckStop ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-[11px] font-extrabold text-white">
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          DETENIDO POR ACK
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-slate-500">Emitido</span>
                      )}
                    </div>

                    <p className="font-mono text-xs text-slate-800 bg-white rounded-xl border border-slate-200 p-2.5 break-words">
                      {ev.payload_preview}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Neutral Notifications Feed */}
          <div className="rounded-4xl border border-padi-line bg-white p-5 sm:p-7 shadow-soft space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <Bell className="h-5 w-5 text-eira-600" aria-hidden="true" />
                Notificaciones Neutras Generadas ({notifications.length})
              </h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700">
                0 términos clínicos
              </span>
            </div>

            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {notifications.map((n) => {
                const channelMeta = CHANNEL_LABELS[n.channel] || {
                  label: n.channel,
                  layer: "Canal EIRA",
                  badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
                };

                return (
                  <div
                    key={n.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${channelMeta.badgeClass}`}
                        >
                          {channelMeta.label}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-eira-700">
                          {n.pseudonym_code}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        Destino: {n.recipient_masked}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm text-slate-800 bg-white rounded-xl border border-slate-200 p-2.5 flex items-start gap-2">
                      <MessageSquare
                        className="h-4 w-4 text-slate-400 shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span>{n.neutral_message}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
