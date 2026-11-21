"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Camera,
  CheckCircle2,
  Clock,
  CloudOff,
  Cpu,
  Database,
  Eye,
  EyeOff,
  HeartHandshake,
  Info,
  KeyRound,
  Lock,
  MapPin,
  QrCode,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import Navbar, { loginStaffDemoAccount, STAFF_DEMO_ACCOUNTS } from "@/components/Navbar";
import QrCardModal from "@/components/QrCardModal";
import QrScannerModal from "@/components/QrScannerModal";
import {
  STATUS_LABELS,
  type AssistedDelivery,
  type KioskNode,
  type LoopStatus,
  type StaffUser,
  type StudyPriority,
  type StudyStatus,
} from "@/lib/types";

interface EncryptedJsonBundle {
  algorithm: "AES-256-GCM";
  iv_hex: string;
  auth_tag_hex: string;
  ciphertext_b64: string;
  sha256: string;
}

interface KioskLocalCacheRecord {
  study_id: string;
  sample_folio: string;
  pseudonym_code: string;
  patient_folio: string;
  patient_name: string;
  birth_date: string;
  community: string;
  collection_date: string;
  site_name: string;
  status: StudyStatus;
  priority: StudyPriority;
  delivery_mode: "digital" | "acompanado" | null;
  loop_status: LoopStatus;
  loop_level: number;
  ack_received_at: string | null;
  pdf_sha256: string | null;
  qr_payload?: {
    v: 1;
    folio: string;
    pseudo: string;
    mode: "digital" | "acompanado" | null;
    portal: "/kiosco";
  };
  qr_data_url?: string;
}

interface StoredKioskCache {
  node: KioskNode;
  synced_at: string;
  count: number;
  encrypted_bundle: EncryptedJsonBundle;
  local_cache_records: KioskLocalCacheRecord[];
}

interface PendingOfflineAck {
  local_id: string;
  ack_folio_local: string;
  study_id: string;
  sample_folio: string;
  pseudonym_code: string;
  patient_folio: string | null;
  kiosk_id: string;
  modality: AssistedDelivery["modality"];
  notes: string;
  delivered_at: string;
  operator_name: string;
}

interface TrafficLightResult {
  color: "rojo" | "verde" | "gris" | "ambar";
  label: string;
}

interface VerifiedStudyMeta {
  study_id: string;
  folio: string | null;
  pseudonym_code: string;
  status: StudyStatus;
  delivery_mode: "digital" | "acompanado" | null;
  community: string;
  sample_folio: string;
  loop_status: LoopStatus;
  birth_date_verified: boolean | null;
  source: "online_api" | "offline_local_cache";
  qr_data_url?: string;
}

const FALLBACK_NODES: KioskNode[] = [
  {
    id: "KIOSK-SIERRA-01",
    name: "Kiosco Comunitario Sierra Norte",
    community: "Sierra Norte",
    hardware_profile: 'Raspberry Pi 5 (4GB) + Pantalla Táctil 7" + Módulo LoRa 433MHz SX1278',
    hotspot_ssid: "EIRA-Kiosco-Sierra",
    lora_channel: "LoRa-433MHz-CH1",
    last_sync_at: null,
  },
  {
    id: "KIOSK-OTUMBA-02",
    name: "Módulo Comunitario Otumba",
    community: "Otumba",
    hardware_profile: "Raspberry Pi 4 (4GB) + Lector QR/NFC + Impresora Térmica",
    hotspot_ssid: "EIRA-Kiosco-Otumba",
    lora_channel: "LoRa-433MHz-CH2",
    last_sync_at: null,
  },
];

const NODES_CACHE_KEY = "eira_kiosk_nodes_cache";
const PENDING_ACKS_KEY = "eira_kiosk_pending_acks";

const MODALITY_OPTIONS: Array<{
  value: AssistedDelivery["modality"];
  label: string;
  hint: string;
}> = [
  {
    value: "kiosco_presencial",
    label: "Entrega presencial en Kiosco",
    hint: "Sobre cerrado tras validar identidad física",
  },
  {
    value: "brigadista_offline",
    label: "Brigadista / Visita offline",
    hint: "Entrega directa en domicilio o jornada rural",
  },
  {
    value: "orientacion_medica",
    label: "Orientación médica acompañada",
    hint: "Explicación cálida previa con médica / promotora",
  },
  {
    value: "llamada_verificada",
    label: "Llamada verificada EIRA",
    hint: "Validación verbal de identidad sin buzón",
  },
];

const PREVENTIVE_CARDS = [
  {
    title: "¿Qué es el Papanicolaou y por qué cuidarte a tiempo?",
    badge: "Prevención sin miedo",
    tone: "rose",
    points: [
      "Es un estudio rápido y sencillo que revisa las células del cuello de la matriz para detectar cambios tempranos mucho antes de que causen molestias.",
      "Detectar cambios a tiempo permite tratamientos simples, ambulatorios y con muy alta probabilidad de curación.",
      "Se recomienda realizarlo de manera periódica aunque te sientas completamente bien.",
    ],
  },
  {
    title: "¿Cómo entender tu Semáforo Clínico EIRA?",
    badge: "Lectura clara",
    tone: "emerald",
    points: [
      "Verde (Ruta Habitual): Tu resultado está listo para entrega en sobre cerrado o consulta digital y requiere control preventivo habitual.",
      "Rojo Prioritario (Entrega Acompañada): NO significa automáticamente algo grave; significa que tu médica quiere explicarte el estudio con calma y acordar tu seguimiento oportuno.",
      "Ámbar (En Validación): El laboratorio o el equipo médico aún está revisando la calidad del documento.",
    ],
  },
  {
    title: "Señales de alerta para acudir a revisión médica",
    badge: "Cuidado oportuno",
    tone: "amber",
    points: [
      "Sangrado vaginal fuera de tu periodo menstrual o después de la menopausia.",
      "Sangrado o dolor persistente durante o después de tener relaciones sexuales.",
      "Flujo vaginal inusual, abundante o con mal olor que no mejora, o dolor pélvico continuo.",
    ],
  },
  {
    title: "Próximas Jornadas y Kioscos EIRA (Sin cita previa)",
    badge: "Atención en tu comunidad",
    tone: "slate",
    points: [
      "Sierra Norte (KIOSK-SIERRA-01): Centro Comunitario · Martes y Jueves de 9:00 a 15:00 h · Promotora Rosa Hernández.",
      "Otumba (KIOSK-OTUMBA-02): Módulo Municipal · Lunes a Viernes de 9:00 a 16:00 h.",
      "Lleva siempre tu Tarjeta QR Semáforo o talón impreso con folio. Tus datos nunca se comparten por WhatsApp ni en grupos públicos.",
    ],
  },
] as const;

