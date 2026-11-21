import { db, type Estudio } from "./db";
import { daysSince } from "./clock";

export type EstudioRow = Estudio & { paciente_nombre: string | null; id_eira: string | null; municipio: string | null; canal_preferido: string | null };

export function listarEstudios(): EstudioRow[] {
  return db().prepare(
    `SELECT e.*, p.nombre AS paciente_nombre, p.id_eira, p.municipio, p.canal_preferido
     FROM estudios e LEFT JOIN pacientes p ON p.id = e.paciente_id ORDER BY e.creado_en DESC`,
  ).all() as EstudioRow[];
}

export type Alerta = { estudio: EstudioRow; tipo: "asistida" | "seguimiento" | "prioritario"; texto: string };

export function alertas(rows: EstudioRow[]): Alerta[] {
  const out: Alerta[] = [];
  for (const e of rows) {
    if (e.cerrado_en || e.estado === "consultado") continue;
    if (e.requiere_asistida && ["autorizado_digital", "autorizado_acompanado"].includes(e.estado))
      out.push({ estudio: e, tipo: "asistida", texto: "Sin canal digital o falló el envío: requiere entrega asistida" });
    if (e.estado === "autorizado_acompanado") {
      const dias = daysSince(e.autorizado_en);
      if (e.prioridad === "prioritario" && dias > 2)
        out.push({ estudio: e, tipo: "prioritario", texto: `Acompañamiento prioritario sin cerrar (${Math.floor(dias)} días > 48 h)` });
      else if (e.prioridad !== "prioritario" && dias > 7)
        out.push({ estudio: e, tipo: "seguimiento", texto: `Entrega acompañada sin cerrar (${Math.floor(dias)} días > 7): agendar cita` });
    }
    if (e.estado === "notificado" && daysSince(e.notificado_en) > 7)
      out.push({ estudio: e, tipo: "seguimiento", texto: `Notificado hace ${Math.floor(daysSince(e.notificado_en))} días sin consulta: llamada de seguimiento` });
  }
  return out;
}
