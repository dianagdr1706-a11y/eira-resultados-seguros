"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  FileText,
  History,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  UploadCloud,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import {
  SERVICE_LABELS,
  type MatchCandidate,
  type PatientCaptureInput,
  type ServiceCode,
  type StaffUser,
  type Visit,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Tipos locales (contrato API Reto 1)
// ---------------------------------------------------------------------------

type FirstVisit = { site_name: string; services: ServiceCode[]; sample_folio?: string | null };
type Changes = Partial<{
  phone: string;
  email: string;
  community: string;
  birth_state: string;
  preferred_channel: string;
}>;

type OfflineItem =
  | {
      kind: "new_patient";
      client_uuid: string;
      captured_at: string;
      data: PatientCaptureInput;
      first_visit: FirstVisit;
      confirm_new_reason?: string;
    }
  | {
      kind: "visit";
      client_uuid: string;
      captured_at: string;
      patient_id: string;
      visit: {
        visit_date: string;
        site_name: string;
        community?: string;
        services: ServiceCode[];
        sample_folio?: string | null;
      };
    }
  | {
      kind: "update";
      client_uuid: string;
      captured_at: string;
      patient_id: string;
      base_version: number;
      changes: Changes;
    };

interface PatientHeader {
  id: string;
  folio: string;
  full_name: string;
  birth_date: string;
  birth_state: string | null;
  community: string;
  phone_masked: string | null;
  email_masked?: string | null;
  preferred_channel: string;
  version?: number;
  created_at?: string;
  updated_at?: string | null;
}

interface HistoryStudy {
  id: string;
  sample_folio: string;
  pseudonym_code: string;
  status: string;
  status_label: string;
  collection_date: string;
  site_name: string;
  priority: string;
  delivery_mode: string | null;
  clinical_note_internal: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  actor_name: string;
  created_at: string;
  detail: Record<string, unknown>;
}

interface HistoryPayload {
  patient: PatientHeader;
  visits: Visit[];
  studies: HistoryStudy[];
  audit: AuditEntry[];
}

type SyncStatus = "creado" | "visita_registrada" | "actualizado" | "ya_sincronizado" | "conflicto" | "error";

interface SyncResult {
  client_uuid: string;
  status: SyncStatus;
  message: string;
  patient_id?: string;
  folio?: string;
  visit_id?: string;
  conflict?: {
    type: "POSSIBLE_DUPLICATE" | "VERSION_CONFLICT";
    candidates?: MatchCandidate[];
    current?: PatientHeader;
  };
}

interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string; code?: string };
  networkError?: boolean;
}

// ---------------------------------------------------------------------------
// Constantes y utilidades
// ---------------------------------------------------------------------------

const QUEUE_KEY = "eira_registro_offline_queue_v1";
const DEVICE_KEY = "eira_registro_device_id_v1";
const DEFAULT_SITE = "Jornada Municipal Teotihuacán";
const ALLOWED_ROLES = ["promotora_kiosco", "eira_admin", "laboratorio"];

const ENTIDADES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
  "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero",
  "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla",
  "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas",
  "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas", "Otra",
];

const SERVICE_CODES = Object.keys(SERVICE_LABELS) as ServiceCode[];

const inp =
  "w-full min-h-[44px] rounded-3xl border-2 border-padi-line bg-white px-4 py-2 text-sm text-padi-ink focus:outline-none focus:ring-2 focus:ring-eira-500/30 focus:border-eira-600";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-eira-600 px-6 py-2 text-sm font-bold text-white shadow-lg shadow-eira-600/25 transition hover:bg-eira-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-eira-500/40";
const btnSecondary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border-2 border-eira-600 bg-white px-5 py-2 text-sm font-bold text-eira-600 transition hover:bg-eira-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-eira-500/30";
const card = "rounded-4xl border border-padi-line bg-white p-5 sm:p-7 shadow-soft";

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") || iso.includes("Z") ? iso : iso.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("es-MX");
}

function uuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    const data = (await res.json().catch(() => ({}))) as ApiResult<T>["data"];
    return { ok: res.ok, status: res.status, data };
  } catch {
    return {
      ok: false,
      status: 0,
      networkError: true,
      data: { error: "No se pudo conectar con el servidor." } as ApiResult<T>["data"],
    };
  }
}

function readQueue(): OfflineItem[] {
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as OfflineItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineItem[]) {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    /* almacenamiento no disponible */
  }
}

function getDeviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev-${uuid()}`;
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "dev-sin-almacenamiento";
  }
}

// ---------------------------------------------------------------------------
// Componentes pequeños
// ---------------------------------------------------------------------------

function Chips({ services }: { services: ServiceCode[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {services.map((s) => (
        <span
          key={s}
          className="inline-flex rounded-full bg-eira-50 px-2.5 py-0.5 text-[11px] font-bold text-eira-700"
        >
          {SERVICE_LABELS[s] ?? s}
        </span>
      ))}
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-rose-200 bg-rose-50 text-rose-800",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-3 py-2.5 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null;
}

function ServicePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: ServiceCode[];
  onChange: (v: ServiceCode[]) => void;
  idPrefix: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-eira-600">Servicios de la visita</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SERVICE_CODES.map((code) => {
          const checked = value.includes(code);
          return (
            <label
              key={code}
              htmlFor={`${idPrefix}-${code}`}
              className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-3 py-2 text-sm ${
                checked ? "border-eira-600 bg-eira-50 text-eira-900" : "border-padi-line bg-white text-slate-700"
              }`}
            >
              <input
                id={`${idPrefix}-${code}`}
                type="checkbox"
                className="h-5 w-5 accent-eira-600"
                checked={checked}
                onChange={() => onChange(checked ? value.filter((s) => s !== code) : [...value, code])}
              />
              {SERVICE_LABELS[code]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Check({ ok }: { ok: boolean | null }) {
  if (ok === null) {
    return (
      <span className="font-bold text-slate-400" aria-label="Sin dato para comparar">
        —
      </span>
    );
  }
  return ok ? (
    <span className="font-bold text-emerald-600" aria-label="Coincide">
      ✓
    </span>
  ) : (
    <span className="font-bold text-rose-500" aria-label="No coincide">
      ✗
    </span>
  );
}

function CandidateCard({
  c,
  captured,
  busy,
  onConfirm,
  confirmLabel,
}: {
  c: MatchCandidate;
  captured: PatientCaptureInput | null;
  busy: boolean;
  onConfirm: (c: MatchCandidate) => void;
  confirmLabel: string;
}) {
  const has = (code: string) => c.reasons.some((r) => r.code === code);
  const probable = c.level === "probable";
  // null = one side has no data: shown as neutral, not as a mismatch
  const rows: Array<[string, string, string, boolean | null]> = captured
    ? [
        [
          "Nombre",
          captured.full_name,
          c.patient.full_name,
          has("name_very_similar") || has("name_similar") || has("surnames_equal"),
        ],
        ["Fecha de nacimiento", fmtDate(captured.birth_date), fmtDate(c.patient.birth_date), has("dob_exact")],
        [
          "Entidad de nacimiento",
          captured.birth_state || "—",
          c.patient.birth_state || "—",
          captured.birth_state && c.patient.birth_state ? has("birth_state_equal") : null,
        ],
        ["Comunidad", captured.community, c.patient.community, has("community_equal")],
        [
          "Teléfono",
          captured.phone ? "capturado" : "—",
          c.patient.phone_masked || "—",
          captured.phone && c.patient.phone_masked ? has("phone_equal") : null,
        ],
      ]
    : [];
  return (
    <div
      className={`rounded-3xl border-2 p-5 transition hover:border-eira-400 ${
        probable ? "border-eira-400 bg-eira-50/60" : "border-amber-200 bg-amber-50/50"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-base font-bold text-slate-900">{c.patient.full_name}</p>
          <p className="text-xs text-slate-600">
            Folio <span className="font-mono font-bold">{c.patient.folio}</span> · Nac. {fmtDate(c.patient.birth_date)} ·{" "}
            {c.patient.community}
          </p>
          <p className="text-xs text-slate-600">
            Tel. {c.patient.phone_masked || "—"} · {c.patient.visits_count} visita(s) · última:{" "}
            {fmtDate(c.patient.last_visit_date)}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[11px] font-bold ${
            probable ? "border-eira-600 bg-eira-50 text-eira-700" : "border-amber-600 bg-amber-50 text-amber-900"
          }`}
        >
          {probable ? "Probable" : "Posible"} · {c.score} pts
        </span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-eira-100" aria-hidden="true">
        <div
          className={`h-full ${probable ? "bg-gradient-to-r from-eira-400 to-eira-600" : "bg-amber-400"}`}
          style={{ width: `${Math.min(100, Math.round((c.score / 115) * 100))}%` }}
        />
      </div>
      <ul className="mt-3 space-y-1 text-xs text-slate-700">
        {c.reasons.map((r) => (
          <li key={r.code} className="flex justify-between gap-2">
            <span>{r.label}</span>
            <span className="font-mono font-bold text-slate-900">+{r.points}</span>
          </li>
        ))}
      </ul>
      {rows.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl bg-white p-2">
          <table className="w-full min-w-[320px] text-left text-xs">
            <caption className="sr-only">Comparación entre lo capturado y el expediente existente</caption>
            <thead>
              <tr className="text-slate-500">
                <th className="py-1 pr-2 font-semibold">Dato</th>
                <th className="py-1 pr-2 font-semibold">Capturado hoy</th>
                <th className="py-1 pr-2 font-semibold">Expediente</th>
                <th className="py-1 font-semibold">¿Igual?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([k, a, b, ok]) => (
                <tr key={k} className="border-t border-padi-line">
                  <td className="py-1 pr-2 font-semibold text-slate-700">{k}</td>
                  <td className="py-1 pr-2 break-words">{a}</td>
                  <td className="py-1 pr-2 break-words">{b}</td>
                  <td className="py-1">
                    <Check ok={ok} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button type="button" disabled={busy} onClick={() => onConfirm(c)} className={`${btnPrimary} mt-3 w-full sm:w-auto`}>
        <Spin on={busy} />
        {confirmLabel}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

type Tab = "captura" | "expediente" | "offline";

interface FormState {
  full_name: string;
  birth_date: string;
  birth_state: string;
  phone: string;
  email: string;
  community: string;
  site_name: string;
  services: ServiceCode[];
  sample_folio: string;
}

const EMPTY_FORM: FormState = {
  full_name: "",
  birth_date: "",
  birth_state: "",
  phone: "",
  email: "",
  community: "",
  site_name: DEFAULT_SITE,
  services: ["papanicolaou"],
  sample_folio: "",
};

export default function RegistroPage() {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("captura");

  // Conectividad
  const [simOffline, setSimOffline] = useState(false);
  const [realOnline, setRealOnline] = useState(true);
  const offline = simOffline || !realOnline;

  // Cola
  const [queue, setQueueState] = useState<OfflineItem[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [conflicts, setConflicts] = useState<Record<string, SyncResult>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [resolveReason, setResolveReason] = useState<Record<string, string>>({});
  const [resolveOpen, setResolveOpen] = useState<Record<string, boolean>>({});
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [resolveErr, setResolveErr] = useState<Record<string, string>>({});

  // Captura
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null);
  const [capturedSnapshot, setCapturedSnapshot] = useState<PatientCaptureInput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error" | "info" | "warn"; text: string } | null>(null);
  const [askReason, setAskReason] = useState(false);
  const [reason, setReason] = useState("");
  const [created, setCreated] = useState<{ folio: string; id: string; name: string; pin: string | null } | null>(null);

  // Expediente
  const [q, setQ] = useState("");
  const [searchResults, setSearchResults] = useState<PatientHeader[] | null>(null);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyErr, setHistoryErr] = useState<string | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [visitForm, setVisitForm] = useState({ site_name: DEFAULT_SITE, services: ["papanicolaou"] as ServiceCode[], sample_folio: "" });
  const [visitMsg, setVisitMsg] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [upd, setUpd] = useState({ phone: "", email: "", community: "", birth_state: "", preferred_channel: "" });
  const [updMsg, setUpdMsg] = useState<{ tone: "ok" | "error" | "info" | "warn"; text: string } | null>(null);
  const [versionConflict, setVersionConflict] = useState<PatientHeader | null>(null);

  const allowed = !!staff && ALLOWED_ROLES.includes(staff.role);
  const canWrite = !!staff && (staff.role === "promotora_kiosco" || staff.role === "eira_admin");

  const handleStaffChange = useCallback((s: StaffUser | null) => {
    setStaff(s);
    setSessionLoaded(true);
  }, []);

  const setQueue = useCallback((updater: (prev: OfflineItem[]) => OfflineItem[]) => {
    setQueueState((prev) => {
      const next = updater(prev);
      writeQueue(next);
      return next;
    });
  }, []);

  // Inicialización cliente
  useEffect(() => {
    setQueueState(readQueue());
    setDeviceId(getDeviceId());
    setRealOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const on = () => setRealOnline(true);
    const off = () => setRealOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // ----- Historial -----
  const loadHistory = useCallback(async (id: string) => {
    setHistBusy(true);
    setHistoryErr(null);
    const r = await api<HistoryPayload>(`/api/patients/${encodeURIComponent(id)}/history`);
    if (r.ok) {
      setHistory(r.data);
      setUpd({ phone: "", email: "", community: r.data.patient.community ?? "", birth_state: r.data.patient.birth_state ?? "", preferred_channel: r.data.patient.preferred_channel ?? "" });
      setVersionConflict(null);
    } else {
      setHistory(null);
      setHistoryErr(r.data.error || "No se pudo cargar el expediente.");
    }
    setHistBusy(false);
  }, []);

  const openPatient = useCallback(
    (id: string) => {
      setPatientId(id);
      setTab("expediente");
      setVisitMsg(null);
      setUpdMsg(null);
      void loadHistory(id);
    },
    [loadHistory],
  );

  // Recarga tras cambio de sesión (solo cuando cambia el id de personal)
  const staffId = staff?.id ?? null;
  useEffect(() => {
    if (staffId && patientId) void loadHistory(patientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffId]);

  // ----- Formulario -----
  const setF = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k !== "services" && k !== "site_name" && k !== "sample_folio") {
      setCandidates(null);
      setCapturedSnapshot(null);
      setAskReason(false);
    }
  };

  const capture = useMemo<PatientCaptureInput>(
    () => ({
      full_name: form.full_name.trim(),
      birth_date: form.birth_date,
      birth_state: form.birth_state || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      community: form.community.trim(),
    }),
    [form],
  );

  const firstVisit = useMemo<FirstVisit>(
    () => ({
      site_name: form.site_name.trim() || DEFAULT_SITE,
      services: form.services,
      sample_folio: form.sample_folio.trim() || null,
    }),
    [form],
  );

  const validateForm = (): string | null => {
    if (capture.full_name.length < 3) return "Escribe el nombre completo.";
    if (!capture.birth_date) return "Indica la fecha de nacimiento.";
    if (!capture.community) return "Indica la comunidad o municipio.";
    if (form.services.length === 0) return "Selecciona al menos un servicio.";
    return null;
  };

  const autofill = (kind: "recurrente" | "nueva") => {
    setCandidates(null);
    setCreated(null);
    setMsg(null);
    setAskReason(false);
    setForm((f) =>
      kind === "recurrente"
        ? { ...f, full_name: "Ma. Gpe. Hernandez Perez", birth_date: "1988-05-14", birth_state: "Estado de México", community: "San Juan Teotihuacán", phone: "", email: "", sample_folio: `PAP-2026-${String(Date.now()).slice(-4)}` }
        : { ...f, full_name: "Ana Sofía Torres Ruiz", birth_date: "1993-02-11", birth_state: "Puebla", community: "Sierra Norte", phone: "", email: "", sample_folio: "" },
    );
  };

  // ----- Acciones A -----
  const handleSearch = async () => {
    setCreated(null);
    const err = validateForm();
    if (err) return setMsg({ tone: "error", text: err });
    setBusy("search");
    setMsg(null);
    setAskReason(false);
    const r = await api<{ candidates: MatchCandidate[] }>("/api/patients/match", {
      method: "POST",
      body: JSON.stringify(capture),
    });
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "error", text: r.data.error || "No se pudo buscar coincidencias." });
    setCapturedSnapshot(capture);
    setCandidates(r.data.candidates ?? []);
  };

  const queueNewPatient = (confirmReason?: string) => {
    const item: OfflineItem = {
      kind: "new_patient",
      client_uuid: uuid(),
      captured_at: new Date().toISOString(),
      data: capture,
      first_visit: firstVisit,
      ...(confirmReason ? { confirm_new_reason: confirmReason } : {}),
    };
    setQueue((p) => [...p, item]);
    setMsg({ tone: "ok", text: "Captura guardada sin conexión. Se verificarán coincidencias al sincronizar." });
    setForm(EMPTY_FORM);
    setCandidates(null);
  };

  const handleCreate = async (confirmReason?: string) => {
    const err = validateForm();
    if (err) return setMsg({ tone: "error", text: err });
    if (confirmReason !== undefined && confirmReason.trim().length < 10) {
      return setMsg({ tone: "error", text: "Escribe el motivo (mínimo 10 caracteres)." });
    }
    if (offline) return queueNewPatient(confirmReason?.trim());
    setBusy("create");
    setMsg(null);
    const r = await api<{
      patient: PatientHeader;
      pin_code: string;
      visit: Visit | null;
      candidates?: MatchCandidate[];
    }>("/api/patients", {
      method: "POST",
      body: JSON.stringify({
        ...capture,
        ...(confirmReason ? { confirm_new_reason: confirmReason.trim() } : {}),
        first_visit: firstVisit,
      }),
    });
    setBusy(null);
    if (r.status === 409 && r.data.code === "POSSIBLE_DUPLICATE") {
      setCapturedSnapshot(capture);
      setCandidates(r.data.candidates ?? []);
      setMsg({ tone: "warn", text: r.data.error || "Hay posibles duplicados. Revisa las coincidencias antes de crear." });
      return;
    }
    if (!r.ok) {
      if (r.networkError) setMsg({ tone: "error", text: "Sin conexión con el servidor. Activa el modo sin señal para guardar la captura." });
      else setMsg({ tone: "error", text: r.data.error || "No se pudo crear el expediente." });
      return;
    }
    setCreated({ folio: r.data.patient.folio, id: r.data.patient.id, name: r.data.patient.full_name, pin: r.data.pin_code ?? null });
    setCandidates(null);
    setAskReason(false);
    setReason("");
    setMsg(null);
    setForm(EMPTY_FORM);
  };

  const handleConfirmCandidate = async (c: MatchCandidate) => {
    const err = validateForm();
    if (err) return setMsg({ tone: "error", text: err });
    if (offline) {
      setQueue((p) => [
        ...p,
        {
          kind: "visit",
          client_uuid: uuid(),
          captured_at: new Date().toISOString(),
          patient_id: c.patient.id,
          visit: { visit_date: todayIso(), site_name: firstVisit.site_name, community: capture.community, services: firstVisit.services, sample_folio: firstVisit.sample_folio },
        },
      ]);
      setMsg({ tone: "ok", text: "Visita guardada sin conexión; se enviará al sincronizar." });
      return;
    }
    setBusy(`cand-${c.patient.id}`);
    setMsg(null);
    const r = await api<{ visit: Visit; duplicate: boolean }>(`/api/patients/${encodeURIComponent(c.patient.id)}/visits`, {
      method: "POST",
      body: JSON.stringify({
        visit_date: todayIso(),
        site_name: firstVisit.site_name,
        community: capture.community,
        services: firstVisit.services,
        sample_folio: firstVisit.sample_folio,
        client_uuid: uuid(),
        from_match: true,
      }),
    });
    setBusy(null);
    if (!r.ok) return setMsg({ tone: "error", text: r.data.error || "No se pudo registrar la visita." });
    setCandidates(null);
    setForm(EMPTY_FORM);
    openPatient(c.patient.id);
    setVisitMsg({ tone: "ok", text: `Visita registrada en el expediente ${c.patient.folio}.` });
  };

  // ----- Acciones B -----
  const handleSearchPatients = async () => {
    setSearchMsg(null);
    setSearchResults(null);
    if (q.trim().length < 2) return setSearchMsg("Escribe al menos 2 caracteres.");
    setBusy("psearch");
    const r = await api<{ patients: PatientHeader[] }>(`/api/patients?q=${encodeURIComponent(q.trim())}`);
    setBusy(null);
    if (r.status === 403) return setSearchMsg("La búsqueda libre del padrón es para administración; usa Captura y búsqueda.");
    if (!r.ok) return setSearchMsg(r.data.error || "No se pudo buscar.");
    setSearchResults(r.data.patients ?? []);
    if ((r.data.patients ?? []).length === 0) setSearchMsg("Sin resultados.");
  };

  const handleVisit = async () => {
    if (!patientId || !history) return;
    if (visitForm.services.length === 0) return setVisitMsg({ tone: "error", text: "Selecciona al menos un servicio." });
    const visit = {
      visit_date: todayIso(),
      site_name: visitForm.site_name.trim() || DEFAULT_SITE,
      community: history.patient.community,
      services: visitForm.services,
      sample_folio: visitForm.sample_folio.trim() || null,
    };
    if (offline) {
      setQueue((p) => [...p, { kind: "visit", client_uuid: uuid(), captured_at: new Date().toISOString(), patient_id: patientId, visit }]);
      return setVisitMsg({ tone: "ok", text: "Visita guardada sin conexión; se enviará al sincronizar." });
    }
    setBusy("visit");
    setVisitMsg(null);
    const r = await api<{ visit: Visit }>(`/api/patients/${encodeURIComponent(patientId)}/visits`, {
      method: "POST",
      body: JSON.stringify({ ...visit, client_uuid: uuid() }),
    });
    setBusy(null);
    if (!r.ok) return setVisitMsg({ tone: "error", text: r.data.error || "No se pudo registrar la visita." });
    setVisitMsg({ tone: "ok", text: "Visita registrada." });
    setVisitForm((v) => ({ ...v, sample_folio: "" }));
    void loadHistory(patientId);
  };

  const buildChanges = (): Changes => {
    const p = history?.patient;
    const ch: Changes = {};
    if (upd.phone.trim()) ch.phone = upd.phone.trim();
    if (upd.email.trim()) ch.email = upd.email.trim();
    if (p && upd.community.trim() && upd.community.trim() !== p.community) ch.community = upd.community.trim();
    if (p && upd.birth_state && upd.birth_state !== (p.birth_state ?? "")) ch.birth_state = upd.birth_state;
    if (p && upd.preferred_channel && upd.preferred_channel !== p.preferred_channel) ch.preferred_channel = upd.preferred_channel;
    return ch;
  };

  const handleUpdate = async () => {
    if (!patientId || !history) return;
    const changes = buildChanges();
    if (Object.keys(changes).length === 0) return setUpdMsg({ tone: "info", text: "No hay cambios que guardar." });
    const base_version = history.patient.version ?? 1;
    if (offline) {
      setQueue((p) => [...p, { kind: "update", client_uuid: uuid(), captured_at: new Date().toISOString(), patient_id: patientId, base_version, changes }]);
      return setUpdMsg({ tone: "ok", text: "Cambio guardado sin conexión; se enviará al sincronizar." });
    }
    setBusy("update");
    setUpdMsg(null);
    const r = await api<{ patient: PatientHeader; changed_fields: string[]; current?: PatientHeader }>(
      `/api/patients/${encodeURIComponent(patientId)}`,
      { method: "PATCH", body: JSON.stringify({ base_version, changes }) },
    );
    setBusy(null);
    if (r.status === 409 && r.data.code === "VERSION_CONFLICT") {
      setVersionConflict(r.data.current ?? null);
      return setUpdMsg({ tone: "warn", text: "Otro dispositivo modificó este expediente." });
    }
    if (!r.ok) return setUpdMsg({ tone: "error", text: r.data.error || "No se pudo actualizar." });
    setUpdMsg({ tone: "ok", text: `Datos actualizados: ${(r.data.changed_fields ?? []).join(", ") || "sin cambios"}.` });
    void loadHistory(patientId);
  };

  // ----- Sincronización -----
  const handleSync = async () => {
    const toSend = queue.filter((i) => !conflicts[i.client_uuid]);
    if (toSend.length === 0) return setSyncMsg({ tone: "info", text: "No hay elementos nuevos por sincronizar." });
    setSyncing(true);
    setSyncMsg(null);
    const r = await api<{ results: SyncResult[] }>("/api/sync/registrations", {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId || getDeviceId(), items: toSend }),
    });
    setSyncing(false);
    if (!r.ok) {
      return setSyncMsg({ tone: "error", text: r.data.error || "No se pudo sincronizar; la cola se conserva." });
    }
    const results = r.data.results ?? [];
    setSyncResults(results);
    const newConflicts: Record<string, SyncResult> = {};
    const doneIds = new Set<string>();
    for (const res of results) {
      if (res.status === "conflicto") newConflicts[res.client_uuid] = res;
      else if (res.status !== "error") doneIds.add(res.client_uuid);
    }
    setConflicts((c) => ({ ...c, ...newConflicts }));
    setQueue((p) => p.filter((i) => !doneIds.has(i.client_uuid)));
    const n = Object.keys(newConflicts).length;
    const e = results.filter((x) => x.status === "error").length;
    setSyncMsg({
      tone: e || n ? "info" : "ok",
      text: `Sincronización terminada: ${doneIds.size} resuelto(s), ${n} requieren confirmación, ${e} con error.`,
    });
  };

  const removeFromQueue = (id: string) => {
    setQueue((p) => p.filter((i) => i.client_uuid !== id));
    setConflicts((c) => {
      const n = { ...c };
      delete n[id];
      return n;
    });
  };

  const resolveAsExisting = async (item: OfflineItem, cand: MatchCandidate) => {
    if (item.kind !== "new_patient") return;
    setResolveBusy(item.client_uuid);
    setResolveErr((e) => ({ ...e, [item.client_uuid]: "" }));
    const r = await api<{ visit: Visit }>(`/api/patients/${encodeURIComponent(cand.patient.id)}/visits`, {
      method: "POST",
      body: JSON.stringify({
        visit_date: item.captured_at.slice(0, 10),
        site_name: item.first_visit.site_name,
        community: item.data.community,
        services: item.first_visit.services,
        sample_folio: item.first_visit.sample_folio ?? null,
        client_uuid: item.client_uuid,
        from_match: true,
      }),
    });
    setResolveBusy(null);
    if (!r.ok) return setResolveErr((e) => ({ ...e, [item.client_uuid]: r.data.error || "No se pudo registrar la visita." }));
    removeFromQueue(item.client_uuid);
    setSyncMsg({ tone: "ok", text: `Visita registrada en el expediente ${cand.patient.folio}.` });
  };

  const resolveAsNew = async (item: OfflineItem) => {
    if (item.kind !== "new_patient") return;
    const why = (resolveReason[item.client_uuid] ?? "").trim();
    if (why.length < 10) return setResolveErr((e) => ({ ...e, [item.client_uuid]: "Escribe el motivo (mínimo 10 caracteres)." }));
    setResolveBusy(item.client_uuid);
    setResolveErr((e) => ({ ...e, [item.client_uuid]: "" }));
    const r = await api<{ patient: PatientHeader; pin_code: string }>("/api/patients", {
      method: "POST",
      body: JSON.stringify({ ...item.data, confirm_new_reason: why, first_visit: item.first_visit }),
    });
    setResolveBusy(null);
    if (!r.ok) return setResolveErr((e) => ({ ...e, [item.client_uuid]: r.data.error || "No se pudo crear el expediente." }));
    removeFromQueue(item.client_uuid);
    setCreated({ folio: r.data.patient.folio, id: r.data.patient.id, name: r.data.patient.full_name, pin: r.data.pin_code ?? null });
    setTab("captura");
  };

  // ----- Render -----
  const tabBtn = (t: Tab, label: string, icon: React.ReactNode, badge?: number) => (
    <button
      type="button"
      role="tab"
      id={`tab-${t}`}
      aria-selected={tab === t}
      aria-controls={`panel-${t}`}
      onClick={() => setTab(t)}
      className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition sm:text-sm ${
        tab === t ? "bg-eira-600 text-white shadow-md shadow-eira-600/25" : "bg-transparent text-slate-700 hover:bg-eira-50"
      }`}
    >
      {icon}
      <span>{label}</span>
      {badge ? (
        <span className="rounded-full bg-amber-400 px-1.5 text-[11px] font-bold text-amber-950">{badge}</span>
      ) : null}
    </button>
  );

  const conflictItems = queue.filter((i) => conflicts[i.client_uuid]);
  const pendingItems = queue.filter((i) => !conflicts[i.client_uuid]);

  const describeItem = (i: OfflineItem): string => {
    if (i.kind === "new_patient") return `Alta nueva: ${i.data.full_name} (${fmtDate(i.data.birth_date)})`;
    if (i.kind === "visit") return `Visita para paciente ${i.patient_id} · ${i.visit.services.map((s) => SERVICE_LABELS[s]).join(", ")}`;
    return `Actualización de datos de ${i.patient_id}: ${Object.keys(i.changes).join(", ")}`;
  };

  const resultTone = (s: SyncStatus) =>
    s === "conflicto"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : s === "error"
      ? "border-rose-300 bg-rose-50 text-rose-800"
      : s === "ya_sincronizado"
      ? "border-slate-200 bg-slate-50 text-slate-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-900";

  return (
    <div className="min-h-screen bg-transparent text-padi-ink">
      <Navbar onStaffChange={handleStaffChange} />
      <main className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
        {/* Encabezado */}
        <section className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="padi-eyebrow">Reto 1</span>
            <span className="padi-eyebrow">
              Expediente Digital Único
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-padi-plum sm:text-4xl">Registro y Expediente</h1>
          <p className="mt-1 text-sm text-slate-600">
            Reconoce a pacientes recurrentes, registra cada visita por separado y trabaja sin señal. Nunca se vincula
            ni se fusiona nada de forma automática: siempre confirma una persona.
          </p>
          <div
            className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${
              offline ? "border-amber-400 bg-amber-50 text-amber-900" : "border-emerald-400 bg-emerald-50 text-emerald-800"
            }`}
            role="status"
            aria-live="polite"
          >
            {offline ? <WifiOff className="h-4 w-4" aria-hidden="true" /> : <Wifi className="h-4 w-4" aria-hidden="true" />}
            {offline ? "SIN SEÑAL" : "EN LÍNEA"}
          </div>
        </section>

        {sessionLoaded && !allowed && (
          <div role="alert" className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">Sin permisos para esta sección</p>
              <p>
                {staff
                  ? `El rol actual (${staff.role}) no puede usar el registro de pacientes.`
                  : "No hay sesión de personal activa."}{" "}
                Cambia a Promotora Kiosco, EIRA Admin o Laboratorio desde el selector de rol.
              </p>
            </div>
          </div>
        )}

        <div role="tablist" aria-label="Secciones del registro" className="flex gap-1 rounded-full border border-padi-line bg-white p-1.5 shadow-soft">
          {tabBtn("captura", "Captura y búsqueda", <UserPlus className="h-4 w-4" aria-hidden="true" />)}
          {tabBtn("expediente", "Expediente", <FileText className="h-4 w-4" aria-hidden="true" />)}
          {tabBtn("offline", "Sin conexión", <CloudOff className="h-4 w-4" aria-hidden="true" />, queue.length)}
        </div>

        {/* ------------------------------ A ------------------------------ */}
        {tab === "captura" && (
          <section id="panel-captura" role="tabpanel" aria-labelledby="tab-captura" className="space-y-5">
            {created && (
              <div className="rounded-4xl border-2 border-emerald-300 bg-emerald-50 p-6" role="status" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                  <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> Expediente creado: {created.name}
                </p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">Folio (ID EIRA)</p>
                <p className="break-all font-mono text-3xl font-extrabold text-emerald-900 sm:text-4xl">{created.folio}</p>
                {created.pin && (
                  <div className="mt-3 rounded-xl border border-amber-300 bg-white p-3">
                    <p className="flex items-center gap-2 text-xs font-bold text-amber-800">
                      <KeyRound className="h-4 w-4" aria-hidden="true" /> PIN impreso
                    </p>
                    <p className="font-mono text-3xl font-extrabold tracking-widest text-slate-900">{created.pin}</p>
                    <p className="text-xs text-amber-800">Anótalo en la Cartilla EIRA; no se volverá a mostrar.</p>
                  </div>
                )}
                <button type="button" className={`${btnPrimary} mt-3`} onClick={() => openPatient(created.id)}>
                  Ver expediente
                </button>
              </div>
            )}

            <div className={card}>
              <h2 className="text-lg font-bold">Captura (formato en papel EIRA)</h2>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" className={btnSecondary} onClick={() => autofill("recurrente")}>
                  Autollenar paciente recurrente (demo)
                </button>
                <button type="button" className={btnSecondary} onClick={() => autofill("nueva")}>
                  Autollenar paciente nueva (demo)
                </button>
              </div>
              <form
                className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSearch();
                }}
              >
                <div className="sm:col-span-2">
                  <label htmlFor="f-name" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Nombre completo</label>
                  <input id="f-name" className={inp} value={form.full_name} onChange={(e) => setF("full_name", e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label htmlFor="f-dob" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Fecha de nacimiento</label>
                  <input id="f-dob" type="date" className={inp} value={form.birth_date} onChange={(e) => setF("birth_date", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="f-state" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Entidad de nacimiento</label>
                  <select id="f-state" className={inp} value={form.birth_state} onChange={(e) => setF("birth_state", e.target.value)}>
                    <option value="">Selecciona…</option>
                    {ENTIDADES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-phone" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Teléfono (opcional)</label>
                  <input id="f-phone" type="tel" inputMode="tel" className={inp} value={form.phone} onChange={(e) => setF("phone", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="f-email" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Correo (opcional)</label>
                  <input id="f-email" type="email" className={inp} value={form.email} onChange={(e) => setF("email", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="f-comm" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Comunidad / Municipio</label>
                  <input id="f-comm" className={inp} value={form.community} onChange={(e) => setF("community", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="f-site" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Sede / Jornada</label>
                  <input id="f-site" className={inp} value={form.site_name} onChange={(e) => setF("site_name", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <ServicePicker value={form.services} onChange={(v) => setF("services", v)} idPrefix="f-svc" />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="f-folio" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Folio de muestra Pap (opcional)</label>
                  <input id="f-folio" className={inp} placeholder="PAP-2026-110" value={form.sample_folio} onChange={(e) => setF("sample_folio", e.target.value)} />
                </div>
                <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                  {offline ? (
                    <button type="button" className={btnPrimary} disabled={!canWrite || busy !== null} onClick={() => void handleCreate()}>
                      <CloudOff className="h-4 w-4" aria-hidden="true" /> Guardar captura sin conexión
                    </button>
                  ) : (
                    <button type="submit" className={btnPrimary} disabled={!allowed || busy !== null}>
                      <Spin on={busy === "search"} />
                      <Search className="h-4 w-4" aria-hidden="true" /> Buscar coincidencias
                    </button>
                  )}
                </div>
              </form>
              <div aria-live="polite" className="mt-3 space-y-2">
                {offline && <Notice tone="warn">Se verificarán coincidencias al sincronizar. Sin señal no se puede buscar en el padrón.</Notice>}
                {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
              </div>
            </div>

            {candidates !== null && (
              <div className={card} aria-live="polite">
                {candidates.length === 0 ? (
                  <>
                    <h2 className="text-lg font-bold">Sin coincidencias en el padrón</h2>
                    <p className="mt-1 text-sm text-slate-600">No se encontró una paciente parecida. Puedes crear un expediente nuevo.</p>
                    <button type="button" className={`${btnPrimary} mt-3`} disabled={!canWrite || busy !== null} onClick={() => void handleCreate()}>
                      <Spin on={busy === "create"} /> Crear expediente nuevo
                    </button>
                  </>
                ) : (
                  <>
                    <h2 className="flex items-center gap-2 text-lg font-bold">
                      <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" /> {candidates.length} posible(s) coincidencia(s)
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">Compara con cuidado: puede ser una homónima. Tú decides.</p>
                    <div className="mt-3 space-y-3">
                      {candidates.map((c) => (
                        <CandidateCard
                          key={c.patient.id}
                          c={c}
                          captured={capturedSnapshot}
                          busy={busy === `cand-${c.patient.id}`}
                          onConfirm={(x) => void handleConfirmCandidate(x)}
                          confirmLabel="Es ella: registrar visita en su expediente"
                        />
                      ))}
                    </div>
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      {!askReason ? (
                        <button type="button" className={btnSecondary} disabled={!canWrite} onClick={() => setAskReason(true)}>
                          <UserPlus className="h-4 w-4" aria-hidden="true" /> Es otra persona: crear expediente nuevo
                        </button>
                      ) : (
                        <div className="space-y-2">
                          <label htmlFor="f-reason" className="block text-sm font-semibold">
                            Motivo por el que no es ninguna de las coincidencias (mín. 10 caracteres)
                          </label>
                          <textarea id="f-reason" rows={3} className={inp} value={reason} onChange={(e) => setReason(e.target.value)} />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button type="button" className={btnPrimary} disabled={busy !== null || reason.trim().length < 10} onClick={() => void handleCreate(reason)}>
                              <Spin on={busy === "create"} /> Confirmar y crear expediente nuevo
                            </button>
                            <button type="button" className={btnSecondary} onClick={() => setAskReason(false)}>Cancelar</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* ------------------------------ B ------------------------------ */}
        {tab === "expediente" && (
          <section id="panel-expediente" role="tabpanel" aria-labelledby="tab-expediente" className="space-y-5">
            <div className={card}>
              <h2 className="text-lg font-bold">Buscar expediente</h2>
              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSearchPatients();
                }}
              >
                <div className="flex-1">
                  <label htmlFor="q" className="sr-only">Nombre o folio</label>
                  <input id="q" className={inp} placeholder="Nombre o folio (ej. PAC-2026-001)" value={q} onChange={(e) => setQ(e.target.value)} />
                </div>
                <button type="submit" className={btnPrimary} disabled={busy !== null || offline}>
                  <Spin on={busy === "psearch"} /> <Search className="h-4 w-4" aria-hidden="true" /> Buscar
                </button>
              </form>
              <div aria-live="polite" className="mt-2">
                {searchMsg && <Notice tone="warn">{searchMsg}</Notice>}
              </div>
              {searchResults && searchResults.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {searchResults.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-padi-line p-3">
                      <div className="min-w-0 text-sm">
                        <p className="break-words font-bold">{p.full_name}</p>
                        <p className="text-xs text-slate-600">{p.folio} · {fmtDate(p.birth_date)} · {p.community}</p>
                      </div>
                      <button type="button" className={btnSecondary} onClick={() => openPatient(p.id)}>Abrir</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div aria-live="polite">
              {histBusy && <Notice tone="info">Cargando expediente…</Notice>}
              {historyErr && <Notice tone="error">{historyErr}</Notice>}
              {!patientId && !histBusy && <Notice tone="info">Busca una paciente o abre un expediente desde Captura y búsqueda.</Notice>}
            </div>

            {history && (
              <>
                <div className={card}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-eira-600">Folio (ID EIRA)</p>
                  <p className="break-all font-mono text-3xl font-extrabold text-eira-600">{history.patient.folio}</p>
                  <h2 className="mt-1 break-words text-xl font-bold">{history.patient.full_name}</h2>
                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm text-slate-700 sm:grid-cols-2">
                    <div><dt className="inline font-semibold">Nacimiento: </dt><dd className="inline">{fmtDate(history.patient.birth_date)}</dd></div>
                    <div><dt className="inline font-semibold">Entidad: </dt><dd className="inline">{history.patient.birth_state || "—"}</dd></div>
                    <div><dt className="inline font-semibold">Comunidad: </dt><dd className="inline">{history.patient.community}</dd></div>
                    <div><dt className="inline font-semibold">Teléfono: </dt><dd className="inline">{history.patient.phone_masked || "—"}</dd></div>
                    <div><dt className="inline font-semibold">Correo: </dt><dd className="inline">{history.patient.email_masked || "—"}</dd></div>
                    <div><dt className="inline font-semibold">Canal: </dt><dd className="inline">{history.patient.preferred_channel}</dd></div>
                    <div><dt className="inline font-semibold">Versión: </dt><dd className="inline">v{history.patient.version ?? 1}</dd></div>
                  </dl>
                </div>

                <div className={card}>
                  <h2 className="flex items-center gap-2 text-lg font-bold"><History className="h-5 w-5 text-eira-600" aria-hidden="true" /> Línea de tiempo de visitas</h2>
                  {history.visits.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Sin visitas registradas.</p>
                  ) : (
                    <ol className="mt-3 space-y-4 border-l-2 border-eira-200 pl-5">
                      {history.visits.map((v) => (
                        <li key={v.id} className="relative">
                          <span className="absolute -left-[25px] top-1 h-4 w-4 rounded-full border-2 border-eira-600 bg-white ring-4 ring-white" aria-hidden="true" />
                          <p className="text-sm font-bold">{fmtDate(v.visit_date)} · {v.site_name}</p>
                          <div className="mt-1"><Chips services={v.services} /></div>
                          <p className="mt-1 text-xs text-slate-600">
                            {v.sample_folio && <>Muestra Pap: <span className="font-mono font-bold">{v.sample_folio}</span> · </>}
                            Capturó {v.captured_by_name}
                            {v.captured_offline && <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">capturada sin conexión</span>}
                          </p>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div className={card}>
                  <h2 className="text-lg font-bold">Estudios de Papanicolaou asociados</h2>
                  {history.studies.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Aún no hay estudios asociados a este expediente.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {history.studies.map((s) => (
                        <li key={s.id} className="rounded-2xl border border-padi-line p-3 text-sm">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono font-bold">{s.sample_folio}</span>
                            <span className="rounded-full bg-eira-50 px-2.5 py-0.5 text-[11px] font-bold text-eira-700 border border-eira-600">{s.status_label}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">
                            Toma: {fmtDate(s.collection_date)} · {s.site_name} · Prioridad {s.priority}
                          </p>
                          {s.clinical_note_internal && (
                            <p className="mt-1 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">Nota clínica: {s.clinical_note_internal}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className={card}>
                  <h2 className="text-lg font-bold">Registrar nueva visita</h2>
                  <div className="mt-3 space-y-3">
                    <div>
                      <label htmlFor="v-site" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Sede / Jornada</label>
                      <input id="v-site" className={inp} value={visitForm.site_name} onChange={(e) => setVisitForm((v) => ({ ...v, site_name: e.target.value }))} />
                    </div>
                    <ServicePicker value={visitForm.services} onChange={(s) => setVisitForm((v) => ({ ...v, services: s }))} idPrefix="v-svc" />
                    <div>
                      <label htmlFor="v-folio" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Folio de muestra Pap (opcional)</label>
                      <input id="v-folio" className={inp} value={visitForm.sample_folio} onChange={(e) => setVisitForm((v) => ({ ...v, sample_folio: e.target.value }))} />
                    </div>
                    <button type="button" className={btnPrimary} disabled={!canWrite || busy !== null} onClick={() => void handleVisit()}>
                      <Spin on={busy === "visit"} /> {offline ? "Guardar visita sin conexión" : "Registrar visita"}
                    </button>
                    {!canWrite && <Notice tone="warn">Tu rol solo puede consultar; registrar visitas es para promotora o administración.</Notice>}
                    <div aria-live="polite">{visitMsg && <Notice tone={visitMsg.tone}>{visitMsg.text}</Notice>}</div>
                  </div>
                </div>

                <div className={card}>
                  <h2 className="text-lg font-bold">Actualizar datos de contacto</h2>
                  <p className="text-xs text-slate-500">Solo se envían los campos que cambies. Nombre y fecha de nacimiento no se editan aquí.</p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="u-phone" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Teléfono nuevo</label>
                      <input id="u-phone" type="tel" className={inp} placeholder={history.patient.phone_masked || ""} value={upd.phone} onChange={(e) => setUpd((u) => ({ ...u, phone: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="u-email" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Correo nuevo</label>
                      <input id="u-email" type="email" className={inp} placeholder={history.patient.email_masked || ""} value={upd.email} onChange={(e) => setUpd((u) => ({ ...u, email: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="u-comm" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Comunidad</label>
                      <input id="u-comm" className={inp} value={upd.community} onChange={(e) => setUpd((u) => ({ ...u, community: e.target.value }))} />
                    </div>
                    <div>
                      <label htmlFor="u-state" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Entidad de nacimiento</label>
                      <select id="u-state" className={inp} value={upd.birth_state} onChange={(e) => setUpd((u) => ({ ...u, birth_state: e.target.value }))}>
                        <option value="">Sin dato</option>
                        {ENTIDADES.map((s) => (<option key={s} value={s}>{s}</option>))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="u-chan" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-eira-600">Canal preferido</label>
                      <select id="u-chan" className={inp} value={upd.preferred_channel} onChange={(e) => setUpd((u) => ({ ...u, preferred_channel: e.target.value }))}>
                        <option value="sms">SMS</option>
                        <option value="correo">Correo</option>
                        <option value="kiosco_asistido">Kiosco asistido</option>
                      </select>
                    </div>
                  </div>
                  <button type="button" className={`${btnPrimary} mt-3`} disabled={!canWrite || busy !== null} onClick={() => void handleUpdate()}>
                    <Spin on={busy === "update"} /> {offline ? "Guardar cambio sin conexión" : "Guardar cambios"}
                  </button>
                  <div aria-live="polite" className="mt-3 space-y-2">
                    {updMsg && <Notice tone={updMsg.tone}>{updMsg.text}</Notice>}
                    {versionConflict && (
                      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="font-bold">Otro dispositivo modificó este expediente</p>
                        <p className="text-xs">
                          Valores actuales (v{versionConflict.version}): comunidad {versionConflict.community}, entidad {versionConflict.birth_state || "—"}, teléfono {versionConflict.phone_masked || "—"}, canal {versionConflict.preferred_channel}.
                        </p>
                        <button type="button" className={`${btnSecondary} mt-2`} onClick={() => patientId && void loadHistory(patientId)}>
                          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Recargar
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className={card}>
                  <h2 className="text-lg font-bold">Bitácora de cambios</h2>
                  {history.audit.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">Sin movimientos.</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-slate-100">
                      {history.audit.map((a) => (
                        <li key={a.id} className="py-2 text-sm">
                          <p className="font-mono text-xs font-bold text-eira-700">{a.action}</p>
                          <p className="text-xs text-slate-600">{a.actor_name} · {fmtDateTime(a.created_at)}</p>
                          {a.detail && Object.keys(a.detail).length > 0 && (
                            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                              {JSON.stringify(a.detail, null, 1)}
                            </pre>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        )}

        {/* ------------------------------ C ------------------------------ */}
        {tab === "offline" && (
          <section id="panel-offline" role="tabpanel" aria-labelledby="tab-offline" className="space-y-5">
            <div className={card}>
              <h2 className="text-lg font-bold">Modo sin conexión</h2>
              <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-padi-line p-3">
                <div>
                  <p className="text-sm font-semibold" id="sim-label">Simular sin señal</p>
                  <p className="text-xs text-slate-500">
                    Estado real del navegador: {realOnline ? "con red" : "sin red"}. Simulación para la demo.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={simOffline}
                  aria-labelledby="sim-label"
                  onClick={() => setSimOffline((v) => !v)}
                  className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition ${simOffline ? "bg-amber-500" : "bg-eira-200"}`}
                >
                  <span className={`inline-block h-6 w-6 rounded-full shadow transition ${simOffline ? "bg-white translate-x-7" : "bg-eira-600 translate-x-1"}`} />
                </button>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Implementado: cola local en este dispositivo y sincronización real contra la API con idempotencia. Simulado: la pérdida de señal (interruptor).
              </p>
            </div>

            <div className={card}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Users className="h-5 w-5 text-eira-600" aria-hidden="true" /> Cola pendiente ({pendingItems.length})
                </h2>
                <button type="button" className={btnPrimary} disabled={offline || syncing || pendingItems.length === 0 || !canWrite} onClick={() => void handleSync()}>
                  <Spin on={syncing} /> <UploadCloud className="h-4 w-4" aria-hidden="true" /> Sincronizar ahora
                </button>
              </div>
              {offline && <p className="mt-2 text-xs text-amber-700">Sincronizar se habilita al recuperar la señal.</p>}
              {pendingItems.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No hay elementos pendientes.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {pendingItems.map((i) => (
                    <li key={i.client_uuid} className="flex items-start justify-between gap-2 rounded-2xl border border-padi-line p-3 text-sm">
                      <div className="min-w-0">
                        <p className="break-words font-semibold">{describeItem(i)}</p>
                        <p className="text-xs text-slate-500">Capturado {fmtDateTime(i.captured_at)}</p>
                      </div>
                      <button type="button" className="min-h-[44px] shrink-0 rounded-lg px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50" onClick={() => removeFromQueue(i.client_uuid)}>
                        Descartar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div aria-live="polite" className="mt-3">{syncMsg && <Notice tone={syncMsg.tone}>{syncMsg.text}</Notice>}</div>
            </div>

            {syncResults.length > 0 && (
              <div className={card}>
                <h2 className="text-lg font-bold">Resultado de la última sincronización</h2>
                <ul className="mt-3 space-y-2">
                  {syncResults.map((r) => (
                    <li key={r.client_uuid} className={`rounded-xl border p-3 text-sm ${resultTone(r.status)}`}>
                      <p className="font-bold uppercase tracking-wide text-xs">{r.status.replace("_", " ")}{r.folio ? ` · ${r.folio}` : ""}</p>
                      <p>{r.message}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {conflictItems.length > 0 && (
              <div className="rounded-4xl border-2 border-amber-300 bg-amber-50/60 p-5 sm:p-7">
                <h2 className="flex items-center gap-2 text-lg font-bold text-amber-900">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" /> Requiere confirmación ({conflictItems.length})
                </h2>
                <div className="mt-3 space-y-4">
                  {conflictItems.map((item) => {
                    const res = conflicts[item.client_uuid];
                    const cands = res.conflict?.candidates ?? [];
                    const isBusy = resolveBusy === item.client_uuid;
                    return (
                      <div key={item.client_uuid} className="rounded-3xl border border-amber-200 bg-white p-5">
                        <p className="break-words text-sm font-bold">{describeItem(item)}</p>
                        <p className="text-xs text-amber-800">{res.message}</p>
                        {res.conflict?.type === "POSSIBLE_DUPLICATE" && item.kind === "new_patient" && (
                          <>
                            <div className="mt-3 space-y-3">
                              {cands.map((c) => (
                                <CandidateCard
                                  key={c.patient.id}
                                  c={c}
                                  captured={item.data}
                                  busy={isBusy}
                                  onConfirm={(x) => void resolveAsExisting(item, x)}
                                  confirmLabel="Es ella: registrar como visita"
                                />
                              ))}
                            </div>
                            <div className="mt-3 space-y-2">
                              {resolveOpen[item.client_uuid] ? (
                                <>
                                  <label htmlFor={`rs-${item.client_uuid}`} className="block text-sm font-semibold">Motivo (mín. 10 caracteres)</label>
                                  <textarea
                                    id={`rs-${item.client_uuid}`}
                                    rows={2}
                                    className={inp}
                                    value={resolveReason[item.client_uuid] ?? ""}
                                    onChange={(e) => setResolveReason((m) => ({ ...m, [item.client_uuid]: e.target.value }))}
                                  />
                                  <button type="button" className={btnPrimary} disabled={isBusy} onClick={() => void resolveAsNew(item)}>
                                    <Spin on={isBusy} /> Confirmar: crear expediente nuevo
                                  </button>
                                </>
                              ) : (
                                <button type="button" className={btnSecondary} onClick={() => setResolveOpen((m) => ({ ...m, [item.client_uuid]: true }))}>
                                  Es otra persona
                                </button>
                              )}
                            </div>
                          </>
                        )}
                        {res.conflict?.type === "VERSION_CONFLICT" && (
                          <p className="mt-2 text-xs text-slate-700">
                            Otro dispositivo modificó este expediente (versión actual {res.conflict.current?.version ?? "?"}). Revisa el expediente y vuelve a capturar el cambio.
                          </p>
                        )}
                        {resolveErr[item.client_uuid] && <div className="mt-2" aria-live="polite"><Notice tone="error">{resolveErr[item.client_uuid]}</Notice></div>}
                        <button type="button" className="mt-2 min-h-[44px] rounded-lg px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50" onClick={() => removeFromQueue(item.client_uuid)}>
                          Descartar captura
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
