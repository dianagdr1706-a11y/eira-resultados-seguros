"use client";

import React from "react";
import {
  Bot,
  Clock,
  Cpu,
  History,
  Lock,
  MonitorSmartphone,
  ShieldCheck,
  User,
  UserCheck,
} from "lucide-react";
import type { AuditLog } from "@/lib/types";

interface AuditTimelineProps {
  logs: AuditLog[];
  loading?: boolean;
  emptyMessage?: string;
  compact?: boolean;
}

const ACTOR_STYLE_MAP: Record<
  AuditLog["actor_type"],
  { label: string; badgeClass: string; dotClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  staff: {
    label: "Personal",
    badgeClass: "bg-eira-50 text-eira-700 border-eira-200",
    dotClass: "bg-eira-500 ring-eira-100",
    icon: ShieldCheck,
  },
  patient: {
    label: "Paciente",
    badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dotClass: "bg-emerald-500 ring-emerald-100",
    icon: UserCheck,
  },
  kiosk: {
    label: "Kiosco RPi",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    dotClass: "bg-amber-500 ring-amber-100",
    icon: MonitorSmartphone,
  },
  system: {
    label: "Sistema",
    badgeClass: "bg-padi-blush/60 text-padi-ink border-padi-line",
    dotClass: "bg-slate-500 ring-slate-100",
    icon: Cpu,
  },
};

