"use client";

import React, { useRef, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FilePlus2,
  FileText,
  Fingerprint,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  UserCheck,
  XCircle,
} from "lucide-react";
import Navbar, {
  STAFF_DEMO_ACCOUNTS,
  loginStaffDemoAccount,
  parseStaffFromSession,
} from "@/components/Navbar";
import SideBySideAssociator from "@/components/SideBySideAssociator";
import DocumentScannerPanel from "@/components/DocumentScannerPanel";
import {
  STATUS_LABELS,
  type IdentityChecklist,
  type StaffUser,
  type StudyPriority,
  type StudyWithPatient,
} from "@/lib/types";

type ActiveTab = "upload" | "associate" | "admin_review";
type UploadMode = "synthetic" | "scan" | "file";

interface SyntheticPreset {
  id: string;
  label: string;
  patient_name: string;
  birth_date: string;
  site_name: string;
  community: string;
  priority: StudyPriority;
  lab_note: string;
}

const SYNTHETIC_PRESETS: SyntheticPreset[] = [
  {
    id: "homonym-1",
    label: "Homónimo 1: María Gpe. Hernández Pérez",
    patient_name: "Maria Guadalupe Hernandez Perez",
    birth_date: "1988-05-14",
    site_name: "Jornada Municipal Teotihuacan",
    community: "San Juan Teotihuacán",
    priority: "rutinario",
    lab_note: "Muestra satisfactoria para evaluacion. Citologia cervical dentro de limites normales.",
  },
  {
    id: "homonym-2",
    label: "Homónimo 2: María Gpe. Hernández Peralta",
    patient_name: "Maria Guadalupe Hernandez Peralta",
    birth_date: "1979-11-02",
    site_name: "Jornada Comunitaria Otumba",
    community: "Otumba",
    priority: "rutinario",
    lab_note: "Muestra adecuada. Flora habitual, sin cambios celulares atipicos.",
  },
  {
    id: "priority-rural",
    label: "Rural Prioritario: Carmen Flores (Sierra Norte)",
    patient_name: "Carmen Flores Mendoza",
    birth_date: "1984-01-19",
    site_name: "Brigada Rural Sierra Norte",
    community: "Sierra Norte",
    priority: "prioritario",
    lab_note: "Hallazgos celulares que requieren valoracion colposcopica y entrega acompanada EIRA.",
  },
];

function parseChecklist(raw: string | null): IdentityChecklist | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as IdentityChecklist;
  } catch {
    return null;
  }
}

