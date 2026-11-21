/**
 * RETO 1 · Detección de posibles duplicados con varios atributos.
 * Solo PROPONE candidatas con puntaje y razones; nunca fusiona ni decide sola.
 */
import { db, type Paciente } from "@/lib/db";

export type DatosPaciente = {
  nombre: string; fecha_nacimiento: string; telefono?: string | null; correo?: string | null;
  curp?: string | null; municipio?: string | null; canal_preferido?: string | null;
};

export type Candidata = {
  paciente: Pick<Paciente, "id" | "id_eira" | "nombre" | "fecha_nacimiento" | "municipio">;
  puntaje: number; nivel: "alta" | "media" | "baja"; razones: string[];
};

export const UMBRAL_CONFIRMACION = 50;

/** Quita acentos, mayúsculas, signos y espacios repetidos. */
export function normalizarNombre(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

const soloDigitos = (s?: string | null) => (s ?? "").replace(/\D/g, "").slice(-10);

function levenshtein(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Similitud de nombres 0..1: tolera orden distinto, nombres omitidos y errores de dedo. */
export function similitudNombre(a: string, b: string) {
  const na = normalizarNombre(a), nb = normalizarNombre(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = na.split(" "), tb = nb.split(" ");
  const parecidos = (x: string, y: string) => x === y || (x.length > 3 && y.length > 3 && levenshtein(x, y) <= 1);
  const comunes = ta.filter((x) => tb.some((y) => parecidos(x, y))).length;
  const tokens = comunes / Math.max(ta.length, tb.length);
  const cadena = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return Math.max(tokens, cadena);
}

/** Puntaje 0..100 con las razones que lo explican (para que una persona decida). */
export function puntuar(d: DatosPaciente, p: Paciente): { puntaje: number; razones: string[] } {
  const razones: string[] = [];
  let puntaje = 0;
  const sim = similitudNombre(d.nombre, p.nombre);
  if (sim === 1) { puntaje += 40; razones.push("Mismo nombre"); }
  else if (sim >= 0.75) { puntaje += 30; razones.push(`Nombre muy parecido (${Math.round(sim * 100)}%)`); }
  else if (sim >= 0.5) { puntaje += 15; razones.push(`Nombre parecido (${Math.round(sim * 100)}%)`); }
  if (d.fecha_nacimiento && d.fecha_nacimiento === p.fecha_nacimiento) { puntaje += 35; razones.push("Misma fecha de nacimiento"); }
  else if (d.fecha_nacimiento && p.fecha_nacimiento && d.fecha_nacimiento.slice(0, 4) === p.fecha_nacimiento.slice(0, 4) && sim >= 0.75) {
    puntaje += 8; razones.push("Mismo año de nacimiento");
  }
  if (d.curp && p.curp && d.curp.trim().toUpperCase() === p.curp.toUpperCase()) { puntaje += 60; razones.push("Misma CURP"); }
  const tel = soloDigitos(d.telefono);
  if (tel.length === 10 && tel === soloDigitos(p.telefono)) { puntaje += 20; razones.push("Mismo teléfono"); }
  if (d.correo && p.correo && d.correo.trim().toLowerCase() === p.correo.toLowerCase()) { puntaje += 20; razones.push("Mismo correo"); }
  if (d.municipio && p.municipio && normalizarNombre(d.municipio) === normalizarNombre(p.municipio) && puntaje > 0) { puntaje += 5; razones.push("Mismo municipio"); }
  return { puntaje: Math.min(100, puntaje), razones };
}

/** Lista candidatas ordenadas por puntaje. `excluirId` evita compararse consigo misma. */
export function candidatasPara(d: DatosPaciente, excluirId?: string): Candidata[] {
  const todas = db().prepare("SELECT * FROM pacientes").all() as Paciente[];
  return todas
    .filter((p) => p.id !== excluirId)
    .map((p) => {
      const { puntaje, razones } = puntuar(d, p);
      const nivel: Candidata["nivel"] = puntaje >= 75 ? "alta" : puntaje >= UMBRAL_CONFIRMACION ? "media" : "baja";
      return { paciente: { id: p.id, id_eira: p.id_eira, nombre: p.nombre, fecha_nacimiento: p.fecha_nacimiento, municipio: p.municipio }, puntaje, nivel, razones };
    })
    .filter((c) => c.puntaje >= 25)
    .sort((a, b) => b.puntaje - a.puntaje)
    .slice(0, 8);
}