function getCacheStorageKey(kioskId: string): string {
  return `eira_kiosk_cache_${kioskId}`;
}

function computeLocalTrafficLight(
  record: KioskLocalCacheRecord,
  hasPendingAck: boolean
): TrafficLightResult {
  if (
    hasPendingAck ||
    record.status === "entregado_asistido" ||
    record.status === "consultado" ||
    record.loop_status === "cerrado_ack"
  ) {
    return {
      color: "gris",
      label: hasPendingAck
        ? "Entrega registrada en cola offline (pendiente subir ACK al reconectar)"
        : "Resultado ya entregado y ciclo cerrado",
    };
  }
  if (record.priority === "prioritario" || record.delivery_mode === "acompanado") {
    return {
      color: "rojo",
      label:
        "Atención prioritaria: requiere entrega acompañada con personal médico/promotora EIRA",
    };
  }
  if (record.delivery_mode === "digital") {
    return {
      color: "verde",
      label:
        "Documento disponible para consulta segura (requiere verificación de fecha de nacimiento)",
    };
  }
  return {
    color: "ambar",
    label: "Estudio en proceso de revisión clínica",
  };
}

function parseScanInput(rawInput: string): { folio: string; pseudonym: string } {
  const trimmed = rawInput.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const pseudo =
        typeof parsed.pseudo === "string"
          ? parsed.pseudo
          : typeof parsed.pseudonym === "string"
          ? parsed.pseudonym
          : typeof parsed.pseudonym_code === "string"
          ? parsed.pseudonym_code
          : "";
      const folio =
        typeof parsed.folio === "string"
          ? parsed.folio
          : typeof parsed.patient_folio === "string"
          ? parsed.patient_folio
          : typeof parsed.sample_folio === "string"
          ? parsed.sample_folio
          : "";
      return {
        folio: folio.trim().toUpperCase(),
        pseudonym: pseudo.trim().toUpperCase(),
      };
    } catch {
      // Fall through to plain text parsing
    }
  }

  const upper = trimmed.toUpperCase();
  if (upper.startsWith("EIRA-")) {
    return { folio: "", pseudonym: upper };
  }
  return { folio: upper, pseudonym: "" };
}