export default function EiraWorkspacePage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("upload");
  const [staff, setStaff] = useState<StaffUser | null>(null);
  const [switchingRole, setSwitchingRole] = useState(false);
  const [roleSwitchError, setRoleSwitchError] = useState<string | null>(null);

  const [studies, setStudies] = useState<StudyWithPatient[]>([]);
  const [loadingStudies, setLoadingStudies] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tab 1: Upload / Synthetic PDF State
  const [uploadMode, setUploadMode] = useState<UploadMode>("synthetic");
  const [sampleFolio, setSampleFolio] = useState("");
  const [collectionDate, setCollectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [siteName, setSiteName] = useState("Jornada Municipal Teotihuacán");
  const [community, setCommunity] = useState("San Juan Teotihuacán");
  const [priority, setPriority] = useState<StudyPriority>("rutinario");
  const [patientNameOnPaper, setPatientNameOnPaper] = useState("Maria Guadalupe Hernandez Perez");
  const [dobOnPaper, setDobOnPaper] = useState("1988-05-14");
  const [labNote, setLabNote] = useState(
    "Muestra satisfactoria para evaluacion. Citologia cervical dentro de limites normales."
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lastCreatedStudy, setLastCreatedStudy] = useState<StudyWithPatient | null>(null);

  // Tab 2: Associator modal state
  const [associatingStudy, setAssociatingStudy] = useState<StudyWithPatient | null>(null);
  const [associationNotice, setAssociationNotice] = useState<string | null>(null);

  // Tab 3: Admin Review (Gate 1) state
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const [adminComments, setAdminComments] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccess, setReviewSuccess] = useState<string | null>(null);
  const [pdfReloadKey, setPdfReloadKey] = useState(0);

  // Guards against out-of-order responses (e.g. an initial 401 arriving after the post-login reload).
  const loadSeqRef = useRef(0);
  const loadStudies = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoadingStudies(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/studies", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        studies?: StudyWithPatient[];
        error?: string;
      };
      if (seq !== loadSeqRef.current) return;
      if (!res.ok) {
        throw new Error(data.error || "No se pudieron cargar los estudios.");
      }
      setStudies(Array.isArray(data.studies) ? data.studies : []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Error al cargar estudios.");
    } finally {
      setLoadingStudies(false);
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setStaff(parseStaffFromSession(data));
    } catch {
      // Ignore transient error
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

  const handleQuickSwitch = async (targetRole: "laboratorio" | "eira_admin") => {
    const account = STAFF_DEMO_ACCOUNTS.find((acc) => acc.role === targetRole);
    if (!account) return;
    setSwitchingRole(true);
    setRoleSwitchError(null);
    try {
      const next = await loginStaffDemoAccount(account);
      setStaff(next);
      setPdfReloadKey((k) => k + 1);
    } catch (err) {
      setRoleSwitchError(err instanceof Error ? err.message : "Error al cambiar rol.");
    } finally {
      setSwitchingRole(false);
    }
  };

  const applySyntheticPreset = (preset: SyntheticPreset) => {
    setUploadMode("synthetic");
    setPatientNameOnPaper(preset.patient_name);
    setDobOnPaper(preset.birth_date);
    setSiteName(preset.site_name);
    setCommunity(preset.community);
    setPriority(preset.priority);
    setLabNote(preset.lab_note);
    setUploadError(null);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploading(true);
    setUploadError(null);
    setLastCreatedStudy(null);

    try {
      let res: Response;
      if (uploadMode === "file" || uploadMode === "scan") {
        if (!selectedFile) {
          throw new Error(
            uploadMode === "scan"
              ? "Captura al menos una página y conviértela a PDF, o busca un escaneo en tu computadora."
              : "Selecciona un archivo PDF válido antes de subir."
          );
        }
        const formData = new FormData();
        formData.append("file", selectedFile);
        if (sampleFolio.trim()) formData.append("sample_folio", sampleFolio.trim());
        formData.append("collection_date", collectionDate);
        formData.append("site_name", siteName.trim() || "Laboratorio Colaborador EIRA");
        formData.append("community", community.trim() || "San Juan Teotihuacán");
        formData.append("priority", priority);

        res = await fetch("/api/studies", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/studies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            generate_synthetic: true,
            sample_folio: sampleFolio.trim() || undefined,
            patient_name: patientNameOnPaper.trim(),
            birth_date: dobOnPaper.trim(),
            collection_date: collectionDate,
            site_name: siteName.trim() || "Laboratorio Colaborador EIRA",
            community: community.trim() || "San Juan Teotihuacán",
            priority,
            lab_note: labNote.trim(),
          }),
        });
      }

      const payload = (await res.json().catch(() => ({}))) as {
        study?: StudyWithPatient;
        error?: string;
      };
      if (!res.ok || !payload.study) {
        throw new Error(
          payload.error ||
            "No se pudo cargar el estudio. Verifica tener rol Laboratorio o EIRA Admin."
        );
      }

      setLastCreatedStudy(payload.study);
      setSampleFolio("");
      setSelectedFile(null);
      await loadStudies();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Error al cargar el estudio.");
    } finally {
      setUploading(false);
    }
  };

  const unassociatedStudies = useMemo(
    () => studies.filter((s) => s.status === "cargado" || s.status === "devuelto"),
    [studies]
  );

  const pendingAdminStudies = useMemo(
    () => studies.filter((s) => s.status === "asociado" || s.status === "revision_admin"),
    [studies]
  );

  const selectedAdminStudy = useMemo(() => {
    if (pendingAdminStudies.length === 0) return null;
    return (
      pendingAdminStudies.find((s) => s.id === selectedAdminId) ?? pendingAdminStudies[0]
    );
  }, [pendingAdminStudies, selectedAdminId]);

  const canUploadOrAssociate =
    staff?.role === "laboratorio" || staff?.role === "eira_admin";
  const isEiraAdmin = staff?.role === "eira_admin";

  const handleAdminDecision = async (decision: "aprobado" | "rechazado") => {
    if (!selectedAdminStudy) return;
    const trimmed = adminComments.trim();
    if (decision === "rechazado" && !trimmed) {
      setReviewError(
        "El motivo/comentario es obligatorio al devolver un estudio a corrección."
      );
      return;
    }

    setSubmittingReview(true);
    setReviewError(null);
    setReviewSuccess(null);

    try {
      const res = await fetch(`/api/studies/${selectedAdminStudy.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "administrativa",
          decision,
          comments:
            trimmed || "Digitalización verificada y coincidencia de identidad aprobada en Compuerta 1.",
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(
          payload.error || "No se pudo registrar la revisión administrativa."
        );
      }

      setReviewSuccess(
        decision === "aprobado"
          ? `Estudio ${selectedAdminStudy.sample_folio} aprobado en Compuerta 1 y enviado a Autorización Clínica.`
          : `Estudio ${selectedAdminStudy.sample_folio} devuelto a corrección con motivo registrado.`
      );
      setAdminComments("");
      setSelectedAdminId(null);
      await loadStudies();
    } catch (err) {
      setReviewError(
        err instanceof Error ? err.message : "Error al procesar la revisión administrativa."
      );
    } finally {
      setSubmittingReview(false);
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
                <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
                Flujo Operativo · Laboratorio & Personal EIRA
              </div>
              <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight text-padi-plum">
                Carga de PDF, Cotejo Anti-Homónimos y Revisión Administrativa
              </h1>
              <p className="mt-1 text-sm text-padi-ink max-w-3xl">
                Cada documento ingresa al almacenamiento privado con hash SHA-256, requiere verificación humana lado a lado contra el padrón y pasa por la Compuerta 1 antes de llegar a la médica.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadStudies()}
                disabled={loadingStudies}
                className="inline-flex items-center gap-1.5 rounded-full min-h-[44px] border-2 border-eira-600 bg-white px-5 py-2 text-xs font-bold text-eira-600 hover:bg-eira-600 hover:text-white/60"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${loadingStudies ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Actualizar cola
              </button>
              <Link
                href="/medico"
                className="inline-flex items-center gap-1.5 rounded-full min-h-[44px] bg-eira-600 px-5 py-2 text-xs font-bold text-white hover:bg-eira-700"
              >
                <span>Ir a Compuerta 2 (Médica)</span>
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* 3 Workspace Tabs */}
          <div
            role="tablist"
            aria-label="Etapas del flujo EIRA"
            className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "upload"}
              onClick={() => setActiveTab("upload")}
              className={`rounded-3xl border-[1.5px] px-4 py-3 min-h-[56px] text-left transition flex items-center justify-between gap-2 ${
                activeTab === "upload"
                  ? "border-eira-600 bg-eira-50 text-eira-900 ring-2 ring-eira-600/30 shadow-md"
                  : "border-padi-line bg-padi-blush/60 text-padi-ink hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Upload
                  className={`h-4 w-4 ${activeTab === "upload" ? "text-eira-600" : "text-padi-muted"}`}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-bold">1. Cargar PDF Escaneado</p>
                  <p className="text-[11px] text-padi-muted">Archivo real o sintético 1-clic</p>
                </div>
              </div>
              <span className="rounded-full bg-white border border-padi-line px-2 py-0.5 text-[11px] font-bold text-padi-ink">
                Lab / EIRA
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "associate"}
              onClick={() => setActiveTab("associate")}
              className={`rounded-3xl border-[1.5px] px-4 py-3 min-h-[56px] text-left transition flex items-center justify-between gap-2 ${
                activeTab === "associate"
                  ? "border-eira-600 bg-eira-50 text-eira-900 ring-2 ring-eira-600/30 shadow-md"
                  : "border-padi-line bg-padi-blush/60 text-padi-ink hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <UserCheck
                  className={`h-4 w-4 ${
                    activeTab === "associate" ? "text-eira-600" : "text-padi-muted"
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-bold">2. Asociación Verificada</p>
                  <p className="text-[11px] text-padi-muted">Cotejo lado a lado anti-homónimos</p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  unassociatedStudies.length > 0
                    ? "bg-amber-100 text-amber-900 border border-amber-300"
                    : "bg-white text-padi-ink border border-padi-line"
                }`}
              >
                {unassociatedStudies.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "admin_review"}
              onClick={() => setActiveTab("admin_review")}
              className={`rounded-3xl border-[1.5px] px-4 py-3 min-h-[56px] text-left transition flex items-center justify-between gap-2 ${
                activeTab === "admin_review"
                  ? "border-eira-600 bg-eira-50 text-eira-900 ring-2 ring-eira-600/30 shadow-md"
                  : "border-padi-line bg-padi-blush/60 text-padi-ink hover:bg-white"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck
                  className={`h-4 w-4 ${
                    activeTab === "admin_review" ? "text-eira-600" : "text-padi-muted"
                  }`}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-bold">3. Revisión Admin (Compuerta 1)</p>
                  <p className="text-[11px] text-padi-muted">Aprobar a clínica o devolver</p>
                </div>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                  pendingAdminStudies.length > 0
                    ? "bg-eira-50 text-eira-700 border border-eira-200"
                    : "bg-white text-padi-ink border border-padi-line"
                }`}
              >
                {pendingAdminStudies.length}
              </span>
            </button>
          </div>
        </section>

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

        {/* TAB 1: UPLOAD OR SYNTHETIC PDF */}
        {activeTab === "upload" && (
          <section className="rounded-3xl border-[1.5px] border-padi-line bg-white p-5 sm:p-6 shadow-sm space-y-5">
            {!canUploadOrAssociate && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-amber-950">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-bold">
                      Se requiere sesión de Laboratorio o EIRA Admin para cargar estudios
                    </p>
                    <p className="mt-0.5">
                      Rol actual: <strong>{staff ? `${staff.name} (${staff.role})` : "Sin sesión"}</strong>. Cambia con 1 clic para continuar.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={switchingRole}
                    onClick={() => void handleQuickSwitch("laboratorio")}
                    className="rounded-full min-h-[48px] bg-eira-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-eira-700 disabled:opacity-60"
                  >
                    Cambiar a QFB Sofía Méndez (Laboratorio)
                  </button>
                  <button
                    type="button"
                    disabled={switchingRole}
                    onClick={() => void handleQuickSwitch("eira_admin")}
                    className="rounded-full min-h-[48px] bg-eira-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-eira-700 disabled:opacity-60"
                  >
                    Cambiar a Lic. Mariana López (EIRA Admin)
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-padi-line pb-4">
              <div>
                <h2 className="text-lg font-bold text-padi-plum">
                  Ingresar Estudio de Papanicolaou al Repositorio Privado
                </h2>
                <p className="text-xs text-padi-muted">
                  El estudio se guarda como <code className="text-padi-ink">cargado</code> sin asociación automática.
                </p>
              </div>

              <div className="inline-flex flex-wrap rounded-full border-[1.5px] border-padi-pale bg-padi-blush p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setUploadMode("synthetic")}
                  className={`inline-flex items-center gap-1.5 rounded-full min-h-[44px] px-4 py-2 text-xs font-bold transition ${
                    uploadMode === "synthetic"
                      ? "bg-eira-600 text-white shadow-md"
                      : "text-padi-ink hover:text-padi-plum"
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Generar PDF sintético
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode("scan")}
                  className={`inline-flex items-center gap-1.5 rounded-full min-h-[44px] px-4 py-2 text-xs font-bold transition ${
                    uploadMode === "scan"
                      ? "bg-eira-600 text-white shadow-md"
                      : "text-padi-ink hover:text-padi-plum"
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                  Escanear (Cámara / PC)
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode("file")}
                  className={`inline-flex items-center gap-1.5 rounded-full min-h-[44px] px-4 py-2 text-xs font-bold transition ${
                    uploadMode === "file"
                      ? "bg-eira-600 text-white shadow-md"
                      : "text-padi-ink hover:text-padi-plum"
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Subir PDF real
                </button>
              </div>
            </div>

            {uploadMode === "synthetic" && (
              <div className="rounded-2xl border border-eira-200 bg-eira-50/40 p-3.5 space-y-2">
                <p className="text-xs font-bold text-eira-900">
                  Plantillas rápidas (1 clic para prellenar datos de prueba):
                </p>
                <div className="flex flex-wrap gap-2">
                  {SYNTHETIC_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applySyntheticPreset(preset)}
                      className="rounded-full min-h-[44px] border-2 border-eira-200 bg-white px-4 py-2 text-xs font-semibold text-eira-700 hover:border-eira-600 hover:bg-eira-50"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="sample-folio" className="block text-xs font-bold text-padi-ink mb-1">
                    Folio de muestra (opcional, autogenera si vacío)
                  </label>
                  <input
                    id="sample-folio"
                    type="text"
                    value={sampleFolio}
                    onChange={(e) => setSampleFolio(e.target.value)}
                    placeholder="Ej. PAP-2026-106"
                    className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum placeholder:text-padi-muted focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="collection-date" className="block text-xs font-bold text-padi-ink mb-1">
                    Fecha de toma
                  </label>
                  <input
                    id="collection-date"
                    type="date"
                    required
                    value={collectionDate}
                    onChange={(e) => setCollectionDate(e.target.value)}
                    className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="study-priority" className="block text-xs font-bold text-padi-ink mb-1">
                    Clasificación preliminar / Preset
                  </label>
                  <select
                    id="study-priority"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as StudyPriority)}
                    className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                  >
                    <option value="rutinario">Rutinario (Citología estándar)</option>
                    <option value="prioritario">Prioritario (Hallazgo para seguimiento)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="site-name" className="block text-xs font-bold text-padi-ink mb-1">
                    Sede / Jornada de toma
                  </label>
                  <input
                    id="site-name"
                    type="text"
                    required
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                  />
                </div>

                <div>
                  <label htmlFor="community" className="block text-xs font-bold text-padi-ink mb-1">
                    Comunidad / Municipio
                  </label>
                  <input
                    id="community"
                    type="text"
                    required
                    value={community}
                    onChange={(e) => setCommunity(e.target.value)}
                    className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                  />
                </div>
              </div>

              {uploadMode === "synthetic" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-2xl border border-padi-line bg-padi-blush/60 p-4">
                  <div>
                    <label
                      htmlFor="paper-patient-name"
                      className="block text-xs font-bold text-padi-ink mb-1"
                    >
                      Nombre impreso en orden de laboratorio (dentro del PDF)
                    </label>
                    <input
                      id="paper-patient-name"
                      type="text"
                      required
                      value={patientNameOnPaper}
                      onChange={(e) => setPatientNameOnPaper(e.target.value)}
                      className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                    />
                  </div>
                  <div>
                    <label htmlFor="paper-dob" className="block text-xs font-bold text-padi-ink mb-1">
                      Fecha de nacimiento impresa en PDF
                    </label>
                    <input
                      id="paper-dob"
                      type="date"
                      required
                      value={dobOnPaper}
                      onChange={(e) => setDobOnPaper(e.target.value)}
                      className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor="lab-note" className="block text-xs font-bold text-padi-ink mb-1">
                      Nota citológica sintética (solo visible dentro del PDF privado)
                    </label>
                    <input
                      id="lab-note"
                      type="text"
                      value={labNote}
                      onChange={(e) => setLabNote(e.target.value)}
                      className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-sm text-padi-plum focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                    />
                  </div>
                </div>
              ) : uploadMode === "scan" ? (
                <DocumentScannerPanel
                  selectedFile={selectedFile}
                  onPdfReady={setSelectedFile}
                />
              ) : (
                <div className="rounded-3xl border-2 border-dashed border-padi-pale bg-padi-blush/60 p-6 text-center">
                  <FilePlus2 className="mx-auto h-8 w-8 text-eira-600" aria-hidden="true" />
                  <label
                    htmlFor="real-pdf-input"
                    className="mt-2 block text-sm font-bold text-padi-plum cursor-pointer"
                  >
                    Selecciona un archivo PDF escaneado (.pdf, máx. 15 MB)
                  </label>
                  <input
                    id="real-pdf-input"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                    className="mt-3 block mx-auto text-xs text-padi-ink file:mr-3 file:rounded-2xl file:border-0 file:bg-eira-600 file:px-4 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-eira-700"
                  />
                  {selectedFile && (
                    <p className="mt-2 text-xs font-semibold text-emerald-700">
                      Archivo listo: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                    </p>
                  )}
                </div>
              )}

              {uploadError && (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800"
                >
                  {uploadError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="submit"
                  disabled={uploading || !canUploadOrAssociate}
                  className="inline-flex items-center gap-2 rounded-full min-h-[48px] bg-eira-600 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-sm transition hover:bg-eira-700 disabled:cursor-not-allowed disabled:bg-padi-pale disabled:text-padi-muted"
                >
                  {uploadMode === "synthetic" ? (
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Upload className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>
                    {uploading
                      ? "Guardando PDF privado..."
                      : uploadMode === "synthetic"
                      ? "Generar PDF sintético de prueba"
                      : uploadMode === "scan"
                      ? "Subir documento escaneado privado"
                      : "Subir PDF escaneado privado"}
                  </span>
                </button>
              </div>
            </form>

            {lastCreatedStudy && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2 font-bold text-emerald-900">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                    <span>
                      PDF almacenado en repositorio privado · {lastCreatedStudy.sample_folio}
                    </span>
                  </div>
                  <p className="text-emerald-800">
                    Pseudónimo asignado:{" "}
                    <strong className="font-mono">{lastCreatedStudy.pseudonym_code}</strong> ·
                    SHA-256:{" "}
                    <code className="font-mono">
                      {lastCreatedStudy.pdf_sha256?.slice(0, 16)}…
                    </code>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab("associate");
                      setAssociatingStudy(lastCreatedStudy);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-full min-h-[48px] bg-eira-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-eira-700"
                  >
                    <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    Asociar paciente ahora
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* TAB 2: SIDE-BY-SIDE IDENTITY ASSOCIATION */}
        {activeTab === "associate" && (
          <section className="rounded-3xl border-[1.5px] border-padi-line bg-white p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-padi-plum">
                  Estudios por Asociar o Corregir ({unassociatedStudies.length})
                </h2>
                <p className="text-xs text-padi-muted">
                  Abre el visor lado a lado para cotejar el PDF contra el padrón de pacientes y detectar homónimos antes de vincular.
                </p>
              </div>
              {!canUploadOrAssociate && (
                <button
                  type="button"
                  disabled={switchingRole}
                  onClick={() => void handleQuickSwitch("eira_admin")}
                  className="rounded-full min-h-[48px] bg-eira-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-eira-700"
                >
                  Cambiar a Lic. Mariana López (EIRA Admin)
                </button>
              )}
            </div>

            {associationNotice && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  {associationNotice}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("admin_review");
                    setAssociationNotice(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-full min-h-[44px] bg-eira-600 px-3 py-1 text-white hover:bg-eira-700"
                >
                  <span>Ir a Revisión Admin</span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            )}

            {loadingStudies ? (
              <div className="space-y-2.5">
                {[0, 1].map((idx) => (
                  <div key={idx} className="h-24 animate-pulse rounded-2xl bg-padi-blush/60" />
                ))}
              </div>
            ) : unassociatedStudies.length === 0 ? (
              <div className="rounded-3xl border-2 border-dashed border-padi-pale bg-padi-blush/60 p-8 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" aria-hidden="true" />
                <p className="mt-2 text-sm font-bold text-padi-plum">
                  No hay estudios pendientes de asociación
                </p>
                <p className="mt-1 text-xs text-padi-muted">
                  Puedes generar un PDF sintético en la pestaña 1 o continuar a Revisión Administrativa.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {unassociatedStudies.map((study) => (
                  <article
                    key={study.id}
                    className={`rounded-2xl border p-4 space-y-3 transition ${
                      study.status === "devuelto"
                        ? "border-rose-200 bg-rose-50/30"
                        : "border-padi-line bg-white hover:border-eira-200"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-extrabold text-padi-plum">
                            {study.sample_folio}
                          </span>
                          <span className="rounded-md bg-padi-blush/60 border border-padi-line px-2 py-0.5 font-mono text-[11px] text-padi-ink">
                            {study.pseudonym_code}
                          </span>
                        </div>
                        <p className="text-xs text-padi-muted mt-0.5">
                          {study.collection_date} · {study.site_name} ({study.community})
                        </p>
                      </div>

                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                          study.status === "devuelto"
                            ? "border-rose-300 bg-rose-100 text-rose-800"
                            : "border-amber-300 bg-amber-50 text-amber-800"
                        }`}
                      >
                        {STATUS_LABELS[study.status]}
                      </span>
                    </div>

                    {study.patient && (
                      <div className="rounded-2xl bg-white border border-padi-line px-3 py-2 text-xs text-padi-ink">
                        Asociación previa: <strong>{study.patient.full_name}</strong> ({study.patient.folio})
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-padi-muted">
                        <Fingerprint className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        {study.pdf_sha256 ? `${study.pdf_sha256.slice(0, 14)}…` : "SHA-256 listo"}
                      </span>

                      <button
                        type="button"
                        onClick={() => setAssociatingStudy(study)}
                        className="inline-flex items-center gap-1.5 rounded-full min-h-[48px] bg-eira-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-eira-700"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        Abrir cotejo lado a lado
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: GATE 1 ADMINISTRATIVE REVIEW */}
        {activeTab === "admin_review" && (
          <section className="space-y-4">
            {!isEiraAdmin && (
              <div className="rounded-2xl border border-eira-300 bg-eira-50 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 text-xs text-eira-950">
                  <ShieldAlert className="h-5 w-5 text-eira-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-bold">
                      Compuerta 1 reservada exclusivamente para Personal Administrativo EIRA (`eira_admin`)
                    </p>
                    <p className="mt-0.5">
                      Rol actual:{" "}
                      <strong>{staff ? `${staff.name} (${staff.role})` : "Sin sesión"}</strong>.
                      Cambia al rol de Lic. Mariana López para aprobar o devolver estudios.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={switchingRole}
                  onClick={() => void handleQuickSwitch("eira_admin")}
                  className="inline-flex items-center gap-1.5 rounded-full min-h-[48px] bg-eira-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-eira-700 disabled:opacity-60"
                >
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  {switchingRole
                    ? "Cambiando sesión..."
                    : "Cambiar a Lic. Mariana López (EIRA Admin)"}
                </button>
              </div>
            )}

            {reviewSuccess && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  {reviewSuccess}
                </span>
                <Link
                  href="/medico"
                  className="inline-flex items-center gap-1 rounded-full min-h-[44px] bg-eira-600 px-3 py-1 text-white hover:bg-eira-700"
                >
                  <span>Ir a Autorización Clínica</span>
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
            )}

            {pendingAdminStudies.length === 0 ? (
              <div className="rounded-3xl border-2 border-dashed border-padi-pale bg-white p-8 text-center">
                <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-500" aria-hidden="true" />
                <p className="mt-2 text-sm font-bold text-padi-plum">
                  No hay estudios en cola de Revisión Administrativa
                </p>
                <p className="mt-1 text-xs text-padi-muted">
                  Cuando un estudio sea asociado en la pestaña 2 aparecerá aquí para pasar por la Compuerta 1.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Queue selector */}
                <div className="lg:col-span-4 space-y-2.5">
                  <div className="rounded-3xl border-[1.5px] border-padi-line bg-white p-4 shadow-sm space-y-2.5">
                    <h2 className="text-sm font-bold text-padi-plum">
                      Cola de Compuerta 1 ({pendingAdminStudies.length})
                    </h2>
                    <div className="space-y-2">
                      {pendingAdminStudies.map((st) => {
                        const active = selectedAdminStudy?.id === st.id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => {
                              setSelectedAdminId(st.id);
                              setReviewError(null);
                              setReviewSuccess(null);
                            }}
                            className={`w-full text-left rounded-2xl border p-3 transition ${
                              active
                                ? "border-eira-500 bg-eira-50/70 ring-1 ring-eira-500"
                                : "border-padi-line bg-padi-blush/60 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-extrabold text-padi-plum">
                                {st.sample_folio}
                              </span>
                              <span className="rounded-full bg-eira-50 text-eira-700 border border-eira-200 px-2 py-0.5 text-[10px] font-bold">
                                {STATUS_LABELS[st.status]}
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
                  </div>
                </div>

                {/* Selected Study Inspection & Decision */}
                {selectedAdminStudy && (
                  <div className="lg:col-span-8 rounded-3xl border-[1.5px] border-padi-line bg-white p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-padi-line pb-3">
                      <div>
                        <h3 className="text-base font-bold text-padi-plum">
                          Inspección Administrativa · {selectedAdminStudy.sample_folio}
                        </h3>
                        <p className="text-xs text-padi-muted">
                          Verifica calidad de escaneo y consistencia de identidad antes de turnar al personal médico.
                        </p>
                      </div>
                      <a
                        href={`/api/studies/${selectedAdminStudy.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-full min-h-[44px] border-2 border-eira-600 bg-white px-4 py-2 text-eira-600 hover:bg-eira-600 hover:text-white text-xs font-bold"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        Abrir PDF
                      </a>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                      {/* PDF Embed */}
                      <div className="xl:col-span-7 space-y-2">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-padi-ink">
                          <FileText className="h-4 w-4 text-eira-600" aria-hidden="true" />
                          <span>Vista previa del documento privado</span>
                        </div>
                        <div className="rounded-2xl border border-padi-line overflow-hidden bg-padi-blush/60">
                          <iframe
                            key={`${selectedAdminStudy.id}-${pdfReloadKey}`}
                            src={`/api/studies/${selectedAdminStudy.id}/pdf`}
                            title={`PDF revisión administrativa ${selectedAdminStudy.sample_folio}`}
                            className="w-full h-[380px]"
                          />
                        </div>
                      </div>

                      {/* Identity Verification + Gate 1 Decision */}
                      <div className="xl:col-span-5 space-y-3">
                        <div className="rounded-2xl border border-padi-line bg-padi-blush/60 p-3.5 text-xs space-y-1.5">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-padi-muted">
                            Paciente Vinculada
                          </p>
                          <p className="text-sm font-bold text-padi-plum">
                            {selectedAdminStudy.patient?.full_name || "—"}
                          </p>
                          <p className="text-padi-ink">
                            Folio:{" "}
                            <span className="font-mono font-bold">
                              {selectedAdminStudy.patient?.folio}
                            </span>
                          </p>
                          <p className="text-padi-ink">
                            Nacimiento: <strong>{selectedAdminStudy.patient?.birth_date}</strong>
                          </p>
                          <p className="text-padi-ink">
                            Comunidad: <strong>{selectedAdminStudy.patient?.community}</strong>
                          </p>
                        </div>

                        {(() => {
                          const checklist = parseChecklist(
                            selectedAdminStudy.identity_checklist_json
                          );
                          if (!checklist) return null;
                          return (
                            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs space-y-1">
                              <p className="inline-flex items-center gap-1 font-bold text-emerald-900">
                                <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                                Cotejo verificado por {checklist.verified_by}
                              </p>
                              <p className="text-emerald-800">
                                Nombre ✓ · Fecha/Folio ✓ · Legibilidad ✓
                              </p>
                              {checklist.notes && (
                                <p className="text-emerald-900 italic">
                                  Nota: &ldquo;{checklist.notes}&rdquo;
                                </p>
                              )}
                            </div>
                          );
                        })()}

                        <div>
                          <label
                            htmlFor="admin-review-comments"
                            className="block text-xs font-bold text-padi-ink mb-1"
                          >
                            Observaciones de revisión (obligatorio si se devuelve)
                          </label>
                          <textarea
                            id="admin-review-comments"
                            rows={3}
                            value={adminComments}
                            onChange={(e) => {
                              setAdminComments(e.target.value);
                              setReviewError(null);
                            }}
                            placeholder="Ej. Escaneo nítido, datos completos; o motivo específico de devolución..."
                            className="w-full rounded-2xl border border-padi-line bg-white px-3 py-2 text-xs text-padi-plum placeholder:text-padi-muted focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/20"
                          />
                        </div>

                        {reviewError && (
                          <div
                            role="alert"
                            className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800"
                          >
                            {reviewError}
                          </div>
                        )}

                        <div className="flex flex-col gap-2 pt-1">
                          <button
                            type="button"
                            disabled={!isEiraAdmin || submittingReview}
                            onClick={() => void handleAdminDecision("aprobado")}
                            className="inline-flex items-center justify-center gap-2 rounded-full min-h-[48px] bg-eira-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-eira-700 disabled:cursor-not-allowed disabled:bg-padi-pale disabled:text-padi-muted"
                          >
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                            <span>
                              {submittingReview
                                ? "Procesando..."
                                : "Aprobar y Enviar a Clínica (Compuerta 2)"}
                            </span>
                          </button>

                          <button
                            type="button"
                            disabled={!isEiraAdmin || submittingReview}
                            onClick={() => void handleAdminDecision("rechazado")}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                            <span>Devolver a Corrección (con motivo)</span>
                          </button>

                          {!isEiraAdmin && (
                            <p className="text-[11px] text-eira-700 font-medium text-center flex items-center justify-center gap-1">
                              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              Solo el rol EIRA Admin puede emitir decisiones en Compuerta 1.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      {associatingStudy && (
        <SideBySideAssociator
          study={associatingStudy}
          onClose={() => setAssociatingStudy(null)}
          onSuccess={() => {
            const folio = associatingStudy.sample_folio;
            setAssociatingStudy(null);
            setAssociationNotice(
              `Estudio ${folio} asociado exitosamente con verificación de 3 atributos. Listo para Revisión Administrativa (Compuerta 1).`
            );
            void loadStudies();
          }}
        />
      )}
    </div>
  );
}
