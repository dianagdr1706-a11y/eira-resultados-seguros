"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FileText,
  Fingerprint,
  MapPin,
  MessageSquare,
  Search,
  ShieldAlert,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import type { ContactChannel, Patient, StudyWithPatient } from "@/lib/types";

export type PublicPatient = Omit<Patient, "pin_code">;

interface SideBySideAssociatorProps {
  study: StudyWithPatient;
  onClose: () => void;
  onSuccess: () => void;
}

const CHANNEL_META: Record<ContactChannel, { label: string; badgeClass: string }> = {
  sms: {
    label: "SMS neutro",
    badgeClass: "bg-eira-50 text-eira-700 border-eira-200",
  },
  correo: {
    label: "Correo neutro",
    badgeClass: "bg-eira-50 text-eira-700 border-eira-200",
  },
  kiosco_asistido: {
    label: "Kiosco asistido (sin celular)",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
  },
};

interface SuggestedPatientInfo {
  patient: { id: string; folio: string; full_name: string; birth_date: string; community: string };
  visit?: { visit_date?: string; site_name?: string; sample_folio?: string | null };
  reason?: string;
}

function normalizeTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["del", "las", "los"].includes(token));
}

function areNearHomonyms(a: string, b: string): boolean {
  const tokensA = normalizeTokens(a);
  const tokensB = normalizeTokens(b);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const setB = new Set(tokensB);
  let exactOverlap = 0;
  for (const t of tokensA) {
    if (setB.has(t)) exactOverlap += 1;
  }

  if (exactOverlap >= 2) return true;

  // Also flag same first name + similar surname prefix (e.g. Perez vs Peralta)
  if (tokensA[0] === tokensB[0] && tokensA.length >= 2 && tokensB.length >= 2) {
    for (const ta of tokensA.slice(1)) {
      for (const tb of tokensB.slice(1)) {
        if (ta.length >= 4 && tb.length >= 4 && ta.slice(0, 3) === tb.slice(0, 3)) {
          return true;
        }
      }
    }
  }

  return false;
}

function detectHomonymIds(patients: PublicPatient[]): Set<string> {
  const flagged = new Set<string>();
  for (let i = 0; i < patients.length; i += 1) {
    for (let j = i + 1; j < patients.length; j += 1) {
      if (areNearHomonyms(patients[i].full_name, patients[j].full_name)) {
        flagged.add(patients[i].id);
        flagged.add(patients[j].id);
      }
    }
  }
  return flagged;
}

