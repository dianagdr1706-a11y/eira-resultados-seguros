export const ESTADOS: Record<string, { label: string; color: string }> = {
  cargado: { label: "Cargado (sin asociar)", color: "bg-slate-100 text-slate-700" },
  revision_admin: { label: "Por revisar (Admin)", color: "bg-sky-100 text-sky-800" },
  devuelto: { label: "Devuelto a corrección", color: "bg-orange-100 text-orange-800" },
  pendiente_clinica: { label: "Por autorizar (Clínica)", color: "bg-violet-100 text-violet-800" },
  autorizado_digital: { label: "Autorizado: entrega digital", color: "bg-emerald-100 text-emerald-800" },
  autorizado_acompanado: { label: "Acompañamiento prioritario", color: "bg-rose-100 text-rose-800" },
  notificado: { label: "Notificado sin consultar", color: "bg-amber-100 text-amber-800" },
  consultado: { label: "Consultado / Descargado", color: "bg-green-100 text-green-800" },
  entregado_asistido: { label: "Entregado (asistido)", color: "bg-teal-100 text-teal-800" },
};

export const ROLES: Record<string, string> = {
  laboratorio: "Laboratorio",
  eira_admin: "Administración EIRA",
  medico: "Médico / Clínico",
  auditoria: "Auditoría",
};

export const MODALIDADES: Record<string, string> = {
  presencial_eira: "Entrega presencial en oficina EIRA",
  jornada: "Entrega en jornada municipal",
  centro_salud: "Entrega en centro de salud aliado",
  llamada_seguimiento: "Llamada de seguimiento",
  tercero_autorizado: "Entrega a persona autorizada",
  orientacion_medica: "Orientación médica y entrega acompañada",
};

export function fmt(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" });
}

export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
