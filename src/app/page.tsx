"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BellOff,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileCheck2,
  FileJson,
  FileSpreadsheet,
  Filter,
  Fingerprint,
  History,
  Lock,
  Mail,
  MessageSquare,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCheck,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import AuditTimeline from "@/components/AuditTimeline";
import {
  STATUS_LABELS,
  type AuditLog,
  type LoopChannel,
  type LoopEvent,
  type LoopStatus,
  type NotificationRecord,
  type StudyStatus,
  type StaffUser,
  type StudyWithPatient,
} from "@/lib/types";

interface StudyDetailResponse {
  study?: StudyWithPatient;
  auditLogs?: AuditLog[];
  loopEvents?: LoopEvent[];
  notifications?: NotificationRecord[];
  error?: string;
}

const STATUS_BADGE_MAP: Record<StudyStatus, string> = {
  cargado: "bg-slate-100 text-slate-700 border-slate-300",
  asociado: "bg-sky-50 text-sky-800 border-sky-200",
  revision_admin: "bg-indigo-50 text-indigo-800 border-indigo-200",
  pendiente_clinica: "bg-amber-50 text-amber-800 border-amber-200",
  devuelto: "bg-rose-50 text-rose-800 border-rose-300",
  autorizado_digital: "bg-teal-50 text-teal-800 border-teal-200",
  autorizado_acompanado: "bg-padi-blush text-padi-berry border-padi-pale",
  notificado: "bg-violet-50 text-violet-800 border-violet-200",
  consultado: "bg-emerald-50 text-emerald-800 border-emerald-200",
  entregado_asistido: "bg-emerald-100 text-emerald-900 border-emerald-300",
};