function parsePatientsPayload(data: unknown): PublicPatient[] {
  if (Array.isArray(data)) return data as PublicPatient[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.patients)) return obj.patients as PublicPatient[];
    if (Array.isArray(obj.items)) return obj.items as PublicPatient[];
  }
  return [];
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "PDF privado";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function SideBySideAssociator({
  study,
  onClose,
  onSuccess,
}: SideBySideAssociatorProps) {
  const [query, setQuery] = useState("");
  const [directoryPatients, setDirectoryPatients] = useState<PublicPatient[]>([]);
  const [patients, setPatients] = useState<PublicPatient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [patientsError, setPatientsError] = useState<string | null>(null);

  const [selectedPatient, setSelectedPatient] = useState<PublicPatient | null>(null);
  const [nameMatches, setNameMatches] = useState(false);
  const [dobOrFolioMatches, setDobOrFolioMatches] = useState(false);
  const [pdfLegibleComplete, setPdfLegibleComplete] = useState(false);
  const [notes, setNotes] = useState("");
  const [suggestion, setSuggestion] = useState<SuggestedPatientInfo | null>(null);
  const [discordanceAck, setDiscordanceAck] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedSha, setCopiedSha] = useState(false);
  const [pdfReloadKey, setPdfReloadKey] = useState(0);

  useEffect(() => {
    const onSessionUpdated = () => setPdfReloadKey((k) => k + 1);
    window.addEventListener("eira-session-updated", onSessionUpdated);
    return () => window.removeEventListener("eira-session-updated", onSessionUpdated);
  }, []);

  const fetchPatients = useCallback(async (searchText: string, isInitial = false) => {
    setLoadingPatients(true);
    setPatientsError(null);
    try {
      const encoded = encodeURIComponent(searchText.trim());
      const res = await fetch(`/api/patients?q=${encoded}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          data && typeof data === "object" && "error" in data
            ? String((data as { error?: string }).error)
            : "No se pudo consultar el padrón de pacientes.";
        throw new Error(msg);
      }
      const list = parsePatientsPayload(data);
      setPatients(list);
      if (isInitial) {
        setDirectoryPatients(list);
      }
    } catch (err) {
      setPatientsError(
        err instanceof Error ? err.message : "Error al buscar pacientes."
      );
    } finally {
      setLoadingPatients(false);
    }
  }, []);

  useEffect(() => {
    void fetchPatients("", true);
  }, [fetchPatients]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchPatients(query, false);
    }, 220);
    return () => clearTimeout(timer);
  }, [query, fetchPatients]);

  // Reto 1: suggestion from the Expediente Unico (never auto-associates; hidden on any failure).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/studies/${study.id}/suggested-patient`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as {
          suggestion?: SuggestedPatientInfo | null;
        };
        if (cancelled || !res.ok) return;
        const sug = data.suggestion;
        setSuggestion(sug && sug.patient && sug.patient.id ? sug : null);
      } catch {
        if (!cancelled) setSuggestion(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [study.id]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose, submitting]);

  const homonymIds = useMemo(() => {
    const combinedMap = new Map<string, PublicPatient>();
    for (const p of directoryPatients) combinedMap.set(p.id, p);
    for (const p of patients) combinedMap.set(p.id, p);
    return detectHomonymIds(Array.from(combinedMap.values()));
  }, [directoryPatients, patients]);

  const visibleHomonymCount = useMemo(
    () => patients.filter((p) => homonymIds.has(p.id)).length,
    [patients, homonymIds]
  );

  const selectedIsHomonym = selectedPatient ? homonymIds.has(selectedPatient.id) : false;

  const isDiscordant = Boolean(
    suggestion && selectedPatient && selectedPatient.id !== suggestion.patient.id
  );

  const isChecklistComplete =
    Boolean(selectedPatient) &&
    nameMatches &&
    dobOrFolioMatches &&
    pdfLegibleComplete &&
    (!isDiscordant || discordanceAck);

  const handleCopySha = async () => {
    if (!study.pdf_sha256 || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(study.pdf_sha256);
      setCopiedSha(true);
      setTimeout(() => setCopiedSha(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleSelectPatient = (patient: PublicPatient) => {
    if (selectedPatient?.id !== patient.id) {
      setSelectedPatient(patient);
      // Reset explicit confirmation checkboxes when changing selected patient to prevent accidental carry-over
      setNameMatches(false);
      setDobOrFolioMatches(false);
      setPdfLegibleComplete(false);
      setDiscordanceAck(false);
      setSubmitError(null);
    }
  };

  const handleSelectSuggested = async () => {
    if (!suggestion) return;
    const sp = suggestion.patient;
    let found =
      patients.find((p) => p.id === sp.id) ?? directoryPatients.find((p) => p.id === sp.id);
    if (!found) {
      try {
        const res = await fetch(`/api/patients?q=${encodeURIComponent(sp.folio)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) found = parsePatientsPayload(data).find((p) => p.id === sp.id);
      } catch {
        // fall back to suggestion data below
      }
    }
    const patient: PublicPatient =
      found ??
      ({
        id: sp.id,
        folio: sp.folio,
        full_name: sp.full_name,
        birth_date: sp.birth_date,
        community: sp.community,
        preferred_channel: "kiosco_asistido",
      } as unknown as PublicPatient);
    setPatients((prev) => (prev.some((p) => p.id === patient.id) ? prev : [patient, ...prev]));
    handleSelectPatient(patient);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient || !isChecklistComplete || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const trimmedNotes = notes.trim();
      const res = await fetch(`/api/studies/${study.id}/associate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: selectedPatient.id,
          checklist: {
            name_matches: nameMatches,
            dob_or_folio_matches: dobOrFolioMatches,
            pdf_legible_complete: pdfLegibleComplete,
            notes: trimmedNotes || undefined,
          },
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          payload.error ||
            "No se pudo completar la asociación. Verifica tu rol activo (Laboratorio o EIRA Admin)."
        );
      }
      onSuccess();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Error inesperado al asociar el estudio."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="associator-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-padi-plum/60 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto"
    >
      <div className="my-auto w-full max-w-7xl rounded-4xl border-[1.5px] border-padi-line bg-white shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-padi-line bg-gradient-to-r from-eira-50 via-white to-padi-blush px-6 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-eira-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                Cotejo Anti-Homonimia
              </span>
              <h2 id="associator-title" className="text-base sm:text-lg font-bold text-padi-plum">
                Asociación Verificada Lado a Lado · {study.sample_folio}
              </h2>
              <span className="rounded-md bg-padi-blush/60 border border-padi-line px-2 py-0.5 font-mono text-xs text-padi-ink">
                {study.pseudonym_code}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-padi-ink">
              Nunca se asocia automáticamente por nombre. Coteja el documento escaneado contra mínimo 3 atributos del expediente.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar ventana de asociación"
            className="inline-flex items-center gap-1 rounded-2xl border border-padi-line bg-white px-3 py-1.5 text-xs font-semibold text-padi-ink hover:bg-padi-blush/60 disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
            <span>Cerrar</span>
          </button>
        </div>

        {/* Split Workspace */}
        <div className="grid grid-cols-1 lg:grid-cols-12 overflow-y-auto flex-1">
          {/* LEFT PANE: Authenticated PDF Preview & SHA-256 */}
          <div className="lg:col-span-6 border-b lg:border-b-0 lg:border-r border-padi-line bg-padi-blush/60 p-4 sm:p-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-eira-600" aria-hidden="true" />
                <h3 className="text-sm font-bold text-padi-plum">
                  Documento PDF Privado (Endpoint Autenticado)
                </h3>
              </div>
              <a
                href={`/api/studies/${study.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-padi-line bg-white px-2.5 py-1 text-[11px] font-semibold text-padi-ink hover:border-eira-200 hover:text-eira-700"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Abrir PDF aparte
              </a>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-2xl border border-padi-line bg-white p-3 text-xs">
              <div>
                <span className="text-[11px] text-padi-muted block">Folio muestra</span>
                <span className="font-mono font-bold text-padi-plum">{study.sample_folio}</span>
              </div>
              <div>
                <span className="text-[11px] text-padi-muted block">Fecha toma</span>
                <span className="font-semibold text-padi-plum">{study.collection_date}</span>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <span className="text-[11px] text-padi-muted block">Sede / Comunidad</span>
                <span className="font-semibold text-padi-plum truncate block" title={`${study.site_name} · ${study.community}`}>
                  {study.community}
                </span>
              </div>
            </div>

            <div className="relative flex-1 min-h-[380px] lg:min-h-[460px] rounded-2xl border border-padi-line bg-white overflow-hidden shadow-inner">
              <iframe
                key={`${study.id}-${pdfReloadKey}`}
                src={`/api/studies/${study.id}/pdf`}
                title={`Visor PDF de estudio ${study.sample_folio}`}
                className="h-full w-full min-h-[380px] lg:min-h-[460px]"
              />
            </div>

            {/* SHA-256 Integrity Bar */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Fingerprint className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[11px] font-bold text-emerald-900">
                    Integridad SHA-256 · {formatBytes(study.pdf_size_bytes)}
                  </p>
                  <p className="font-mono text-[11px] text-emerald-800 truncate max-w-[300px] sm:max-w-[420px]">
                    {study.pdf_sha256 || "Hash calculado al almacenar en repositorio privado"}
                  </p>
                </div>
              </div>
              {study.pdf_sha256 && (
                <button
                  type="button"
                  onClick={() => void handleCopySha()}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  <Copy className="h-3 w-3" aria-hidden="true" />
                  {copiedSha ? "Copiado" : "Copiar hash"}
                </button>
              )}
            </div>
          </div>

          {/* RIGHT PANE: Multi-attribute Patient Search + Homonym Detection + 3-Box Checklist */}
          <form onSubmit={handleSubmit} className="lg:col-span-6 p-4 sm:p-5 flex flex-col gap-4 bg-white">
            {/* Search Box */}
            <div>
              <label
                htmlFor="patient-search-input"
                className="block text-sm font-bold text-padi-plum"
              >
                1. Buscar paciente por múltiples atributos
              </label>
              <p className="text-xs text-padi-muted mt-0.5">
                Busca por nombre completo, folio (ej. <code className="text-padi-ink">PAC-2026-001</code>), fecha de nacimiento o comunidad.
              </p>
              <div className="relative mt-2">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-padi-muted"
                  aria-hidden="true"
                />
                <input
                  id="patient-search-input"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ej. María Guadalupe, PAC-2026-001, Teotihuacán, 1988-05-14..."
                  className="w-full rounded-2xl border border-padi-line bg-white pl-9 pr-3 py-2.5 text-sm text-padi-plum placeholder:text-padi-muted focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                />
              </div>
            </div>

            {/* Reto 1: Expediente Unico suggestion */}
            {suggestion && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 flex items-start gap-2.5"
              >
                <Sparkles className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs leading-relaxed space-y-1.5">
                  <p>
                    <strong>Sugerencia del Expediente Único (Reto 1):</strong> el folio de muestra{" "}
                    <span className="font-mono font-semibold">
                      {suggestion.visit?.sample_folio || study.sample_folio}
                    </span>{" "}
                    se registró en la visita del{" "}
                    <strong>{suggestion.visit?.visit_date ?? "—"}</strong> de{" "}
                    <strong>{suggestion.patient.full_name}</strong> ({suggestion.patient.folio}) en{" "}
                    {suggestion.visit?.site_name ?? "sede no indicada"}.
                  </p>
                  <p className="text-emerald-800">
                    Es solo una sugerencia: el cotejo humano de 3 puntos sigue siendo obligatorio.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleSelectSuggested()}
                    disabled={selectedPatient?.id === suggestion.patient.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-eira-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-teal-700 disabled:bg-teal-300"
                  >
                    <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {selectedPatient?.id === suggestion.patient.id
                      ? "Paciente sugerida seleccionada"
                      : "Seleccionar a esta paciente"}
                  </button>
                </div>
              </div>
            )}

            {/* Homonym Alert Banner */}
            {(visibleHomonymCount > 0 || selectedIsHomonym) && (
              <div
                role="alert"
                className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-950 flex items-start gap-2.5"
              >
                <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="text-xs leading-relaxed">
                  <p className="font-bold text-amber-900">
                    ¡Alerta de riesgo de homonimia detectado!
                  </p>
                  <p className="mt-0.5">
                    Existen pacientes con nombres o apellidos muy similares en el padrón. Coteja obligatoriamente{" "}
                    <strong>Folio</strong>, <strong>Fecha de Nacimiento</strong> y{" "}
                    <strong>Comunidad</strong> contra el PDF antes de marcar la verificación.
                  </p>
                </div>
              </div>
            )}

            {/* Patient Search Results */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-padi-muted">
                <span className="font-semibold text-padi-ink">
                  Resultados del padrón ({patients.length})
                </span>
                {selectedPatient && (
                  <span className="inline-flex items-center gap-1 font-semibold text-eira-700">
                    <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Seleccionada: {selectedPatient.folio}
                  </span>
                )}
              </div>

              {patientsError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {patientsError}
                </div>
              )}

              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {loadingPatients && patients.length === 0 ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((idx) => (
                      <div
                        key={idx}
                        className="h-20 animate-pulse rounded-2xl border border-padi-line bg-padi-blush/60"
                      />
                    ))}
                  </div>
                ) : patients.length === 0 ? (
                  <div className="rounded-3xl border-2 border-dashed border-padi-pale bg-padi-blush/60 p-4 text-center text-xs text-padi-ink">
                    No se encontraron pacientes que coincidan con &ldquo;{query}&rdquo;.
                  </div>
                ) : (
                  patients.map((patient) => {
                    const isSelected = selectedPatient?.id === patient.id;
                    const isHomonym = homonymIds.has(patient.id);
                    const channelInfo = CHANNEL_META[patient.preferred_channel] ?? {
                      label: patient.preferred_channel,
                      badgeClass: "bg-padi-blush/60 text-padi-ink border-padi-line",
                    };

                    return (
                      <button
                        key={patient.id}
                        type="button"
                        onClick={() => handleSelectPatient(patient)}
                        className={`w-full text-left rounded-2xl border p-3 transition focus:outline-none focus:ring-2 focus:ring-eira-500/30 ${
                          isSelected
                            ? "border-eira-500 bg-eira-50/70 ring-1 ring-eira-500"
                            : isHomonym
                            ? "border-amber-300 bg-amber-50/30 hover:border-amber-400 hover:bg-amber-50/60"
                            : "border-padi-line bg-white hover:border-padi-line hover:bg-padi-blush/60"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                                isSelected
                                  ? "border-eira-600 bg-eira-600 text-white"
                                  : "border-padi-line bg-white"
                              }`}
                            >
                              {isSelected && <CheckCircle2 className="h-3 w-3" aria-hidden="true" />}
                            </span>
                            <span className="text-sm font-bold text-padi-plum">
                              {patient.full_name}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {isHomonym && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10.5px] font-bold text-amber-900">
                                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                                Posible homónimo
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${channelInfo.badgeClass}`}
                            >
                              {channelInfo.label}
                            </span>
                          </div>
                        </div>

                        {/* Highlighted Key Attributes */}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
                            Folio: {patient.folio}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-white border border-padi-line px-2 py-0.5 font-semibold text-padi-plum">
                            <Calendar className="h-3 w-3 text-eira-600" aria-hidden="true" />
                            Nac: {patient.birth_date}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-md bg-white border border-padi-line px-2 py-0.5 font-medium text-padi-ink">
                            <MapPin className="h-3 w-3 text-padi-muted" aria-hidden="true" />
                            {patient.community}
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Mandatory 3-Checkbox Human Verification Checklist */}
            <div className="rounded-2xl border border-padi-line bg-padi-blush/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-eira-600" aria-hidden="true" />
                  <h3 className="text-sm font-bold text-padi-plum">
                    2. Lista obligatoria de verificación humana
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-padi-ink">
                  {[nameMatches, dobOrFolioMatches, pdfLegibleComplete].filter(Boolean).length}/3
                </span>
              </div>

              {!selectedPatient && (
                <p className="text-xs text-padi-muted italic">
                  Selecciona primero a la paciente arriba para cotejar sus datos contra el visor PDF.
                </p>
              )}

              <div className="space-y-2">
                <label className="flex items-start gap-2.5 rounded-2xl border border-padi-line bg-white p-2.5 text-xs text-padi-plum cursor-pointer hover:border-eira-200">
                  <input
                    type="checkbox"
                    checked={nameMatches}
                    disabled={!selectedPatient}
                    onChange={(e) => setNameMatches(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-padi-line text-eira-600 focus:ring-eira-500 disabled:opacity-40"
                  />
                  <span>
                    <strong>Nombre completo verificado:</strong> el nombre en la orden del PDF coincide exactamente con{" "}
                    <span className="font-semibold text-eira-700">
                      {selectedPatient ? selectedPatient.full_name : "la paciente seleccionada"}
                    </span>
                    .
                  </span>
                </label>

                <label className="flex items-start gap-2.5 rounded-2xl border border-padi-line bg-white p-2.5 text-xs text-padi-plum cursor-pointer hover:border-eira-200">
                  <input
                    type="checkbox"
                    checked={dobOrFolioMatches}
                    disabled={!selectedPatient}
                    onChange={(e) => setDobOrFolioMatches(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-padi-line text-eira-600 focus:ring-eira-500 disabled:opacity-40"
                  />
                  <span>
                    <strong>Fecha de nacimiento / Folio coinciden:</strong> cotejé{" "}
                    <span className="font-mono font-semibold text-padi-plum">
                      {selectedPatient ? selectedPatient.birth_date : "AAAA-MM-DD"}
                    </span>{" "}
                    y el folio de muestra{" "}
                    <span className="font-mono font-semibold text-padi-plum">
                      {study.sample_folio}
                    </span>
                    .
                  </span>
                </label>

                <label className="flex items-start gap-2.5 rounded-2xl border border-padi-line bg-white p-2.5 text-xs text-padi-plum cursor-pointer hover:border-eira-200">
                  <input
                    type="checkbox"
                    checked={pdfLegibleComplete}
                    disabled={!selectedPatient}
                    onChange={(e) => setPdfLegibleComplete(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-padi-line text-eira-600 focus:ring-eira-500 disabled:opacity-40"
                  />
                  <span>
                    <strong>Legibilidad e integridad completa:</strong> todas las páginas del estudio son nítidas y corresponden a una única paciente.
                  </span>
                </label>
              </div>

              {isDiscordant && suggestion && (
                <div
                  role="alert"
                  aria-live="assertive"
                  className="rounded-2xl border border-rose-300 bg-rose-50 p-3 space-y-2"
                >
                  <p className="flex items-start gap-2 text-xs font-bold text-rose-900">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      La paciente seleccionada no coincide con la visita registrada para este folio de
                      muestra ({suggestion.patient.full_name}). Verifica de nuevo antes de confirmar.
                    </span>
                  </p>
                  <label className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-white p-2.5 text-xs text-rose-950 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={discordanceAck}
                      onChange={(e) => setDiscordanceAck(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                    />
                    <span>
                      <strong>Confirmo que revisé la discordancia y la asociación es correcta.</strong>
                    </span>
                  </label>
                </div>
              )}

              <div>
                <label
                  htmlFor="associator-notes"
                  className="flex items-center gap-1.5 text-xs font-semibold text-padi-ink mb-1"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-padi-muted" aria-hidden="true" />
                  Notas de cotejo (opcional)
                </label>
                <textarea
                  id="associator-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej. Verificado apellido materno Pérez vs Peralta y fecha 1988-05-14."
                  className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-xs text-padi-plum placeholder:text-padi-muted focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                />
              </div>
            </div>

            {submitError && (
              <div
                role="alert"
                className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-800"
              >
                {submitError}
              </div>
            )}

            <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-padi-line">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-2xl border border-padi-line bg-white px-4 py-2 text-xs font-semibold text-padi-ink hover:bg-padi-blush/60 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!isChecklistComplete || submitting}
                className="inline-flex items-center gap-2 rounded-full min-h-[48px] bg-eira-600 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-eira-700 disabled:cursor-not-allowed disabled:bg-padi-pale disabled:text-padi-muted"
              >
                <UserCheck className="h-4 w-4" aria-hidden="true" />
                <span>
                  {submitting
                    ? "Guardando asociación..."
                    : "Confirmar Asociación Verificada"}
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
