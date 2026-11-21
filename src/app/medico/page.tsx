"use client";

import React, { useRef, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Fingerprint,
  HeartHandshake,
  Lock,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  UserCheck,
  XCircle,
} from "lucide-react";
import Navbar, {
  STAFF_DEMO_ACCOUNTS,
  loginStaffDemoAccount,
  parseStaffFromSession,
} from "@/components/Navbar";
import {
  STATUS_LABELS,
  type IdentityChecklist,
  type StaffUser,
  type StudyPriority,
  type StudyWithPatient,
} from "@/lib/types";

function parseChecklist(raw: string | null): IdentityChecklist | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IdentityChecklist;
  } catch {
    return null;
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const AUTHORIZED_STATUSES = new Set([
  "autorizado_digital",
  "autorizado_acompanado",
  "notificado",
  "consultado",
  "entregado_asistido",
]);

export default function MedicoAuthorizationPage() {
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [roleSwitchError, setRoleSwitchError] = useState<string | null>(null);

  const [studies, setStudies] = useState<StudyWithPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [priority, setPriority] = useState<StudyPriority>("rutinario");
  const [deliveryMode, setDeliveryMode] = useState<"digital" | "acompanado">("digital");
  const [clinicalNote, setClinicalNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<{
    message: string;
    deliveryMode?: "digital" | "acompanado";
  } | null>(null);
  const [pdfReloadKey, setPdfReloadKey] = useState(0);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setStaff(parseStaffFromSession(data));
    } catch {
      // Ignore transient session fetch errors
    }
  }, []);

  // Guards against out-of-order responses (e.g. an initial 401 arriving after the post-login reload).
  const loadSeqRef = useRef(0);
  const loadStudies = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/studies", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        studies?: StudyWithPatient[];
        error?: string;
      };
      if (seq !== loadSeqRef.current) return;
      if (!res.ok) {
        throw new Error(data.error || "No se pudo cargar la cola clínica.");
      }
      setStudies(Array.isArray(data.studies) ? data.studies : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar los estudios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
    void loadStudies();
  }, [loadSession, loadStudies]);

  useEffect(() => {
    const onSessionUpdated = (event: Event) => {
      const custom = event as CustomEvent<{ staff?: StaffUser | null }>;
      if (custom.detail && "staff" in custom.detail) {
        setStaff(custom.detail.staff ?? null);
      } else {
        void loadSession();
      }
      setPdfReloadKey((k) => k + 1);
      setRoleSwitchError(null);
      // Staff APIs need a session: reload the queue whenever the session changes.
      void loadStudies();
    };
    window.addEventListener("eira-session-updated", onSessionUpdated);
    return () => window.removeEventListener("eira-session-updated", onSessionUpdated);
  }, [loadSession, loadStudies]);

  const pendingClinicalStudies = useMemo(
    () => studies.filter((s) => s.status === "pendiente_clinica"),
    [studies]
  );

  const recentlyAuthorizedStudies = useMemo(
    () => studies.filter((s) => AUTHORIZED_STATUSES.has(s.status)),
    [studies]
  );

  const selectedStudy = useMemo(() => {
    const allRelevant = [...pendingClinicalStudies, ...recentlyAuthorizedStudies];
    if (allRelevant.length === 0) return null;
    if (selectedStudyId) {
      const match = allRelevant.find((s) => s.id === selectedStudyId);
      if (match) return match;
    }
    return pendingClinicalStudies[0] ?? recentlyAuthorizedStudies[0] ?? null;
  }, [pendingClinicalStudies, recentlyAuthorizedStudies, selectedStudyId]);

  const selectStudy = (st: StudyWithPatient) => {
    setSelectedStudyId(st.id);
    setPriority(st.priority);
    setDeliveryMode(
      st.delivery_mode ?? (st.priority === "prioritario" ? "acompanado" : "digital")
    );
    setClinicalNote(st.clinical_note_internal ?? "");
    setActionError(null);
  };

  useEffect(() => {
    if (selectedStudy && !selectedStudyId) {
      setPriority(selectedStudy.priority);
      setDeliveryMode(
        selectedStudy.delivery_mode ??
          (selectedStudy.priority === "prioritario" ? "acompanado" : "digital")
      );
      setClinicalNote(selectedStudy.clinical_note_internal ?? "");
    }
  }, [selectedStudy, selectedStudyId]);

  const handleSwitchToDoctor = async () => {
    const doctorAccount = STAFF_DEMO_ACCOUNTS.find((a) => a.role === "medico");
    if (!doctorAccount) return;
    setSwitchingRole(true);
    setRoleSwitchError(null);
    try {
      const next = await loginStaffDemoAccount(doctorAccount);
      setStaff(next);
      setPdfReloadKey((k) => k + 1);
    } catch (err) {
      setRoleSwitchError(err instanceof Error ? err.message : "Error al cambiar a rol Médica.");
    } finally {
      setSwitchingRole(false);
    }
  };

  const isDoctor = staff?.role === "medico";
  const isSelectedPending = selectedStudy?.status === "pendiente_clinica";

  const handleClinicalDecision = async (decision: "aprobado" | "rechazado") => {
    if (!selectedStudy || !isSelectedPending) return;
    const trimmedNote = clinicalNote.trim();

    if (decision === "rechazado" && !trimmedNote) {
      setActionError(
        "Ingresa el motivo en el campo de nota/observación para devolver el estudio a Administración."
      );
      return;
    }

    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const res = await fetch(`/api/studies/${selectedStudy.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "clinica",
          decision,
          priority,
          delivery_mode: deliveryMode,
          comments: trimmedNote,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          payload.error || "No se pudo registrar la decisión clínica."
        );
      }

      if (decision === "aprobado") {
        setActionSuccess({
          message:
            deliveryMode === "acompanado"
              ? `Estudio ${selectedStudy.sample_folio} autorizado en modalidad ACOMPAÑADA. Descarga directa bloqueada y alerta prioritaria activada en Kiosco/Loop.`
              : `Estudio ${selectedStudy.sample_folio} autorizado en modalidad DIGITAL. Aviso neutro emitido y Loop Nivel 1 iniciado.`,
          deliveryMode,
        });
      } else {
        setActionSuccess({
          message: `Estudio ${selectedStudy.sample_folio} devuelto a Administración EIRA con motivo registrado.`,
        });
      }

      setClinicalNote("");
      setSelectedStudyId(null);
      await loadStudies();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : "Error inesperado durante la autorización clínica."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-padi-ink">
      <Navbar onStaffChange={setStaff} />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Page Header */}
        <section className="rounded-4xl border-[1.5px] border-padi-line bg-white p-6 sm:p-8 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <div className="padi-eyebrow">
                <Stethoscope className="h-3.5 w-3.5" aria-hidden="true" />
                Compuerta 2 · Validación y Autorización Clínica
              </div>
              <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-padi-plum">
                Autorización Médica y Modalidad de Entrega
              </h1>
              <p className="mt-1 text-sm text-padi-ink max-w-3xl">
                Ningún resultado llega a la paciente sin autorización clínica previa. El personal médico clasifica la prioridad, decide si procede entrega digital directa o acompañamiento humano, y activa el motor Closed-Loop con mensajes 100% neutros.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadStudies()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full min-h-[44px] border-2 border-eira-600 bg-white px-5 py-2 text-xs font-bold text-eira-600 hover:bg-eira-600 hover:text-white/60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Actualizar cola
              </button>
              <Link
                href="/alertas-loop"
                className="inline-flex items-center gap-1.5 rounded-full min-h-[44px] border-2 border-eira-600 bg-white px-5 py-2 text-xs font-bold text-eira-600 hover:bg-eira-600 hover:text-white"
              >
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                Ver Motor Closed-Loop
              </Link>
            </div>
          </div>
        </section>

        {/* Role Gate Banner */}
        {!isDoctor && (
          <section
            role="status"
            className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5 text-xs text-emerald-950">
              <ShieldAlert className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold">
                  Autorización Clínica restringida a Personal Médico (`medico`)
                </p>
                <p className="mt-0.5">
                  Rol actual:{" "}
                  <strong>{staff ? `${staff.name} (${staff.role})` : "Sin sesión"}</strong>.
                  Cambia con 1 clic a la Dra. Elena Ramírez (Cédula CED-8472910) para firmar Compuerta 2.
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={switchingRole}
              onClick={() => void handleSwitchToDoctor()}
              className="inline-flex items-center gap-1.5 rounded-full min-h-[48px] bg-eira-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-eira-700 disabled:opacity-60"
            >
              <Stethoscope className="h-4 w-4" aria-hidden="true" />
              {switchingRole
                ? "Cambiando sesión..."
                : "Cambiar a Dra. Elena Ramírez (Médica)"}
            </button>
          </section>
        )}

        {roleSwitchError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-800">
            {roleSwitchError}
          </div>
        )}

        {loadError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
            {loadError}
          </div>
        )}

        {actionSuccess && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-2 text-xs font-semibold text-emerald-950">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
              <span>{actionSuccess.message}</span>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {actionSuccess.deliveryMode === "acompanado" ? (
                <Link
                  href="/kiosco"
                  className="inline-flex items-center gap-1 rounded-2xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                >
                  <span>Ver alerta en Kiosco</span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              ) : (
                <Link
                  href="/paciente"
                  className="inline-flex items-center gap-1 rounded-full min-h-[48px] bg-eira-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-eira-700"
                >
                  <span>Probar Portal Paciente</span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              )}
              <Link
                href="/alertas-loop"
                className="inline-flex items-center gap-1 rounded-2xl border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
              >
                <span>Ver Loop / LoRa</span>
              </Link>
            </div>
          </div>
        )}

        {/* Queue Selection Strip */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <aside className="lg:col-span-4 space-y-4">
            {/* Pending clinical authorization */}
            <div className="rounded-3xl border-[1.5px] border-padi-line bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-padi-plum">
                  Pendientes de Autorización
                </h2>
                <span className="rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-[11px] font-bold text-amber-900">
                  {pendingClinicalStudies.length}
                </span>
              </div>

              {loading ? (
                <div className="h-20 animate-pulse rounded-2xl bg-padi-blush/60" />
              ) : pendingClinicalStudies.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-padi-line bg-padi-blush/60 p-4 text-center text-xs text-padi-muted">
                  Sin estudios pendientes en Compuerta 2.
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingClinicalStudies.map((st) => {
                    const isSelected = selectedStudy?.id === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => selectStudy(st)}
                        className={`w-full text-left rounded-2xl border p-3 transition ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500"
                            : "border-padi-line bg-padi-blush/60 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-extrabold text-padi-plum">
                            {st.sample_folio}
                          </span>
                          <span className="rounded-full bg-amber-100 text-amber-900 border border-amber-200 px-2 py-0.5 text-[10px] font-bold">
                            Por autorizar
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold text-padi-plum">
                          {st.patient?.full_name || "Paciente asociada"}
                        </p>
                        <p className="text-[11px] text-padi-muted">
                          {st.patient?.folio} · {st.community}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Recently authorized */}
            <div className="rounded-3xl border-[1.5px] border-padi-line bg-white p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-padi-plum">
                  Autorizados Recientemente
                </h2>
                <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                  {recentlyAuthorizedStudies.length}
                </span>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {recentlyAuthorizedStudies.map((st) => {
                  const isSelected = selectedStudy?.id === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => selectStudy(st)}
                      className={`w-full text-left rounded-2xl border p-2.5 transition ${
                        isSelected
                          ? "border-eira-500 bg-eira-50/60 ring-1 ring-eira-500"
                          : "border-padi-line bg-white hover:bg-padi-blush/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-padi-plum">
                          {st.sample_folio}
                        </span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            st.delivery_mode === "acompanado"
                              ? "bg-eira-50 text-eira-700 border-eira-200"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200"
                          }`}
                        >
                          {st.delivery_mode === "acompanado" ? "Acompañado" : "Digital"}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-padi-plum truncate">
                        {st.patient?.full_name || "—"}
                      </p>
                      <p className="text-[11px] text-padi-muted">
                        {STATUS_LABELS[st.status]}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>

          {/* Main Split View: Left PDF Preview + Right Identity Summary & Clinical Form */}
          <div className="lg:col-span-8">
            {!selectedStudy ? (
              <div className="rounded-3xl border-2 border-dashed border-padi-pale bg-white p-12 text-center">
                <Stethoscope className="mx-auto h-8 w-8 text-padi-muted" aria-hidden="true" />
                <p className="mt-2 text-sm font-bold text-padi-plum">
                  Selecciona un estudio para inspeccionar
                </p>
              </div>
            ) : (
              <div className="rounded-3xl border-[1.5px] border-padi-line bg-white shadow-sm overflow-hidden">
                {/* Split Header */}
                <div className="border-b border-padi-line bg-padi-blush/60 px-5 py-3.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-extrabold text-padi-plum">
                      {selectedStudy.sample_folio}
                    </span>
                    <span className="rounded-md bg-white border border-padi-line px-2 py-0.5 font-mono text-xs text-padi-ink">
                      {selectedStudy.pseudonym_code}
                    </span>
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                        isSelectedPending
                          ? "bg-amber-50 text-amber-800 border-amber-300"
                          : "bg-emerald-50 text-emerald-800 border-emerald-200"
                      }`}
                    >
                      {STATUS_LABELS[selectedStudy.status]}
                    </span>
                  </div>

                  <a
                    href={`/api/studies/${selectedStudy.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-full min-h-[44px] border-2 border-eira-600 bg-white px-4 py-2 text-xs text-eira-600 hover:bg-eira-600 hover:text-white font-bold font-semibold text-padi-ink hover:bg-padi-blush/60"
                  >
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    Abrir PDF completo
                  </a>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-12">
                  {/* LEFT PANE: PDF Preview */}
                  <div className="xl:col-span-6 border-b xl:border-b-0 xl:border-r border-padi-line bg-padi-blush/60 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-padi-plum">
                      <FileText className="h-4 w-4 text-eira-600" aria-hidden="true" />
                      <span>Resultado Citológico Privado</span>
                    </div>

                    <div className="rounded-2xl border border-padi-line bg-white overflow-hidden shadow-inner">
                      <iframe
                        key={`${selectedStudy.id}-${pdfReloadKey}`}
                        src={`/api/studies/${selectedStudy.id}/pdf`}
                        title={`PDF clínico ${selectedStudy.sample_folio}`}
                        className="w-full h-[460px]"
                      />
                    </div>

                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[11px] flex items-center gap-2 text-emerald-900">
                      <Fingerprint className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
                      <span className="font-mono truncate">
                        SHA-256: {selectedStudy.pdf_sha256 || "Verificado"}
                      </span>
                    </div>
                  </div>

                  {/* RIGHT PANE: Identity Summary + Clinical Authorization Form */}
                  <div className="xl:col-span-6 p-4 sm:p-5 space-y-4">
                    {/* Patient Identity Verification Summary */}
                    <div className="rounded-2xl border border-padi-line bg-padi-blush/60 p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-bold text-padi-plum">
                          <UserCheck className="h-4 w-4 text-eira-600" aria-hidden="true" />
                          Resumen de Identidad Verificada
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[10px] font-bold">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          Compuerta 1 OK
                        </span>
                      </div>

                      {selectedStudy.patient && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div className="col-span-2">
                            <span className="text-[11px] text-padi-muted block">Paciente</span>
                            <span className="text-sm font-bold text-padi-plum">
                              {selectedStudy.patient.full_name}
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] text-padi-muted block">Folio / Nac.</span>
                            <span className="font-mono font-semibold text-padi-plum">
                              {selectedStudy.patient.folio} · {selectedStudy.patient.birth_date}
                            </span>
                          </div>
                          <div>
                            <span className="text-[11px] text-padi-muted block">Comunidad / Canal</span>
                            <span className="font-semibold text-padi-plum">
                              {selectedStudy.patient.community} ({selectedStudy.patient.preferred_channel})
                            </span>
                          </div>
                        </div>
                      )}

                      {(() => {
                        const checklist = parseChecklist(selectedStudy.identity_checklist_json);
                        return (
                          <div className="pt-2 border-t border-padi-line/80 text-[11px] text-padi-ink flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1">
                              <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              Revisión Admin:{" "}
                              <strong className="text-padi-plum">
                                {selectedStudy.admin_reviewed_by || checklist?.verified_by || "Verificada"}
                              </strong>
                            </span>
                            {selectedStudy.admin_reviewed_at && (
                              <span>{formatDateTime(selectedStudy.admin_reviewed_at)}</span>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {isSelectedPending ? (
                      <div className="space-y-4">
                        {/* Priority Selector */}
                        <div>
                          <span className="block text-xs font-bold text-padi-plum mb-1.5">
                            1. Prioridad clínica de seguimiento
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setPriority("rutinario")}
                              className={`rounded-2xl border p-2.5 text-left transition ${
                                priority === "rutinario"
                                  ? "border-emerald-500 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-500"
                                  : "border-padi-line bg-white text-padi-ink hover:bg-padi-blush/60"
                              }`}
                            >
                              <p className="text-xs font-bold">Rutinario</p>
                              <p className="text-[11px] text-padi-muted">
                                Seguimiento estándar (0h–72h)
                              </p>
                            </button>

                            <button
                              type="button"
                              onClick={() => setPriority("prioritario")}
                              className={`rounded-2xl border p-2.5 text-left transition ${
                                priority === "prioritario"
                                  ? "border-eira-500 bg-eira-50 text-eira-950 ring-1 ring-eira-500"
                                  : "border-padi-line bg-white text-padi-ink hover:bg-padi-blush/60"
                              }`}
                            >
                              <p className="text-xs font-bold">Prioritario</p>
                              <p className="text-[11px] text-padi-muted">
                                Escalamiento rápido (24h–48h)
                              </p>
                            </button>
                          </div>
                        </div>

                        {/* Delivery Mode Selector */}
                        <div>
                          <span className="block text-xs font-bold text-padi-plum mb-1.5">
                            2. Modalidad de entrega a la paciente
                          </span>
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() => setDeliveryMode("digital")}
                              className={`w-full rounded-2xl border p-3 text-left transition flex items-start gap-2.5 ${
                                deliveryMode === "digital"
                                  ? "border-emerald-500 bg-emerald-50/70 ring-1 ring-emerald-500"
                                  : "border-padi-line bg-white hover:bg-padi-blush/60"
                              }`}
                            >
                              <Smartphone
                                className={`h-4 w-4 mt-0.5 shrink-0 ${
                                  deliveryMode === "digital" ? "text-emerald-600" : "text-padi-muted"
                                }`}
                                aria-hidden="true"
                              />
                              <div className="text-xs">
                                <p className="font-bold text-padi-plum">
                                  Entrega Digital (Portal / Kiosco estándar)
                                </p>
                                <p className="text-[11px] text-padi-ink mt-0.5">
                                  Libera descarga autenticada en Portal Paciente + envía aviso neutro sin diagnósticos.
                                </p>
                              </div>
                            </button>

                            <button
                              type="button"
                              onClick={() => setDeliveryMode("acompanado")}
                              className={`w-full rounded-2xl border p-3 text-left transition flex items-start gap-2.5 ${
                                deliveryMode === "acompanado"
                                  ? "border-eira-500 bg-eira-50/70 ring-1 ring-eira-500"
                                  : "border-padi-line bg-white hover:bg-padi-blush/60"
                              }`}
                            >
                              <HeartHandshake
                                className={`h-4 w-4 mt-0.5 shrink-0 ${
                                  deliveryMode === "acompanado" ? "text-eira-600" : "text-padi-muted"
                                }`}
                                aria-hidden="true"
                              />
                              <div className="text-xs">
                                <p className="font-bold text-padi-plum">
                                  Entrega Acompañada (Orientación médica humana)
                                </p>
                                <p className="text-[11px] text-padi-ink mt-0.5">
                                  Bloquea la descarga sola en el portal y activa alerta prioritaria para acompañamiento en Kiosco/Promotora.
                                </p>
                              </div>
                            </button>
                          </div>
                        </div>

                        {deliveryMode === "acompanado" && (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                            <span>
                              Al autorizar como <strong>Entrega Acompañada</strong>, el sistema protegerá a la paciente impidiendo la descarga desatendida del PDF y priorizará la cita con Promotora/Médica.
                            </span>
                          </div>
                        )}

                        {/* Internal Clinical Note */}
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                            <label
                              htmlFor="clinical-internal-note"
                              className="text-xs font-bold text-padi-plum"
                            >
                              3. Nota clínica interna (o motivo de devolución)
                            </label>
                            <span className="inline-flex items-center gap-1 rounded-full bg-eira-50 border border-eira-200 px-2 py-0.5 text-[10px] font-bold text-eira-700">
                              <Lock className="h-2.5 w-2.5" aria-hidden="true" />
                              Solo uso interno — NUNCA se incluye en notificaciones
                            </span>
                          </div>
                          <textarea
                            id="clinical-internal-note"
                            rows={3}
                            value={clinicalNote}
                            onChange={(e) => {
                              setClinicalNote(e.target.value);
                              setActionError(null);
                            }}
                            placeholder="Ej. Citología dentro de límites normales, liberar digitalmente. / O bien: Hallazgo que requiere orientación médica acompañada..."
                            className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-xs text-padi-plum placeholder:text-padi-muted focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                          />
                        </div>

                        {actionError && (
                          <div
                            role="alert"
                            className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
                          >
                            {actionError}
                          </div>
                        )}

                        <div className="flex flex-col gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!isDoctor || submitting}
                            onClick={() => void handleClinicalDecision("aprobado")}
                            className="inline-flex items-center justify-center gap-2 rounded-full min-h-[48px] bg-eira-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm hover:bg-eira-700 disabled:cursor-not-allowed disabled:bg-padi-pale disabled:text-padi-muted"
                          >
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {submitting ? "Autorizando..." : "Autorizar y Activar Loop"}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={!isDoctor || submitting}
                            onClick={() => void handleClinicalDecision("rechazado")}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            <span>Devolver a Administración</span>
                          </button>

                          {!isDoctor && (
                            <p className="text-[11px] text-emerald-800 font-medium text-center flex items-center justify-center gap-1">
                              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              Cambia al rol Dra. Elena Ramírez (Médica) arriba para autorizar.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      /* Read-only traceability card for already-authorized studies */
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-2.5 text-xs">
                        <div className="flex items-center gap-2 font-bold text-emerald-900">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                          <span>Estudio ya autorizado en Compuerta 2</span>
                        </div>
                        <p className="text-emerald-900">
                          Autorizó: <strong>{selectedStudy.clinical_authorized_by || "—"}</strong>
                        </p>
                        <p className="text-emerald-800">
                          Fecha: {formatDateTime(selectedStudy.clinical_authorized_at)}
                        </p>
                        <p className="text-emerald-900">
                          Modalidad:{" "}
                          <strong>
                            {selectedStudy.delivery_mode === "acompanado"
                              ? "Entrega Acompañada (descarga sola bloqueada)"
                              : "Entrega Digital"}
                          </strong>{" "}
                          · Prioridad: <strong>{selectedStudy.priority}</strong>
                        </p>
                        {selectedStudy.clinical_note_internal && (
                          <div className="rounded-2xl border border-emerald-200 bg-white p-3">
                            <p className="inline-flex items-center gap-1 text-[11px] font-bold text-eira-700">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              Nota clínica interna (nunca enviada en avisos)
                            </p>
                            <p className="mt-1 text-padi-plum">
                              {selectedStudy.clinical_note_internal}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