const LOOP_STATUS_META: Record<LoopStatus, { label: string; className: string }> = {
  inactivo: {
    label: "Sin iniciar",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  activo: {
    label: "Loop Activo",
    className: "bg-amber-50 text-amber-800 border-amber-200",
  },
  escalado_promotora: {
    label: "Escalado Promotora",
    className: "bg-rose-50 text-rose-800 border-rose-200",
  },
  cerrado_ack: {
    label: "Cerrado (ACK)",
    className: "bg-emerald-50 text-emerald-800 border-emerald-200",
  },
};

const CHANNEL_LABEL_MAP: Record<LoopChannel, { label: string; icon: React.ComponentType<{ className?: string }>; badge: string }> = {
  sms_neutro: {
    label: "SMS Neutro",
    icon: MessageSquare,
    badge: "bg-sky-50 text-sky-800 border-sky-200",
  },
  correo_neutro: {
    label: "Correo Neutro",
    icon: Mail,
    badge: "bg-indigo-50 text-indigo-800 border-indigo-200",
  },
  kiosco_wifi_local: {
    label: "Kiosco RPi Wi-Fi",
    icon: WifiOff,
    badge: "bg-teal-50 text-teal-800 border-teal-200",
  },
  lora_modulo_comunitario: {
    label: "LoRa 433MHz",
    icon: Radio,
    badge: "bg-amber-50 text-amber-800 border-amber-200",
  },
  nearby_p2p_brigadista: {
    label: "Nearby P2P Brigadista",
    icon: Activity,
    badge: "bg-violet-50 text-violet-800 border-violet-200",
  },
  escalamiento_promotora: {
    label: "Escalamiento Promotora",
    icon: UserCheck,
    badge: "bg-rose-50 text-rose-800 border-rose-200",
  },
};

const IMPLEMENTED_TODAY_ITEMS = [
  "PDF privado en disco + SHA-256 (cero archivos en public/)",
  "Cotejo anti-homónimos lado a lado (3 atributos obligatorios)",
  "Doble compuerta: Revisión Admin + Autorización Clínica",
  "Acceso paciente con OTP / PIN impreso en Valkey / TTL Store",
  "Cero enlaces públicos (Cache-Control: no-store, private)",
  "Expediente único: coincidencias multi-atributo con confirmación humana",
  "Captura offline con sincronización y detección de conflictos",
  "Kiosco RPi Offline + paquetes cifrados AES-256-GCM",
  "Motor Closed-Loop progresivo (0h–72h) + cierre por ACK",
  "Exportación abierta CSV / JSON + Bitácora inmutable",
];

const SIMULATED_PILOT_ITEMS = [
  "Pasarela SMS transaccional / Correo SMTP (bandeja neutra simulada en plataforma)",
  "Transmisión física radio LoRa 433MHz / Nearby P2P (eventos y payloads simulados)",
];

interface RegistryStats {
  unique_patients: number;
  total_visits: number;
  recurrent_patients: number;
  duplicates_prevented: number;
}

function formatShortDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function DashboardPage() {
  const [studies, setStudies] = useState<StudyWithPatient[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [registryStats, setRegistryStats] = useState<RegistryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [communityFilter, setCommunityFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");

  const [exportingFormat, setExportingFormat] = useState<"csv" | "json" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Inline detail drawer state
  const [drawerStudy, setDrawerStudy] = useState<StudyWithPatient | null>(null);
  const [drawerAuditLogs, setDrawerAuditLogs] = useState<AuditLog[]>([]);
  const [drawerLoopEvents, setDrawerLoopEvents] = useState<LoopEvent[]>([]);
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  // Guards against out-of-order responses (e.g. an initial 401 arriving after the post-login reload).
  const loadSeqRef = useRef(0);
  const loadDashboardData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [studiesRes, notifsRes, statsRes] = await Promise.all([
        fetch("/api/studies", { cache: "no-store" }),
        fetch("/api/notifications", { cache: "no-store" }),
        fetch("/api/registry/stats", { cache: "no-store" }).catch(() => null),
      ]);

      // Read both bodies before any early exit so no response stream is left open.
      const [studiesJson, notifsJson, statsJson] = (await Promise.all([
        studiesRes.json().catch(() => ({})),
        notifsRes.json().catch(() => ({})),
        statsRes ? statsRes.json().catch(() => ({})) : Promise.resolve({}),
      ])) as [
        { studies?: StudyWithPatient[]; error?: string },
        { notifications?: NotificationRecord[] },
        Partial<RegistryStats>,
      ];
      if (seq !== loadSeqRef.current) return;
      if (!studiesRes.ok) {
        throw new Error(studiesJson.error || "No se pudo cargar la lista de estudios.");
      }

      setRegistryStats(
        statsRes?.ok && typeof statsJson.unique_patients === "number"
          ? {
              unique_patients: statsJson.unique_patients,
              total_visits: Number(statsJson.total_visits ?? 0),
              recurrent_patients: Number(statsJson.recurrent_patients ?? 0),
              duplicates_prevented: Number(statsJson.duplicates_prevented ?? 0),
            }
          : null
      );
      setStudies(Array.isArray(studiesJson.studies) ? studiesJson.studies : []);
      setNotifications(
        notifsRes.ok && Array.isArray(notifsJson.notifications) ? notifsJson.notifications : []
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error inesperado al cargar el panel operativo."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  // Reload once the Navbar finishes (auto-)login, or clear data on logout:
  // staff APIs return 401 without a session.
  const lastStaffIdRef = useRef<string | null>(null);
  const handleStaffChange = useCallback(
    (staff: StaffUser | null) => {
      const nextId = staff?.id ?? null;
      if (nextId === lastStaffIdRef.current) return;
      lastStaffIdRef.current = nextId;
      if (staff) {
        void loadDashboardData();
      } else {
        setStudies([]);
        setNotifications([]);
        setRegistryStats(null);
        setError("Inicia sesión como personal (menú superior) para ver el panel operativo.");
      }
    },
    [loadDashboardData]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerStudy(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const openStudyDrawer = async (study: StudyWithPatient) => {
    setDrawerStudy(study);
    setDrawerAuditLogs([]);
    setDrawerLoopEvents([]);
    setDrawerError(null);
    setLoadingDrawer(true);
    try {
      const res = await fetch(`/api/studies/${study.id}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as StudyDetailResponse;
      if (!res.ok) {
        throw new Error(data.error || "No se pudo cargar el detalle del estudio.");
      }
      if (data.study) setDrawerStudy(data.study);
      setDrawerAuditLogs(Array.isArray(data.auditLogs) ? data.auditLogs : []);
      setDrawerLoopEvents(Array.isArray(data.loopEvents) ? data.loopEvents : []);
    } catch (err) {
      setDrawerError(
        err instanceof Error ? err.message : "No se pudo cargar la bitácora del estudio."
      );
    } finally {
      setLoadingDrawer(false);
    }
  };

  const handleExport = async (format: "csv" | "json") => {
    setExportingFormat(format);
    setExportError(null);
    try {
      const res = await fetch(`/api/export?format=${format}`, { cache: "no-store" });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errData.error || `Error al exportar en formato ${format.toUpperCase()}.`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = format === "csv" ? "eira-reporte-abierto.csv" : "eira-reporte-abierto.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "No se pudo descargar el archivo.");
    } finally {
      setExportingFormat(null);
    }
  };

  const communities = useMemo(() => {
    const set = new Set<string>();
    for (const s of studies) {
      if (s.community) set.add(s.community);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
  }, [studies]);

  const kpis = useMemo(() => {
    const total = studies.length;
    const unassociatedOrReturned = studies.filter(
      (s) => s.status === "cargado" || s.status === "devuelto"
    ).length;
    const pendingAdmin = studies.filter(
      (s) => s.status === "asociado" || s.status === "revision_admin"
    ).length;
    const pendingClinical = studies.filter((s) => s.status === "pendiente_clinica").length;
    const loopActive = studies.filter(
      (s) => s.loop_status === "activo" || s.loop_status === "escalado_promotora"
    ).length;
    const delivered = studies.filter(
      (s) => s.status === "consultado" || s.status === "entregado_asistido"
    ).length;
    const priorityCount = studies.filter((s) => s.priority === "prioritario").length;

    return {
      total,
      unassociatedOrReturned,
      pendingAdmin,
      pendingClinical,
      loopActive,
      delivered,
      priorityCount,
    };
  }, [studies]);

  const filteredStudies = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return studies.filter((study) => {
      if (statusFilter !== "all" && study.status !== statusFilter) return false;
      if (communityFilter !== "all" && study.community !== communityFilter) return false;
      if (!q) return true;
      const haystack = [
        study.sample_folio,
        study.pseudonym_code,
        study.community,
        study.site_name,
        study.patient?.full_name ?? "",
        study.patient?.folio ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [studies, statusFilter, communityFilter, searchTerm]);

  return (
    <div className="min-h-screen bg-transparent text-padi-ink">
      <Navbar onStaffChange={handleStaffChange} />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Hero Status Strip: Implementado hoy vs Simulado para piloto */}
        <section
          aria-label="Resumen operativo y transparencia tecnológica"
          className="relative overflow-hidden rounded-4xl bg-padi-plum text-white p-6 sm:p-8 shadow-lg space-y-5"
        >
          <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-padi-pink/40" />
          <div className="relative flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-padi-blush border border-padi-pale px-3 py-1 text-xs font-bold text-padi-berry">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Alternativa Clínica Segura a WhatsApp · +300 entregas/mes
              </div>
              <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                Panel Operativo EIRA Resultados Seguros
              </h1>
              <p className="mt-2 text-sm text-white/85 max-w-3xl">
                Trazabilidad completa de citologías de Papanicolaou desde la digitalización en laboratorio hasta el acuse de recibo de la paciente, con doble compuerta y cierre de brecha offline.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void loadDashboardData()}
                disabled={loading}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-white/70 bg-transparent px-4 py-2 text-xs font-bold text-white hover:bg-white/10 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
                Actualizar
              </button>
              <button
                type="button"
                onClick={() => void handleExport("csv")}
                disabled={exportingFormat !== null}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 border-padi-pale bg-white px-4 py-2 text-xs font-bold text-padi-plum hover:bg-padi-blush disabled:opacity-60"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                {exportingFormat === "csv" ? "Exportando..." : "Exportar CSV"}
              </button>
              <button
                type="button"
                onClick={() => void handleExport("json")}
                disabled={exportingFormat !== null}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-padi-berry px-4 py-2 text-xs font-bold text-white shadow-berry hover:bg-eira-700 disabled:opacity-60"
              >
                <FileJson className="h-4 w-4 text-padi-pink" aria-hidden="true" />
                {exportingFormat === "json" ? "Exportando..." : "Exportar JSON"}
              </button>
            </div>
          </div>

          {exportError && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-medium text-rose-800">
              {exportError}
            </div>
          )}

          {/* Clear Visual Distinction Strip */}
          <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-bold text-white">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Implementado hoy (Funcional en este prototipo)
                </span>
                <span className="text-[11px] font-semibold text-emerald-800">
                  Seguridad real + SQLite + Valkey/TTL
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {IMPLEMENTED_TODAY_ITEMS.map((item) => (
                  <div key={item} className="flex items-start gap-2 text-xs text-emerald-950">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 rounded-3xl border border-amber-200 bg-amber-50 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-2.5 py-0.5 text-xs font-bold text-white">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    Simulado para piloto
                  </span>
                </div>
                <div className="space-y-2">
                  {SIMULATED_PILOT_ITEMS.map((item) => (
                    <div key={item} className="flex items-start gap-2 text-xs text-amber-950">
                      <Radio className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-3 pt-2 border-t border-amber-200/80 text-[11px] text-amber-900 font-medium">
                Sin costos de carrier ni hardware RF conectado durante la demo; los payloads se validan en tiempo real.
              </p>
            </div>
          </div>
        </section>

        {/* KPI Metric Cards */}
        <section aria-label="Indicadores clave de operación" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="relative overflow-hidden rounded-3xl border border-padi-line bg-white p-5 shadow">
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-padi-pale/70" />
            <p className="text-xs font-semibold text-padi-muted">Total estudios</p>
            <p className="mt-1.5 text-4xl font-extrabold tracking-tighter text-padi-berry">
              {loading ? "—" : kpis.total}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {kpis.unassociatedOrReturned} por asociar/corregir
            </p>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-padi-line bg-white p-5 shadow">
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-padi-pale/70" />
            <p className="text-xs font-semibold text-padi-muted">Pendiente Admin</p>
            <p className="mt-1.5 text-4xl font-extrabold tracking-tighter text-padi-berry">
              {loading ? "—" : kpis.pendingAdmin}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Compuerta 1 (EIRA)</p>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-padi-line bg-white p-5 shadow">
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-padi-pale/70" />
            <p className="text-xs font-semibold text-padi-muted">Pendiente Clínica</p>
            <p className="mt-1.5 text-4xl font-extrabold tracking-tighter text-padi-berry">
              {loading ? "—" : kpis.pendingClinical}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Compuerta 2 (Médica)</p>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-padi-line bg-white p-5 shadow">
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-padi-pale/70" />
            <p className="text-xs font-semibold text-padi-muted">Loop Activo</p>
            <p className="mt-1.5 text-4xl font-extrabold tracking-tighter text-padi-berry">
              {loading ? "—" : kpis.loopActive}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">En espera de ACK</p>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-padi-line bg-white p-5 shadow">
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-padi-pale/70" />
            <p className="text-xs font-semibold text-padi-muted">Consultados / Entregados</p>
            <p className="mt-1.5 text-4xl font-extrabold tracking-tighter text-padi-berry">
              {loading ? "—" : kpis.delivered}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">Ciclo cerrado</p>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-padi-line bg-white p-5 shadow">
            <span aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-padi-pale/70" />
            <p className="text-xs font-semibold text-padi-muted">Prioritarios</p>
            <p className="mt-1.5 text-4xl font-extrabold tracking-tighter text-padi-berry">
              {loading ? "—" : kpis.priorityCount}
            </p>
            <p className="mt-1 text-[11px] text-padi-muted">Vigilancia intensiva</p>
          </div>
        </section>

        {registryStats && (
          <section
            aria-label="Expediente Único (Reto 1)"
            className="rounded-3xl border border-padi-line bg-white p-5 shadow space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="inline-flex items-center gap-2 text-sm font-bold text-padi-plum">
                <Users className="h-4 w-4 text-padi-berry" aria-hidden="true" />
                Expediente Único (Reto 1)
              </h2>
              <Link
                href="/registro"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-padi-berry px-4 py-2 text-xs font-bold text-white shadow-berry hover:bg-eira-700"
              >
                Ir a Registro y Expediente
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Pacientes únicas", value: registryStats.unique_patients },
                { label: "Visitas registradas", value: registryStats.total_visits },
                { label: "Pacientes recurrentes (≥2 visitas)", value: registryStats.recurrent_patients },
                { label: "Duplicados evitados", value: registryStats.duplicates_prevented },
              ].map((m) => (
                <div key={m.label} className="relative overflow-hidden rounded-3xl border border-padi-line bg-white p-5 shadow">
                  <span aria-hidden="true" className="pointer-events-none absolute -bottom-6 -right-6 h-20 w-20 rounded-full bg-padi-pale/70" />
                  <p className="text-[11px] font-semibold text-padi-muted">{m.label}</p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tighter text-padi-berry">{m.value}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-2xl border border-rose-200 bg-rose-50 p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-rose-800">
              <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadDashboardData()}
              className="rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Interactive Studies Table */}
        <section
          aria-label="Tabla interactiva de estudios"
          className="rounded-3xl border border-padi-line bg-white shadow overflow-hidden"
        >
          <div className="border-b border-padi-line p-4 sm:p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight text-padi-plum">
                  Seguimiento Nominal y Pseudonimizado de Estudios
                </h2>
                <p className="text-xs text-slate-500">
                  Filtra por estado o comunidad, navega directamente a la compuerta correspondiente o abre la bitácora auditable.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/eira"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-padi-berry px-4 py-2 text-xs font-bold text-white shadow-berry hover:bg-eira-700"
                >
                  <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Ir a Carga y Revisión EIRA
                </Link>
                <Link
                  href="/medico"
                  className="padi-pill inline-flex min-h-[44px] items-center gap-1.5 px-4 py-2 text-xs font-bold"
                >
                  <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
                  Autorización Clínica
                </Link>
              </div>
            </div>

            {/* Filters Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5 relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por folio PAP, pseudónimo EIRA-ALR, paciente..."
                  aria-label="Buscar estudios"
                  className="w-full rounded-full border border-padi-line bg-white pl-9 pr-3 py-2 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                />
              </div>

              <div className="sm:col-span-4 flex items-center gap-2">
                <Filter className="h-4 w-4 text-slate-400 shrink-0" aria-hidden="true" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="Filtrar por estado"
                  className="w-full rounded-full border border-padi-line bg-white px-3 py-2 text-xs sm:text-sm text-slate-800 focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                >
                  <option value="all">Todos los estados ({studies.length})</option>
                  {(Object.keys(STATUS_LABELS) as StudyStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {STATUS_LABELS[st]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <select
                  value={communityFilter}
                  onChange={(e) => setCommunityFilter(e.target.value)}
                  aria-label="Filtrar por comunidad"
                  className="w-full rounded-full border border-padi-line bg-white px-3 py-2 text-xs sm:text-sm text-slate-800 focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                >
                  <option value="all">Todas las comunidades</option>
                  {communities.map((comm) => (
                    <option key={comm} value={comm}>
                      {comm}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-padi-line text-left">
              <thead className="bg-padi-blush text-[11px] font-bold uppercase tracking-wider text-padi-muted">
                <tr>
                  <th className="px-4 py-3">Folio Muestra</th>
                  <th className="px-4 py-3">Código Pseudónimo</th>
                  <th className="px-4 py-3">Paciente</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Loop / ACK</th>
                  <th className="px-4 py-3 text-right">Acciones rápidas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-padi-line text-xs">
                {loading ? (
                  [0, 1, 2, 3].map((idx) => (
                    <tr key={idx} className="animate-pulse">
                      <td className="px-4 py-4" colSpan={6}>
                        <div className="h-5 rounded bg-slate-100 w-full" />
                      </td>
                    </tr>
                  ))
                ) : filteredStudies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                      No hay estudios que coincidan con los filtros seleccionados.
                    </td>
                  </tr>
                ) : (
                  filteredStudies.map((study) => {
                    const loopMeta = LOOP_STATUS_META[study.loop_status] ?? LOOP_STATUS_META.inactivo;
                    const needsEira =
                      study.status === "cargado" ||
                      study.status === "devuelto" ||
                      study.status === "asociado" ||
                      study.status === "revision_admin";
                    const needsDoctor = study.status === "pendiente_clinica";
                    const hasLoop = study.loop_status !== "inactivo";

                    return (
                      <tr
                        key={study.id}
                        className="hover:bg-padi-blush/60 transition-colors align-top"
                      >
                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <div className="font-mono font-bold text-slate-900">
                            {study.sample_folio}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {study.collection_date} · {study.community}
                          </div>
                          <div className="text-[10.5px] text-slate-400 truncate max-w-[190px]">
                            {study.site_name}
                          </div>
                        </td>

                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                            {study.pseudonym_code}
                          </span>
                          {study.priority === "prioritario" && (
                            <div className="mt-1">
                              <span className="inline-flex items-center rounded-full border border-eira-200 bg-eira-50 px-2 py-0.5 text-[10px] font-bold text-eira-700">
                                Prioritario
                              </span>
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3.5">
                          {study.patient ? (
                            <div>
                              <p className="font-semibold text-slate-900">
                                {study.patient.full_name}
                              </p>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                <span className="font-mono font-semibold text-slate-700">
                                  {study.patient.folio}
                                </span>{" "}
                                · {study.patient.community}
                              </p>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                              Sin asociar
                            </span>
                          )}
                        </td>

                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                              STATUS_BADGE_MAP[study.status]
                            }`}
                          >
                            {STATUS_LABELS[study.status]}
                          </span>
                          {study.delivery_mode && (
                            <div className="mt-1 text-[10.5px] text-slate-500">
                              Vía:{" "}
                              <span className="font-semibold text-slate-700">
                                {study.delivery_mode === "acompanado"
                                  ? "Acompañada"
                                  : "Digital"}
                              </span>
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${loopMeta.className}`}
                          >
                            {loopMeta.label}
                          </span>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600">
                            <Clock className="h-3 w-3 text-slate-400" aria-hidden="true" />
                            <span>
                              Nivel {study.loop_level} · {study.simulated_hours_elapsed}h
                            </span>
                          </div>
                          {study.ack_received_at && (
                            <div className="mt-0.5 text-[10.5px] font-semibold text-emerald-700">
                              ACK: {study.ack_method || "Confirmado"}
                            </div>
                          )}
                        </td>

                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                            {needsEira && (
                              <Link
                                href="/eira"
                                className="inline-flex items-center gap-1 rounded-lg border border-eira-200 bg-eira-50 px-2.5 py-1 text-[11px] font-semibold text-eira-700 hover:bg-eira-100"
                              >
                                <span>Ir a EIRA</span>
                                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                              </Link>
                            )}
                            {needsDoctor && (
                              <Link
                                href="/medico"
                                className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                              >
                                <span>Autorizar</span>
                                <ArrowRight className="h-3 w-3" aria-hidden="true" />
                              </Link>
                            )}
                            {hasLoop && (
                              <Link
                                href="/alertas-loop"
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                              >
                                <Radio className="h-3 w-3" aria-hidden="true" />
                                <span>Loop</span>
                              </Link>
                            )}
                            <button
                              type="button"
                              onClick={() => void openStudyDrawer(study)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              <History className="h-3 w-3 text-slate-500" aria-hidden="true" />
                              <span>Bitácora</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Simulated Neutral Notification Outbox */}
        <section
          aria-label="Bandeja de notificaciones neutras simuladas"
          className="rounded-3xl border border-padi-line bg-white shadow overflow-hidden"
        >
          <div className="border-b border-padi-line p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 bg-padi-blush">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-extrabold tracking-tight text-padi-plum">
                  Bandeja de Salida de Notificaciones Neutras
                </h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
                  Simulado para piloto
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                  <BellOff className="h-3 w-3" aria-hidden="true" />
                  CERO diagnósticos clínicos en mensajes
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Prueba verificable de privacidad desde el diseño: cada SMS, correo, aviso de kiosco o paquete LoRa omite resultados médicos, nombres en malla abierta y enlaces públicos.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {notifications.length} avisos registrados
            </span>
          </div>

          <div className="p-4 sm:p-5">
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[0, 1].map((idx) => (
                  <div
                    key={idx}
                    className="h-24 animate-pulse rounded-xl border border-slate-200 bg-slate-100"
                  />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">
                No hay notificaciones generadas todavía.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {notifications.slice(0, 10).map((notif) => {
                  const ch = CHANNEL_LABEL_MAP[notif.channel] ?? {
                    label: notif.channel,
                    icon: MessageSquare,
                    badge: "bg-slate-100 text-slate-700 border-slate-200",
                  };
                  const ChannelIcon = ch.icon;

                  return (
                    <article
                      key={notif.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${ch.badge}`}
                          >
                            <ChannelIcon className="h-3 w-3" aria-hidden="true" />
                            {ch.label}
                          </span>
                          <span className="rounded-md bg-white border border-slate-200 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                            {notif.pseudonym_code}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-500">
                          {formatShortDateTime(notif.created_at)}
                        </span>
                      </div>

                      <p className="text-xs text-slate-800 bg-white rounded-lg border border-slate-200/80 p-2.5 leading-relaxed">
                        &ldquo;{notif.neutral_message}&rdquo;
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>
                          Destino enmascarado:{" "}
                          <strong className="text-slate-700">{notif.recipient_masked}</strong>
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          0 términos clínicos · {notif.delivery_status}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Inline Detail & Audit Drawer */}
      {drawerStudy && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="drawer-study-title"
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerStudy(null);
          }}
        >
          <div className="w-full max-w-2xl bg-white h-full overflow-y-auto shadow-2xl border-l border-slate-200 flex flex-col">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 backdrop-blur px-5 py-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id="drawer-study-title" className="text-base font-bold text-slate-900">
                    Detalle y Bitácora · {drawerStudy.sample_folio}
                  </h2>
                  <span className="rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono text-xs text-slate-700">
                    {drawerStudy.pseudonym_code}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {drawerStudy.site_name} · {drawerStudy.community}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerStudy(null)}
                aria-label="Cerrar panel de detalle"
                className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="p-5 space-y-5 flex-1">
              {drawerError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
                  {drawerError}
                </div>
              )}

              {/* Summary Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-xs">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Estado y Compuertas
                  </p>
                  <p>
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                        STATUS_BADGE_MAP[drawerStudy.status]
                      }`}
                    >
                      {STATUS_LABELS[drawerStudy.status]}
                    </span>
                  </p>
                  <p className="text-slate-600">
                    Admin:{" "}
                    <strong className="text-slate-900">
                      {drawerStudy.admin_reviewed_by || "Pendiente"}
                    </strong>
                  </p>
                  <p className="text-slate-600">
                    Clínica:{" "}
                    <strong className="text-slate-900">
                      {drawerStudy.clinical_authorized_by || "Pendiente"}
                    </strong>
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-1.5 text-xs">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Paciente Asociada
                  </p>
                  {drawerStudy.patient ? (
                    <>
                      <p className="font-bold text-slate-900">{drawerStudy.patient.full_name}</p>
                      <p className="text-slate-600">
                        Folio:{" "}
                        <span className="font-mono font-semibold text-slate-900">
                          {drawerStudy.patient.folio}
                        </span>{" "}
                        · Nac: {drawerStudy.patient.birth_date}
                      </p>
                      <p className="text-slate-600">
                        Canal preferido:{" "}
                        <strong className="text-slate-800">
                          {drawerStudy.patient.preferred_channel}
                        </strong>
                      </p>
                    </>
                  ) : (
                    <p className="text-amber-800 font-semibold">
                      Estudio pendiente de asociación verificada.
                    </p>
                  )}
                </div>
              </div>

              {/* SHA-256 & Private PDF Link */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Fingerprint className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-emerald-900">
                      Hash SHA-256 del PDF privado
                    </p>
                    <p className="font-mono text-[11px] text-emerald-800 truncate max-w-[340px]">
                      {drawerStudy.pdf_sha256 || "Pendiente"}
                    </p>
                  </div>
                </div>
                <a
                  href={`/api/studies/${drawerStudy.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Ver PDF (requiere sesión)</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>

              {drawerStudy.clinical_note_internal && (
                <div className="rounded-xl border border-eira-200 bg-eira-50/60 p-3.5 text-xs">
                  <p className="inline-flex items-center gap-1 font-bold text-eira-800">
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                    Nota clínica interna (NUNCA se envía en notificaciones)
                  </p>
                  <p className="mt-1 text-slate-800">{drawerStudy.clinical_note_internal}</p>
                </div>
              )}

              {drawerLoopEvents.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Eventos recientes del Loop ({drawerLoopEvents.length})
                  </h3>
                  <div className="space-y-1.5">
                    {drawerLoopEvents.slice(0, 4).map((ev) => (
                      <div
                        key={ev.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs flex items-start justify-between gap-2"
                      >
                        <p className="text-slate-800">{ev.payload_preview}</p>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500">
                          +{ev.hours_mark}h
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Audit Timeline */}
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Bitácora de Auditoría Inmutable
                </h3>
                <AuditTimeline logs={drawerAuditLogs} loading={loadingDrawer} compact />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