export default function KioscoComunitarioPage() {
  const [nodes, setNodes] = useState<KioskNode[]>(FALLBACK_NODES);
  const [selectedKioskId, setSelectedKioskId] = useState<string>("KIOSK-SIERRA-01");
  const [isSimulatedOffline, setIsSimulatedOffline] = useState<boolean>(false);
  const [browserOnline, setBrowserOnline] = useState<boolean>(true);
  const [swStatus, setSwStatus] = useState<"registrando" | "activo" | "no_soportado">("registrando");

  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const staffId = staffUser?.id ?? null;
  const [switchingPromotora, setSwitchingPromotora] = useState(false);

  const [kioskCache, setKioskCache] = useState<StoredKioskCache | null>(null);
  const [pendingAcks, setPendingAcks] = useState<PendingOfflineAck[]>([]);
  const [showCipherInspect, setShowCipherInspect] = useState(false);

  const [activeTab, setActiveTab] = useState<"entrega" | "cola" | "preventiva">("entrega");
  const [largeTextMode, setLargeTextMode] = useState(false);

  const [scanQuery, setScanQuery] = useState("EIRA-ALR-4104");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [dobVerify, setDobVerify] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifiedResult, setVerifiedResult] = useState<{
    found: boolean;
    traffic_light: TrafficLightResult | null;
    meta: VerifiedStudyMeta | null;
  } | null>(null);

  const [modality, setModality] = useState<AssistedDelivery["modality"]>("kiosco_presencial");
  const [deliveryNotes, setDeliveryNotes] = useState(
    "Identidad verificada en Kiosco Comunitario con talón impreso y sobre cerrado."
  );

  const [syncing, setSyncing] = useState(false);
  const [submittingAck, setSubmittingAck] = useState(false);
  const [flushingQueue, setFlushingQueue] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "warning" | "error"; text: string } | null>(
    null
  );

  const [qrModalRecord, setQrModalRecord] = useState<{
    patientFolio?: string | null;
    sampleFolio?: string | null;
    pseudonymCode: string;
    patientName?: string | null;
    community?: string | null;
    kioskId?: string | null;
    priority?: StudyPriority;
    deliveryMode?: "digital" | "acompanado" | null;
    qrDataUrl?: string | null;
  } | null>(null);

  const isOffline = isSimulatedOffline || !browserOnline;

  // Register PWA Service Worker safely + listen to real browser online/offline state
  useEffect(() => {
    if (typeof window === "undefined") return;

    setBrowserOnline(navigator.onLine);
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then(() => setSwStatus("activo"))
        .catch(() => setSwStatus("no_soportado"));
    } else {
      setSwStatus("no_soportado");
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Load pending ACKs from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const rawPending = window.localStorage.getItem(PENDING_ACKS_KEY);
      if (rawPending) {
        const parsed = JSON.parse(rawPending) as PendingOfflineAck[];
        if (Array.isArray(parsed)) setPendingAcks(parsed);
      }

      const rawNodes = window.localStorage.getItem(NODES_CACHE_KEY);
      if (rawNodes) {
        const parsedNodes = JSON.parse(rawNodes) as KioskNode[];
        if (Array.isArray(parsedNodes) && parsedNodes.length > 0) {
          setNodes(parsedNodes);
        }
      }
    } catch {
      // Ignore malformed localStorage entries
    }
  }, []);

  // Fetch Kiosk nodes when online
  useEffect(() => {
    if (isOffline) return;
    let cancelled = false;
    fetch("/api/kiosk/nodes", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { nodes?: KioskNode[] } | null) => {
        if (cancelled || !data?.nodes || data.nodes.length === 0) return;
        setNodes(data.nodes);
        try {
          window.localStorage.setItem(NODES_CACHE_KEY, JSON.stringify(data.nodes));
        } catch {
          // Ignore quota errors
        }
      })
      .catch(() => {
        // Keep cached or fallback nodes
      });
    return () => {
      cancelled = true;
    };
  }, [isOffline]);

  // Load localStore cache whenever selected kiosk changes, and auto-sync once when online if empty
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(getCacheStorageKey(selectedKioskId));
      if (raw) {
        setKioskCache(JSON.parse(raw) as StoredKioskCache);
        return;
      }
      setKioskCache(null);
    } catch {
      setKioskCache(null);
    }

    // The sync API requires a staff session: wait for the Navbar (auto-)login.
    if (!isOffline && staffId) {
      fetch(`/api/kiosk/sync?kiosk_id=${encodeURIComponent(selectedKioskId)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: StoredKioskCache | null) => {
          if (!data || !Array.isArray(data.local_cache_records)) return;
          setKioskCache(data);
          try {
            window.localStorage.setItem(getCacheStorageKey(selectedKioskId), JSON.stringify(data));
          } catch {
            // Ignore quota errors
          }
        })
        .catch(() => {
          // Ignore initial sync failure
        });
    }
  }, [selectedKioskId, isOffline, staffId]);

  const persistPendingAcks = (nextQueue: PendingOfflineAck[]) => {
    setPendingAcks(nextQueue);
    try {
      window.localStorage.setItem(PENDING_ACKS_KEY, JSON.stringify(nextQueue));
    } catch {
      // Ignore storage errors
    }
  };

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedKioskId) || nodes[0] || FALLBACK_NODES[0],
    [nodes, selectedKioskId]
  );

  const canOperateKioskDelivery =
    staffUser !== null &&
    (staffUser.role === "promotora_kiosco" ||
      staffUser.role === "eira_admin" ||
      staffUser.role === "medico");

  const handleActivatePromotoraRole = async () => {
    const promotora = STAFF_DEMO_ACCOUNTS.find((a) => a.id === "prom-1" || a.role === "promotora_kiosco");
    if (!promotora) return;
    setSwitchingPromotora(true);
    setBanner(null);
    try {
      const logged = await loginStaffDemoAccount(promotora);
      setStaffUser(logged);
      setBanner({
        type: "success",
        text: "Sesión activa como Rosa Hernández (Promotora Kiosco · Sierra Norte).",
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "No se pudo iniciar sesión como promotora.",
      });
    } finally {
      setSwitchingPromotora(false);
    }
  };

  const handleSyncStoreAndForward = useCallback(async () => {
    if (isOffline) {
      setBanner({
        type: "warning",
        text: "Estás en modo SIN SEÑAL (Offline). La caché cifrada local en este Raspberry Pi sigue operando sin internet.",
      });
      return;
    }

    setSyncing(true);
    setBanner(null);
    try {
      const res = await fetch(
        `/api/kiosk/sync?kiosk_id=${encodeURIComponent(selectedKioskId)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as StoredKioskCache & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Error al sincronizar Store-and-Forward.");
      }

      setKioskCache(data);
      try {
        window.localStorage.setItem(getCacheStorageKey(selectedKioskId), JSON.stringify(data));
      } catch {
        // Ignore quota errors
      }

      setNodes((prev) =>
        prev.map((n) => (n.id === data.node.id ? data.node : n))
      );

      setBanner({
        type: "success",
        text: `Store-and-Forward completado para ${data.node.name}: ${data.count} estudio(s) guardados con cifrado AES-256-GCM en almacenamiento local.`,
      });
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "No se pudo sincronizar el nodo.",
      });
    } finally {
      setSyncing(false);
    }
  }, [isOffline, selectedKioskId]);

  const lookupInLocalCache = useCallback(
    (rawInput: string, birthDateInput: string) => {
      const { folio, pseudonym } = parseScanInput(rawInput);
      const records = kioskCache?.local_cache_records ?? [];
      const match = records.find((r) => {
        if (pseudonym && r.pseudonym_code.toUpperCase() === pseudonym) return true;
        if (
          folio &&
          (r.patient_folio.toUpperCase() === folio ||
            r.sample_folio.toUpperCase() === folio ||
            r.pseudonym_code.toUpperCase() === folio)
        ) {
          return true;
        }
        return false;
      });

      if (!match) {
        setVerifiedResult({
          found: false,
          traffic_light: null,
          meta: null,
        });
        return;
      }

      const hasPending = pendingAcks.some((p) => p.study_id === match.study_id);
      const trafficLight = computeLocalTrafficLight(match, hasPending);
      const birthVerified =
        birthDateInput.trim().length > 0 ? match.birth_date === birthDateInput.trim() : null;

      setVerifiedResult({
        found: true,
        traffic_light: trafficLight,
        meta: {
          study_id: match.study_id,
          folio: match.patient_folio,
          pseudonym_code: match.pseudonym_code,
          status: match.status,
          delivery_mode: match.delivery_mode,
          community: match.community,
          sample_folio: match.sample_folio,
          loop_status: match.loop_status,
          birth_date_verified: birthVerified,
          source: "offline_local_cache",
          qr_data_url: match.qr_data_url,
        },
      });
    },
    [kioskCache, pendingAcks]
  );

  const handleVerifyQrOrFolio = async (overrideQuery?: string) => {
    const activeInput = (overrideQuery ?? scanQuery).trim();
    if (!activeInput) return;

    if (overrideQuery !== undefined) {
      setScanQuery(overrideQuery);
    }

    setVerifyLoading(true);
    setBanner(null);

    if (isOffline) {
      if (!kioskCache) {
        setBanner({
          type: "warning",
          text: "No hay caché local en este Raspberry Pi todavía. Cambia temporalmente a En Línea y pulsa 'Sincronizar Store-and-Forward'.",
        });
        setVerifyLoading(false);
        return;
      }
      lookupInLocalCache(activeInput, dobVerify);
      setVerifyLoading(false);
      return;
    }

    const { folio, pseudonym } = parseScanInput(activeInput);
    try {
      const res = await fetch("/api/kiosk/verify-qr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folio: folio || undefined,
          pseudonym_code: pseudonym || undefined,
          birth_date: dobVerify.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {
        found?: boolean;
        traffic_light?: TrafficLightResult | null;
        study_public_meta?: Omit<VerifiedStudyMeta, "source"> | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Error al consultar el semáforo clínico.");
      }

      if (!data.found || !data.study_public_meta) {
        setVerifiedResult({ found: false, traffic_light: null, meta: null });
      } else {
        const cachedMatch = kioskCache?.local_cache_records.find(
          (r) => r.study_id === data.study_public_meta?.study_id
        );
        setVerifiedResult({
          found: true,
          traffic_light: data.traffic_light ?? null,
          meta: {
            ...data.study_public_meta,
            source: "online_api",
            qr_data_url: cachedMatch?.qr_data_url,
          },
        });
      }
    } catch {
      // Automatic fallback to local cache if network fails unexpectedly
      if (kioskCache) {
        lookupInLocalCache(activeInput, dobVerify);
      } else {
        setBanner({
          type: "error",
          text: "Error de conexión y sin caché local disponible en el nodo.",
        });
      }
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleRegisterAssistedDelivery = async () => {
    const meta = verifiedResult?.meta;
    if (!meta) return;

    setBanner(null);

    if (isOffline) {
      const alreadyQueued = pendingAcks.some((p) => p.study_id === meta.study_id);
      if (alreadyQueued) {
        setBanner({
          type: "warning",
          text: `El estudio ${meta.pseudonym_code} ya está en la cola de salida offline pendiente por subir.`,
        });
        return;
      }

      const localAckFolio = `ACK-OFFLINE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const newPending: PendingOfflineAck = {
        local_id: `off-${Date.now()}`,
        ack_folio_local: localAckFolio,
        study_id: meta.study_id,
        sample_folio: meta.sample_folio,
        pseudonym_code: meta.pseudonym_code,
        patient_folio: meta.folio,
        kiosk_id: selectedKioskId,
        modality,
        notes: deliveryNotes.trim() || "Entrega asistida offline desde Kiosco Raspberry Pi",
        delivered_at: new Date().toISOString(),
        operator_name: staffUser?.name || "Rosa Hernández (Offline)",
      };

      const updatedQueue = [...pendingAcks, newPending];
      persistPendingAcks(updatedQueue);

      setVerifiedResult({
        found: true,
        traffic_light: {
          color: "gris",
          label: `Entrega guardada en cola offline (${localAckFolio}). Se subirá el ACK al reconectar.`,
        },
        meta: {
          ...meta,
          source: "offline_local_cache",
        },
      });

      setBanner({
        type: "success",
        text: `Entrega offline registrada localmente (${localAckFolio}). Reconecta la red para subir los ACKs pendientes y detener el loop.`,
      });
      return;
    }

    if (!canOperateKioskDelivery) {
      setBanner({
        type: "warning",
        text: "Activa primero la sesión de Rosa Hernández (Promotora Kiosco) para firmar la entrega asistida.",
      });
      return;
    }

    setSubmittingAck(true);
    try {
      const res = await fetch("/api/kiosk/assisted-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          study_id: meta.study_id,
          kiosk_id: selectedKioskId,
          modality,
          notes: deliveryNotes.trim(),
          synced_from_offline: false,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        delivery?: AssistedDelivery;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "No se pudo registrar la entrega asistida.");
      }

      setBanner({
        type: "success",
        text: `Entrega asistida registrada (${data.delivery?.ack_folio || "ACK"}). El motor Closed-Loop se detuvo automáticamente.`,
      });

      await handleVerifyQrOrFolio(meta.pseudonym_code);
      await handleSyncStoreAndForward();
    } catch (err) {
      setBanner({
        type: "error",
        text: err instanceof Error ? err.message : "Error al registrar entrega asistida.",
      });
    } finally {
      setSubmittingAck(false);
    }
  };

  const handleFlushPendingAcks = async () => {
    if (isOffline) {
      setBanner({
        type: "warning",
        text: "Desactiva el simulador Sin Señal para subir los ACKs pendientes al servidor central.",
      });
      return;
    }
    if (pendingAcks.length === 0) return;

    if (!canOperateKioskDelivery) {
      setBanner({
        type: "warning",
        text: "Inicia sesión como Rosa Hernández (Promotora Kiosco) para autorizar la subida de ACKs pendientes.",
      });
      return;
    }

    setFlushingQueue(true);
    setBanner(null);

    const remaining: PendingOfflineAck[] = [];
    let syncedCount = 0;
    let lastError = "";

    for (const item of pendingAcks) {
      try {
        const res = await fetch("/api/kiosk/assisted-delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            study_id: item.study_id,
            kiosk_id: item.kiosk_id || selectedKioskId,
            modality: item.modality,
            notes: `${item.notes} [Sincronizado desde Store-and-Forward · ${item.ack_folio_local}]`,
            synced_from_offline: true,
            delivered_at: item.delivered_at,
          }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          remaining.push(item);
          lastError = data.error || "Error al subir entrega";
        } else {
          syncedCount += 1;
        }
      } catch {
        remaining.push(item);
        lastError = "Error de red al intentar sincronizar";
      }
    }

    persistPendingAcks(remaining);
    if (syncedCount > 0) {
      await handleSyncStoreAndForward();
    }

    if (remaining.length === 0) {
      setBanner({
        type: "success",
        text: `${syncedCount} entrega(s) offline sincronizadas exitosamente (synced_from_offline: true). Loops cerrados con ACK.`,
      });
    } else {
      setBanner({
        type: "error",
        text: `Se sincronizaron ${syncedCount}, pero quedaron ${remaining.length} pendiente(s): ${lastError}`,
      });
    }

    setFlushingQueue(false);
  };

  const trafficCardTheme = (color: TrafficLightResult["color"]) => {
    switch (color) {
      case "rojo":
        return {
          container: "border-rose-300 bg-rose-50 text-rose-950",
          pill: "bg-rose-700 text-white",
          title: "SEMÁFORO ROJO PRIORITARIO",
        };
      case "verde":
        return {
          container: "border-emerald-300 bg-emerald-50 text-emerald-950",
          pill: "bg-emerald-700 text-white",
          title: "SEMÁFORO VERDE · LISTO",
        };
      case "ambar":
        return {
          container: "border-amber-300 bg-amber-50 text-amber-950",
          pill: "bg-amber-800 text-white",
          title: "SEMÁFORO ÁMBAR · EN VALIDACIÓN",
        };
      default:
        return {
          container: "border-slate-400 bg-slate-100 text-slate-900",
          pill: "bg-slate-700 text-white",
          title: "SEMÁFORO GRIS · ENTREGADO / ACK",
        };
    }
  };

  const cachedRecords = kioskCache?.local_cache_records ?? [];

  return (
    <div className="min-h-screen bg-transparent text-padi-ink">
      <Navbar onStaffChange={setStaffUser} />

      <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 space-y-5">
        {/* Hardware & Connectivity Status Bar */}
        <section className="rounded-4xl border-2 border-padi-line bg-white p-5 sm:p-7 shadow-soft space-y-4">
          <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="padi-eyebrow inline-flex items-center gap-1.5 rounded-full bg-padi-blush border border-padi-line px-3 py-1">
                  <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                  Modo Kiosco Comunitario · Raspberry Pi PWA
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
                    isOffline
                      ? "bg-amber-50 text-amber-950 border-amber-300"
                      : "bg-emerald-50 text-emerald-900 border-emerald-300"
                  }`}
                >
                  {isOffline ? (
                    <>
                      <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                      {isSimulatedOffline
                        ? "SIN SEÑAL (Simulación Sierra Norte)"
                        : "SIN INTERNET (Red desconectada)"}
                    </>
                  ) : (
                    <>
                      <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
                      EN LÍNEA · Sincronización activa
                    </>
                  )}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                  Service Worker:{" "}
                  {swStatus === "activo"
                    ? "PWA Offline Lista"
                    : swStatus === "registrando"
                    ? "Registrando..."
                    : "Navegador básico"}
                </span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tighter text-padi-plum">
                {selectedNode.name}
              </h1>
              <p className="text-xs sm:text-sm text-slate-600 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>
                  <strong>Hardware:</strong> {selectedNode.hardware_profile}
                </span>
                <span className="font-mono text-xs text-slate-700">
                  SSID: {selectedNode.hotspot_ssid}
                </span>
                <span className="font-mono text-xs text-eira-700 font-semibold">
                  {selectedNode.lora_channel}
                </span>
              </p>
            </div>

            {/* Online/Offline Simulator Toggle + Node Selector */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
              <div>
                <label htmlFor="kiosk-node-select" className="sr-only">
                  Seleccionar nodo Raspberry Pi
                </label>
                <select
                  id="kiosk-node-select"
                  value={selectedKioskId}
                  onChange={(e) => {
                    setSelectedKioskId(e.target.value);
                    setVerifiedResult(null);
                  }}
                  className="min-h-[50px] w-full sm:w-auto rounded-2xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/30"
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.id} · {node.community}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setIsSimulatedOffline((prev) => !prev)}
                className={`min-h-[50px] inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-extrabold shadow-sm transition border-2 ${
                  isSimulatedOffline
                    ? "border-amber-600 bg-amber-500 text-slate-950 hover:bg-amber-400"
                    : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                }`}
              >
                {isSimulatedOffline ? (
                  <>
                    <CloudOff className="h-5 w-5" aria-hidden="true" />
                    Simulador: SIN SEÑAL (Clic para reconectar)
                  </>
                ) : (
                  <>
                    <Wifi className="h-5 w-5" aria-hidden="true" />
                    Simular Corte de Señal (Modo Offline)
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Store-and-Forward Sync Bar + Pending Outbox Queue + Staff Switch */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 pt-1">
            {/* Downlink Store-and-Forward */}
            <div className="rounded-3xl border-2 border-padi-line bg-padi-blush/50 p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Caché Local Cifrada (Downlink)
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold text-slate-900">
                    {kioskCache
                      ? `${kioskCache.count} estudio(s) en ${selectedKioskId}`
                      : "Sin sincronizar en este navegador"}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {kioskCache
                      ? `Última sync: ${new Date(kioskCache.synced_at).toLocaleTimeString("es-MX")}`
                      : "Sincroniza antes de salir a zona rural"}
                  </p>
                </div>
                <Database className="h-5 w-5 text-eira-600 shrink-0" aria-hidden="true" />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={syncing || isOffline}
                  onClick={() => void handleSyncStoreAndForward()}
                  className="min-h-[48px] flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-padi-berry px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-eira-700 disabled:opacity-50 transition"
                >
                  <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
                  {syncing ? "Sincronizando..." : "Sincronizar Store-and-Forward"}
                </button>
                {kioskCache?.encrypted_bundle && (
                  <button
                    type="button"
                    onClick={() => setShowCipherInspect((prev) => !prev)}
                    className="min-h-[46px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
                  >
                    {showCipherInspect ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                    AES-256-GCM
                  </button>
                )}
              </div>
            </div>

            {/* Uplink Outbox Queue */}
            <div
              className={`rounded-2xl border p-3.5 flex flex-col justify-between gap-3 ${
                pendingAcks.length > 0
                  ? "border-amber-300 bg-amber-50"
                  : "border-padi-line bg-padi-blush/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Cola de Salida Offline (Uplink ACK)
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold text-slate-900">
                    {pendingAcks.length} ACK(s) pendiente(s) de subir
                  </p>
                  <p className="text-[11px] text-slate-600">
                    Se guardan en <code className="font-mono">localStorage</code> cuando no hay señal
                  </p>
                </div>
                <UploadCloud
                  className={`h-5 w-5 shrink-0 ${
                    pendingAcks.length > 0 ? "text-amber-700" : "text-slate-400"
                  }`}
                  aria-hidden="true"
                />
              </div>

              <button
                type="button"
                disabled={isOffline || pendingAcks.length === 0 || flushingQueue}
                onClick={() => void handleFlushPendingAcks()}
                className="min-h-[46px] w-full inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2 text-xs sm:text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-45 transition"
              >
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
                {flushingQueue
                  ? "Subiendo ACKs..."
                  : `Subir ACKs pendientes al reconectar (${pendingAcks.length})`}
              </button>
            </div>

            {/* Staff Promotora Session Control */}
            <div className="rounded-3xl border-2 border-padi-line bg-padi-blush/50 p-4 flex flex-col justify-between gap-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Operadora del Kiosco (Firma ACK)
                  </p>
                  <p className="mt-0.5 text-sm font-extrabold text-slate-900">
                    {staffUser ? staffUser.name : "Sin sesión de personal activa"}
                  </p>
                  <p className="text-[11px] text-slate-600">
                    {canOperateKioskDelivery
                      ? `Rol autorizado (${staffUser?.role}) para entregar y cerrar loop`
                      : "Requerido al subir o confirmar entrega en línea"}
                  </p>
                </div>
                <UserCheck
                  className={`h-5 w-5 shrink-0 ${
                    canOperateKioskDelivery ? "text-emerald-600" : "text-slate-400"
                  }`}
                  aria-hidden="true"
                />
              </div>

              {canOperateKioskDelivery ? (
                <div className="min-h-[46px] flex items-center justify-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                  Operadora autorizada activa
                </div>
              ) : (
                <button
                  type="button"
                  disabled={switchingPromotora || isOffline}
                  onClick={() => void handleActivatePromotoraRole()}
                  className="min-h-[46px] w-full inline-flex items-center justify-center gap-2 rounded-xl border border-eira-300 bg-white px-3.5 py-2 text-xs sm:text-sm font-bold text-eira-700 hover:bg-eira-50 disabled:opacity-50 transition"
                >
                  <KeyRound className="h-4 w-4" aria-hidden="true" />
                  {switchingPromotora
                    ? "Activando sesión..."
                    : "Cambiar a Rosa Hernández (Promotora Kiosco)"}
                </button>
              )}
            </div>
          </div>

          {/* AES-256-GCM Ciphertext & SHA-256 Inspection Drawer */}
          {showCipherInspect && kioskCache?.encrypted_bundle && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4 text-slate-100 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  Paquete Store-and-Forward Cifrado ({kioskCache.encrypted_bundle.algorithm})
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  SHA-256: {kioskCache.encrypted_bundle.sha256}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                <div className="rounded-xl bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400">IV (hex): </span>
                  <span className="text-amber-300 break-all">
                    {kioskCache.encrypted_bundle.iv_hex}
                  </span>
                </div>
                <div className="rounded-xl bg-slate-900 p-2.5 border border-slate-800">
                  <span className="text-slate-400">Auth Tag (hex): </span>
                  <span className="text-sky-300 break-all">
                    {kioskCache.encrypted_bundle.auth_tag_hex}
                  </span>
                </div>
              </div>
              <div className="rounded-xl bg-slate-900 p-2.5 border border-slate-800 font-mono text-[11px] text-emerald-300 break-all">
                <span className="text-slate-400">Ciphertext (Base64): </span>
                {kioskCache.encrypted_bundle.ciphertext_b64.slice(0, 260)}...
              </div>
            </div>
          )}
        </section>

        {/* Feedback Banner */}
        {banner && (
          <div
            role="status"
            className={`flex items-start gap-3 rounded-2xl border p-4 text-sm font-semibold ${
              banner.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                : banner.type === "warning"
                ? "border-amber-300 bg-amber-50 text-amber-950"
                : "border-rose-300 bg-rose-50 text-rose-900"
            }`}
          >
            {banner.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden="true" />
            )}
            <span>{banner.text}</span>
          </div>
        )}

        {/* 3 Large Touchscreen Kiosk Tabs */}
        <nav aria-label="Modos del Kiosco Comunitario" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("entrega")}
            className={`min-h-[64px] flex items-center justify-center gap-2.5 rounded-full border-2 px-5 py-3 text-sm sm:text-base font-extrabold transition ${
              activeTab === "entrega"
                ? "border-padi-berry bg-padi-berry text-white shadow-soft"
                : "border-padi-line bg-white text-padi-plum hover:border-padi-pink"
            }`}
          >
            <QrCode className="h-5 w-5 shrink-0" aria-hidden="true" />
            1. Entrega Asistida & Semáforo QR
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("cola")}
            className={`min-h-[64px] flex items-center justify-center gap-2.5 rounded-full border-2 px-5 py-3 text-sm sm:text-base font-extrabold transition ${
              activeTab === "cola"
                ? "border-padi-berry bg-padi-berry text-white shadow-soft"
                : "border-padi-line bg-white text-padi-plum hover:border-padi-pink"
            }`}
          >
            <Database className="h-5 w-5 shrink-0" aria-hidden="true" />
            2. Cola Local ({cachedRecords.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("preventiva")}
            className={`min-h-[64px] flex items-center justify-center gap-2.5 rounded-full border-2 px-5 py-3 text-sm sm:text-base font-extrabold transition ${
              activeTab === "preventiva"
                ? "border-padi-berry bg-padi-berry text-white shadow-soft"
                : "border-padi-line bg-white text-padi-plum hover:border-padi-pink"
            }`}
          >
            <BookOpen className="h-5 w-5 shrink-0" aria-hidden="true" />
            3. Información Preventiva Offline
          </button>
        </nav>

        {/* TAB 1: Entrega Asistida & Semáforo QR */}
        {activeTab === "entrega" && (
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Search / Scan Box */}
            <div className="lg:col-span-5 rounded-4xl border-2 border-padi-line bg-white p-6 sm:p-7 shadow-soft space-y-5">
              <div>
                <h2 className="text-lg font-extrabold text-slate-900">
                  Escanear QR / Buscar Folio o Pseudónimo
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-slate-600">
                  Funciona tanto conectado como en <strong>caché cifrada offline</strong> sin
                  internet.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="kiosk-scan-input" className="block text-sm font-bold text-slate-800 mb-1.5">
                    Código QR, Pseudónimo o Folio
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="kiosk-scan-input"
                      type="text"
                      value={scanQuery}
                      onChange={(e) => setScanQuery(e.target.value)}
                      placeholder="Ej. EIRA-ALR-4104 o PAC-2026-003"
                      className="min-h-[64px] w-full rounded-3xl border-2 border-padi-line bg-white pl-12 pr-4 font-mono text-lg sm:text-xl font-semibold text-padi-ink focus:border-padi-pink focus:outline-none focus:ring-4 focus:ring-padi-berry/15"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="kiosk-dob-verify" className="block text-sm font-bold text-slate-800 mb-1.5">
                    Fecha de Nacimiento (Cotejo opcional en mostrador)
                  </label>
                  <input
                    id="kiosk-dob-verify"
                    type="date"
                    value={dobVerify}
                    onChange={(e) => setDobVerify(e.target.value)}
                    className="min-h-[64px] w-full rounded-3xl border-2 border-padi-line bg-white px-4 text-lg font-semibold text-padi-ink focus:border-padi-pink focus:outline-none focus:ring-4 focus:ring-padi-berry/15"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setScannerOpen(true)}
                    className="min-h-[64px] w-full inline-flex items-center justify-center gap-2 rounded-full border-2 border-padi-berry bg-white px-4 py-3 text-sm sm:text-base font-extrabold text-padi-berry hover:bg-padi-blush transition"
                  >
                    <Camera className="h-5 w-5" aria-hidden="true" />
                    Escanear QR (Cámara / PC)
                  </button>

                  <button
                    type="button"
                    disabled={verifyLoading}
                    onClick={() => void handleVerifyQrOrFolio()}
                    className="min-h-[64px] w-full inline-flex items-center justify-center gap-2 rounded-full bg-padi-berry px-5 py-3 text-sm sm:text-base font-bold text-white shadow-soft hover:bg-eira-700 disabled:opacity-60 transition"
                  >
                    <QrCode className="h-5 w-5" aria-hidden="true" />
                    {verifyLoading
                      ? "Consultando..."
                      : isOffline
                      ? "Consultar Caché Offline"
                      : "Consultar Semáforo"}
                  </button>
                </div>
              </div>

              {/* 1-tap Demo Chips */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Pruebas rápidas en pantalla táctil
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { code: "EIRA-ALR-4104", label: "EIRA-ALR-4104 (Rojo · Carmen)" },
                    { code: "EIRA-ALR-4105", label: "EIRA-ALR-4105 (Verde · Juana)" },
                    { code: "EIRA-ALR-4103", label: "EIRA-ALR-4103 (Verde · Patricia)" },
                  ].map((chip) => (
                    <button
                      key={chip.code}
                      type="button"
                      onClick={() => void handleVerifyQrOrFolio(chip.code)}
                      className="min-h-[44px] rounded-full border-2 border-padi-line bg-padi-blush px-3 py-1.5 text-xs font-bold text-padi-plum hover:border-padi-pink hover:bg-padi-pale transition"
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Semáforo Result + Assisted Delivery Form */}
            <div className="lg:col-span-7 rounded-4xl border-2 border-padi-line bg-white p-6 sm:p-7 shadow-soft">
              {!verifiedResult ? (
                <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center p-6 space-y-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-eira-50 text-eira-600 border border-eira-200">
                    <Sparkles className="h-7 w-7" aria-hidden="true" />
                  </div>
                  <h3 className="text-lg font-extrabold text-slate-900">
                    Escanea un código QR o toca una prueba rápida
                  </h3>
                  <p className="text-sm text-slate-600 max-w-md">
                    El Semáforo Clínico indica a la promotora si la entrega es habitual (Verde) o
                    acompañada prioritaria (Rojo) sin exponer diagnósticos en texto plano.
                  </p>
                </div>
              ) : !verifiedResult.found || !verifiedResult.meta || !verifiedResult.traffic_light ? (
                <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center p-6 space-y-2 rounded-2xl border border-slate-200 bg-slate-50">
                  <Info className="h-8 w-8 text-slate-500" aria-hidden="true" />
                  <h3 className="text-lg font-bold text-slate-900">
                    No se encontró ningún estudio para &ldquo;{scanQuery}&rdquo;
                  </h3>
                  <p className="text-sm text-slate-600 max-w-md">
                    {isOffline
                      ? "Verifica si este estudio corresponde al nodo seleccionado o sincroniza antes de salir de cobertura."
                      : "Revisa el folio de paciente (PAC-...), muestra (PAP-...) o pseudónimo (EIRA-ALR-...)."}
                  </p>
                </div>
              ) : (
                (() => {
                  const { meta, traffic_light } = verifiedResult;
                  const theme = trafficCardTheme(traffic_light.color);
                  const isClosed =
                    traffic_light.color === "gris" ||
                    meta.status === "entregado_asistido" ||
                    meta.loop_status === "cerrado_ack";

                  return (
                    <div className="space-y-5">
                      {/* Semáforo Banner */}
                      <div className={`rounded-3xl border-2 p-5 space-y-3 ${theme.container}`}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`rounded-full px-3.5 py-1 text-xs font-extrabold ${theme.pill}`}>
                            {theme.title}
                          </span>
                          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-slate-800 border border-black/10">
                            {meta.source === "offline_local_cache"
                              ? "Fuente: Caché Cifrada Offline"
                              : "Fuente: Servidor Central"}
                          </span>
                        </div>

                        <p className="text-base sm:text-lg font-extrabold leading-snug">
                          {traffic_light.label}
                        </p>

                        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs font-semibold">
                          <span className="rounded-xl bg-white/80 px-3 py-1.5 font-mono">
                            Pseudónimo: {meta.pseudonym_code}
                          </span>
                          <span className="rounded-xl bg-white/80 px-3 py-1.5 font-mono">
                            Folio: {meta.folio || meta.sample_folio}
                          </span>
                          <span className="rounded-xl bg-white/80 px-3 py-1.5">
                            Comunidad: {meta.community}
                          </span>
                          {meta.birth_date_verified !== null && (
                            <span
                              className={`rounded-xl px-3 py-1.5 font-bold ${
                                meta.birth_date_verified
                                  ? "bg-emerald-600 text-white"
                                  : "bg-rose-600 text-white"
                              }`}
                            >
                              {meta.birth_date_verified
                                ? "Fecha de nacimiento COINCIDE"
                                : "Fecha de nacimiento NO coincide"}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Assisted Delivery Registration */}
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                            <HeartHandshake className="h-5 w-5 text-eira-600" aria-hidden="true" />
                            Registrar Entrega Asistida con Acuse (ACK)
                          </h3>
                          <button
                            type="button"
                            onClick={() =>
                              setQrModalRecord({
                                patientFolio: meta.folio,
                                sampleFolio: meta.sample_folio,
                                pseudonymCode: meta.pseudonym_code,
                                community: meta.community,
                                kioskId: selectedKioskId,
                                priority:
                                  traffic_light.color === "rojo" ? "prioritario" : "rutinario",
                                deliveryMode: meta.delivery_mode,
                                qrDataUrl: meta.qr_data_url,
                              })
                            }
                            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-eira-300 bg-white px-3 py-1.5 text-xs font-bold text-eira-700 hover:bg-eira-50 transition"
                          >
                            <QrCode className="h-4 w-4" aria-hidden="true" />
                            Ver Tarjeta QR
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {MODALITY_OPTIONS.map((opt) => {
                            const selected = modality === opt.value;
                            return (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setModality(opt.value)}
                                className={`min-h-[60px] text-left rounded-2xl border p-3 transition ${
                                  selected
                                    ? "border-eira-600 bg-eira-50 ring-1 ring-eira-300"
                                    : "border-slate-200 bg-white hover:border-eira-300"
                                }`}
                              >
                                <p className="text-xs sm:text-sm font-bold text-slate-900">
                                  {opt.label}
                                </p>
                                <p className="text-[11px] text-slate-600 mt-0.5">{opt.hint}</p>
                              </button>
                            );
                          })}
                        </div>

                        <div>
                          <label
                            htmlFor="kiosk-delivery-notes"
                            className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1.5"
                          >
                            Notas de entrega (sin diagnósticos)
                          </label>
                          <textarea
                            id="kiosk-delivery-notes"
                            rows={2}
                            value={deliveryNotes}
                            onChange={(e) => setDeliveryNotes(e.target.value)}
                            className="w-full rounded-2xl border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-eira-500 focus:outline-none focus:ring-2 focus:ring-eira-500/30"
                          />
                        </div>

                        {!isOffline && !canOperateKioskDelivery && !isClosed && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5">
                            <p className="text-xs font-semibold text-amber-950">
                              Para firmar esta entrega en línea, activa primero el rol de Promotora
                              Kiosco.
                            </p>
                            <button
                              type="button"
                              disabled={switchingPromotora}
                              onClick={() => void handleActivatePromotoraRole()}
                              className="min-h-[42px] shrink-0 rounded-xl bg-amber-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-amber-700 transition"
                            >
                              Activar Rosa Hernández
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          disabled={isClosed || submittingAck}
                          onClick={() => void handleRegisterAssistedDelivery()}
                          className={`min-h-[56px] w-full inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm sm:text-base font-extrabold text-white shadow-sm transition ${
                            isClosed
                              ? "bg-emerald-600 opacity-85 cursor-default"
                              : isOffline
                              ? "bg-amber-600 hover:bg-amber-700"
                              : "bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
                          }`}
                        >
                          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                          {isClosed
                            ? "Entrega ya registrada (ACK cerrado)"
                            : submittingAck
                            ? "Guardando entrega y deteniendo loop..."
                            : isOffline
                            ? "Guardar Entrega en Cola Offline (Store-and-Forward)"
                            : "Registrar Entrega Asistida y Enviar ACK"}
                        </button>
                      </div>
                    </div>
                  );
                })()
              )}
            </div>
          </section>
        )}

        {/* TAB 2: Cola Local de la Comunidad (Caché Cifrada) */}
        {activeTab === "cola" && (
          <section className="rounded-4xl border-2 border-padi-line bg-white p-6 sm:p-7 shadow-soft space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-slate-900">
                  Estudios en Caché Local del Nodo {selectedKioskId}
                </h2>
                <p className="text-xs sm:text-sm text-slate-600">
                  Registros sincronizados en este Raspberry Pi para consulta y entrega asistida sin
                  internet.
                </p>
              </div>
              {!isOffline && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void handleSyncStoreAndForward()}
                  className="min-h-[46px] inline-flex items-center gap-2 rounded-2xl bg-eira-600 px-4 py-2 text-sm font-bold text-white hover:bg-eira-700 transition"
                >
                  <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
                  Actualizar caché ahora
                </button>
              )}
            </div>

            {cachedRecords.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center space-y-3">
                <Database className="h-9 w-9 text-slate-400 mx-auto" aria-hidden="true" />
                <h3 className="text-base font-bold text-slate-900">
                  Aún no has descargado el paquete Store-and-Forward para {selectedKioskId}
                </h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  Pulsa &ldquo;Sincronizar Store-and-Forward&rdquo; con señal para guardar los
                  estudios comunitarios cifrados con AES-256-GCM.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cachedRecords.map((rec) => {
                  const hasPending = pendingAcks.some((p) => p.study_id === rec.study_id);
                  const tl = computeLocalTrafficLight(rec, hasPending);
                  const theme = trafficCardTheme(tl.color);

                  return (
                    <article
                      key={rec.study_id}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-extrabold ${theme.pill}`}>
                          {theme.title}
                        </span>
                        <span className="font-mono text-xs font-bold text-eira-700">
                          {rec.pseudonym_code}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-base font-extrabold text-slate-900">
                          {rec.patient_name}
                        </h3>
                        <p className="text-xs text-slate-600 font-mono">
                          Folio: {rec.patient_folio} · Muestra: {rec.sample_folio} · Toma:{" "}
                          {rec.collection_date}
                        </p>
                        <p className="text-xs text-slate-700 flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-eira-600" aria-hidden="true" />
                          {rec.community} · {STATUS_LABELS[rec.status] || rec.status}
                        </p>
                      </div>

                      {hasPending ? (
                        <div className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-2 text-xs font-bold text-amber-950 flex items-center gap-1.5">
                          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
                          ACK guardado en cola offline (pendiente subir)
                        </div>
                      ) : rec.ack_received_at ? (
                        <div className="rounded-xl border border-emerald-300 bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          Entregado / ACK confirmado
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab("entrega");
                            void handleVerifyQrOrFolio(rec.pseudonym_code);
                          }}
                          className="min-h-[44px] flex-1 rounded-xl bg-eira-600 px-3 py-2 text-xs font-bold text-white hover:bg-eira-700 transition"
                        >
                          Abrir en Entrega Asistida
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setQrModalRecord({
                              patientFolio: rec.patient_folio,
                              sampleFolio: rec.sample_folio,
                              pseudonymCode: rec.pseudonym_code,
                              patientName: rec.patient_name,
                              community: rec.community,
                              kioskId: selectedKioskId,
                              priority: rec.priority,
                              deliveryMode: rec.delivery_mode,
                              qrDataUrl: rec.qr_data_url,
                            })
                          }
                          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 hover:bg-slate-100 transition"
                        >
                          <QrCode className="h-4 w-4" aria-hidden="true" />
                          Tarjeta QR
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB 3: Información Preventiva Offline (100% Sin Internet) */}
        {activeTab === "preventiva" && (
          <section className="space-y-4">
            <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                  <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                  Contenido 100% Offline · Disponible sin señal
                </span>
                <h2 className="text-xl font-extrabold text-emerald-950">
                  Guía de Salud Preventiva y Cuidado Cervical EIRA
                </h2>
                <p className="text-sm text-emerald-900">
                  Información clara y sin tecnicismos para pacientes y familias en el Kiosco
                  Comunitario.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLargeTextMode((prev) => !prev)}
                className="min-h-[48px] shrink-0 rounded-2xl border border-emerald-400 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:bg-emerald-100 transition"
              >
                {largeTextMode ? "Tamaño de letra estándar" : "Ampliar letra (Lectura fácil)"}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PREVENTIVE_CARDS.map((card) => {
                const badgeClass =
                  card.tone === "rose"
                    ? "bg-eira-100 text-eira-800 border-eira-200"
                    : card.tone === "emerald"
                    ? "bg-emerald-100 text-emerald-900 border-emerald-200"
                    : card.tone === "amber"
                    ? "bg-amber-100 text-amber-950 border-amber-200"
                    : "bg-slate-100 text-slate-800 border-slate-200";

                return (
                  <article
                    key={card.title}
                    className="rounded-4xl border-2 border-padi-line bg-white p-6 sm:p-7 shadow-soft space-y-3"
                  >
                    <span
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold ${badgeClass}`}
                    >
                      {card.badge}
                    </span>
                    <h3
                      className={`font-extrabold text-slate-900 ${
                        largeTextMode ? "text-xl sm:text-2xl" : "text-lg"
                      }`}
                    >
                      {card.title}
                    </h3>
                    <ul
                      className={`space-y-2.5 text-slate-700 list-disc list-inside leading-relaxed ${
                        largeTextMode ? "text-base sm:text-lg" : "text-sm"
                      }`}
                    >
                      {card.points.map((pt) => (
                        <li key={pt}>{pt}</li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {/* Printable QR Card Modal */}
      {qrModalRecord && (
        <QrCardModal
          isOpen={Boolean(qrModalRecord)}
          onClose={() => setQrModalRecord(null)}
          patientFolio={qrModalRecord.patientFolio}
          sampleFolio={qrModalRecord.sampleFolio}
          pseudonymCode={qrModalRecord.pseudonymCode}
          patientName={qrModalRecord.patientName}
          community={qrModalRecord.community}
          kioskId={qrModalRecord.kioskId}
          priority={qrModalRecord.priority}
          deliveryMode={qrModalRecord.deliveryMode}
          qrDataUrl={qrModalRecord.qrDataUrl}
        />
      )}
      <QrScannerModal
        open={scannerOpen}
        title="Escanear Tarjeta QR Semáforo EIRA"
        subtitle="Usa la cámara del celular/webcam o selecciona una imagen QR en la computadora (funciona incluso sin internet)."
        onClose={() => setScannerOpen(false)}
        onDetected={(rawQrValue) => {
          setBanner({
            type: "success",
            text: "Código QR leído correctamente. Consultando Semáforo Clínico...",
          });
          void handleVerifyQrOrFolio(rawQrValue);
        }}
      />
    </div>
  );
}