const ACTION_BADGE_MAP: Record<string, string> = {
  PDF_CARGADO: "bg-eira-50 text-eira-700 border-eira-200",
  IDENTIDAD_ASOCIADA: "bg-eira-50 text-eira-700 border-eira-200",
  ASOCIACION_VERIFICADA: "bg-eira-50 text-eira-700 border-eira-200",
  REVISION_ADMINISTRATIVA: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REVISION_ADMIN_APROBADA: "bg-emerald-50 text-emerald-800 border-emerald-200",
  REVISION_ADMIN_DEVUELTA: "bg-rose-50 text-rose-800 border-rose-200",
  AUTORIZACION_CLINICA: "bg-emerald-50 text-emerald-800 border-emerald-200",
  DEVUELTO_A_CORRECCION: "bg-rose-50 text-rose-800 border-rose-200",
  NOTIFICACION_NEUTRA_EMITIDA: "bg-eira-50 text-eira-700 border-eira-200",
  NOTIFICACION_NEUTRA: "bg-eira-50 text-eira-700 border-eira-200",
  PDF_DESCARGADO_PACIENTE: "bg-emerald-100 text-emerald-900 border-emerald-300",
  PDF_CONSULTADO_STAFF: "bg-padi-blush/60 text-padi-ink border-padi-line",
  DESCARGA_PACIENTE: "bg-emerald-100 text-emerald-900 border-emerald-300",
  CONSULTA_PACIENTE: "bg-emerald-50 text-emerald-800 border-emerald-200",
  ENTREGA_ASISTIDA: "bg-amber-50 text-amber-800 border-amber-200",
  LOOP_ESCALADO: "bg-orange-50 text-orange-800 border-orange-200",
  LOOP_CERRADO_ACK: "bg-emerald-50 text-emerald-800 border-emerald-200",
  ACK_RECIBIDO: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

const DETAIL_KEY_LABELS: Record<string, string> = {
  sample_folio: "Folio muestra",
  patient_folio: "Folio paciente",
  patient_id: "ID paciente",
  delivery_mode: "Modalidad",
  priority: "Prioridad",
  kiosk_target: "Kiosco",
  kiosk_id: "Kiosco",
  loop_started: "Loop iniciado",
  comments: "Observación",
  comment: "Observación",
  note: "Nota",
  notes: "Nota",
  sha256: "SHA-256",
  pdf_sha256: "SHA-256",
  channel: "Canal",
  ack_folio: "Acuse",
  modality: "Vía",
  level: "Nivel loop",
  hours_mark: "Hora",
  decision: "Decisión",
  stage: "Etapa",
};

function formatSpanishTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

function parseDetailEntries(detailJson: string): Array<{ key: string; value: string }> {
  if (!detailJson) return [];
  try {
    const parsed = JSON.parse(detailJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [{ key: "Detalle", value: String(parsed) }];
    }
    const entries: Array<{ key: string; value: string }> = [];
    for (const [rawKey, rawVal] of Object.entries(parsed as Record<string, unknown>)) {
      if (rawVal === null || rawVal === undefined || rawVal === "") continue;
      const label = DETAIL_KEY_LABELS[rawKey] ?? rawKey.replaceAll("_", " ");
      let valStr: string;
      if (typeof rawVal === "boolean") {
        valStr = rawVal ? "Sí" : "No";
      } else if (typeof rawVal === "object") {
        valStr = JSON.stringify(rawVal);
      } else {
        valStr = String(rawVal);
      }
      if ((rawKey.includes("sha256") || rawKey.includes("hash")) && valStr.length > 16) {
        valStr = `${valStr.slice(0, 12)}…`;
      } else if (valStr.length > 90) {
        valStr = `${valStr.slice(0, 87)}…`;
      }
      entries.push({ key: label, value: valStr });
    }
    return entries.slice(0, 6);
  } catch {
    return [{ key: "Detalle", value: detailJson.slice(0, 90) }];
  }
}

function getActionBadgeClass(action: string): string {
  if (ACTION_BADGE_MAP[action]) return ACTION_BADGE_MAP[action];
  const upper = action.toUpperCase();
  if (upper.includes("DEVUELT") || upper.includes("RECHAZ") || upper.includes("DENEG")) {
    return "bg-rose-50 text-rose-800 border-rose-200";
  }
  if (upper.includes("AUTORIZ") || upper.includes("ACK") || upper.includes("ENTREG")) {
    return "bg-emerald-50 text-emerald-800 border-emerald-200";
  }
  if (upper.includes("LOOP") || upper.includes("LORA") || upper.includes("ESCAL")) {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  return "bg-padi-blush/60 text-padi-plum border-padi-line";
}

export default function AuditTimeline({
  logs,
  loading = false,
  emptyMessage = "Sin eventos registrados aún en la bitácora de auditoría.",
  compact = false,
}: AuditTimelineProps) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Cargando bitácora de auditoría">
        {[0, 1, 2].map((idx) => (
          <div
            key={idx}
            className="animate-pulse rounded-2xl border border-padi-line bg-padi-blush/60 p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="h-4 w-36 rounded bg-slate-200" />
              <div className="h-3 w-28 rounded bg-slate-200" />
            </div>
            <div className="mt-2.5 flex gap-2">
              <div className="h-5 w-24 rounded-full bg-slate-200" />
              <div className="h-5 w-32 rounded-full bg-slate-200" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-padi-pale bg-padi-blush/60 p-6 text-center">
        <History className="mx-auto h-6 w-6 text-padi-muted" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-padi-ink">{emptyMessage}</p>
        <p className="mt-1 text-xs text-padi-muted">
          Cada carga, cotejo de identidad, revisión, descarga o entrega asistida queda registrada de forma inmutable.
        </p>
      </div>
    );
  }

  const sortedLogs = [...logs].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
    return tb - ta;
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg bg-padi-blush/60 px-3 py-1.5 text-[11px] font-medium text-padi-ink">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5 text-padi-muted" aria-hidden="true" />
          Bitácora inmutable (append-only · {sortedLogs.length} eventos)
        </span>
        <span className="hidden sm:inline text-padi-muted">Orden cronológico inverso</span>
      </div>

      <ol className="relative border-l-2 border-padi-pale ml-4 space-y-4">
        {sortedLogs.map((log) => {
          const actorMeta = ACTOR_STYLE_MAP[log.actor_type] ?? {
            label: log.actor_type,
            badgeClass: "bg-padi-blush/60 text-padi-ink border-padi-line",
            dotClass: "bg-slate-500 ring-slate-100",
            icon: Bot,
          };
          const ActorIcon = actorMeta.icon ?? User;
          const details = parseDetailEntries(log.detail_json);

          return (
            <li key={log.id} className="ml-6 relative">
              <span
                className={`absolute -left-[31px] top-3 flex h-4 w-4 items-center justify-center rounded-full border-2 border-eira-600 bg-white ring-4 ring-eira-50`}
                aria-hidden="true"
              />
              <div
                className={`rounded-2xl border border-padi-line bg-white shadow-sm transition hover:border-padi-line ${
                  compact ? "p-3" : "p-3.5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${actorMeta.badgeClass}`}
                    >
                      <ActorIcon className="h-3 w-3" aria-hidden="true" />
                      {actorMeta.label}
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold tracking-tight ${getActionBadgeClass(
                        log.action
                      )}`}
                    >
                      {log.action}
                    </span>
                  </div>

                  <time
                    dateTime={log.created_at}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-padi-muted"
                  >
                    <Clock className="h-3 w-3 text-padi-muted" aria-hidden="true" />
                    {formatSpanishTimestamp(log.created_at)}
                  </time>
                </div>

                <p className="mt-1.5 text-xs font-semibold text-padi-plum">
                  {log.actor_name}{" "}
                  <span className="font-normal text-padi-muted">({log.actor_id})</span>
                </p>

                {details.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {details.map((entry, idx) => (
                      <span
                        key={`${log.id}-det-${idx}`}
                        className="inline-flex items-center gap-1 rounded-full bg-padi-blush border border-padi-pale px-2 py-0.5 text-[11px] text-padi-ink"
                      >
                        <span className="font-semibold text-padi-muted">{entry.key}:</span>
                        <span className="font-mono text-[10px] text-padi-plum">{entry.value}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
