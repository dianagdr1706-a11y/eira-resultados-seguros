import { getDb } from "./db";
import type { MatchCandidate, MatchReason, PatientCaptureInput } from "./types";

/**
 * Reto 1 · Detección de coincidencias multi-atributo (explicable, sin fusión automática).
 *
 * Every point awarded carries a human-readable reason so the operator can decide.
 * Thresholds: >= 70 "probable" (likely same woman), 40-69 "posible". Below 40 is ignored.
 * The system NEVER links or merges on its own: callers must require explicit human confirmation.
 */

export const MATCH_PROBABLE_THRESHOLD = 70;
export const MATCH_POSSIBLE_THRESHOLD = 40;

const PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "van", "von"]);
const ABBREVIATIONS: Record<string, string> = {
  ma: "maria",
  mria: "maria",
  gpe: "guadalupe",
  guad: "guadalupe",
  fco: "francisco",
  ma_: "maria",
};

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized name tokens: no accents, no particles, common abbreviations expanded. */
export function nameTokens(fullName: string): string[] {
  return normalizeText(fullName)
    .split(" ")
    .filter(Boolean)
    .map((t) => ABBREVIATIONS[t] ?? t)
    .filter((t) => !PARTICLES.has(t));
}

/** Last 10 digits of a phone number, or null. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

export function maskPhone(phone: string | null | undefined): string | null {
  const p = normalizePhone(phone);
  if (!p) return null;
  return `${"*".repeat(Math.max(0, p.length - 4))}${p.slice(-4)}`;
}

/** Levenshtein distance (small strings only). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Two tokens "match" if equal or within 1 edit (typos) when length >= 5. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 5 && b.length >= 5) return levenshtein(a, b) <= 1;
  return false;
}

/** Token-set similarity (0..1) tolerant to typos and order. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const used = new Set<number>();
  let matches = 0;
  for (const x of ta) {
    const idx = tb.findIndex((y, i) => !used.has(i) && tokensMatch(x, y));
    if (idx >= 0) {
      used.add(idx);
      matches += 1;
    }
  }
  return matches / (ta.length + tb.length - matches);
}

/** Last two tokens as surnames (Mexican naming: paterno + materno). */
function surnames(fullName: string): string[] {
  const t = nameTokens(fullName);
  return t.length >= 3 ? t.slice(-2) : t.slice(-1);
}

function isSwappedDayMonth(a: string, b: string): boolean {
  const ma = /^(\d{4})-(\d{2})-(\d{2})$/.exec(a);
  const mb = /^(\d{4})-(\d{2})-(\d{2})$/.exec(b);
  if (!ma || !mb) return false;
  return ma[1] === mb[1] && ma[2] === mb[3] && ma[3] === mb[2] && ma[2] !== ma[3];
}

export interface ScorablePatient {
  full_name: string;
  birth_date: string;
  birth_state?: string | null;
  phone?: string | null;
  community?: string | null;
}

/** Pure scoring function: returns total points and the reasons behind them. */
export function scoreCandidate(
  input: PatientCaptureInput,
  candidate: ScorablePatient
): { score: number; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];

  if (input.birth_date && input.birth_date === candidate.birth_date) {
    reasons.push({ code: "dob_exact", points: 40, label: "Misma fecha de nacimiento" });
  } else if (input.birth_date && isSwappedDayMonth(input.birth_date, candidate.birth_date)) {
    reasons.push({
      code: "dob_day_month_swapped",
      points: 20,
      label: "Fecha de nacimiento con día y mes invertidos (posible error de captura)",
    });
  }

  const sim = nameSimilarity(input.full_name, candidate.full_name);
  if (sim >= 0.8) {
    reasons.push({ code: "name_very_similar", points: 30, label: `Nombre muy similar (${Math.round(sim * 100)}%)` });
  } else if (sim >= 0.6) {
    reasons.push({ code: "name_similar", points: 15, label: `Nombre parecido (${Math.round(sim * 100)}%)` });
  }

  const sa = surnames(input.full_name);
  const sb = surnames(candidate.full_name);
  if (sa.length === 2 && sb.length === 2 && tokensMatch(sa[0], sb[0]) && tokensMatch(sa[1], sb[1])) {
    reasons.push({ code: "surnames_equal", points: 10, label: "Mismos apellidos" });
  }

  const pa = normalizePhone(input.phone);
  const pb = normalizePhone(candidate.phone);
  if (pa && pb && pa === pb) {
    reasons.push({ code: "phone_equal", points: 25, label: "Mismo teléfono" });
  }

  if (
    input.birth_state &&
    candidate.birth_state &&
    normalizeText(input.birth_state) === normalizeText(candidate.birth_state)
  ) {
    reasons.push({ code: "birth_state_equal", points: 5, label: "Misma entidad de nacimiento" });
  }

  if (
    input.community &&
    candidate.community &&
    normalizeText(input.community) === normalizeText(candidate.community)
  ) {
    reasons.push({ code: "community_equal", points: 5, label: "Misma comunidad" });
  }

  const score = reasons.reduce((acc, r) => acc + r.points, 0);
  return { score, reasons };
}

interface PatientRowForMatch {
  id: string;
  folio: string;
  full_name: string;
  birth_date: string;
  birth_state: string | null;
  phone: string | null;
  community: string;
}

/**
 * Finds existing patients that may be the same woman as `input`.
 * Returns candidates with score >= MATCH_POSSIBLE_THRESHOLD, best first.
 */
export function findCandidates(
  input: PatientCaptureInput,
  options: { excludePatientId?: string; limit?: number } = {}
): MatchCandidate[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, folio, full_name, birth_date, birth_state, phone, community FROM patients"
    )
    .all() as unknown as PatientRowForMatch[];

  const visitStats = db
    .prepare(
      "SELECT patient_id, COUNT(*) AS cnt, MAX(visit_date) AS last_date FROM visits GROUP BY patient_id"
    )
    .all() as unknown as Array<{ patient_id: string; cnt: number; last_date: string | null }>;
  const statsById = new Map(visitStats.map((v) => [v.patient_id, v]));

  const candidates: MatchCandidate[] = [];
  for (const row of rows) {
    if (options.excludePatientId && row.id === options.excludePatientId) continue;
    const { score, reasons } = scoreCandidate(input, row);
    if (score < MATCH_POSSIBLE_THRESHOLD) continue;
    const stats = statsById.get(row.id);
    candidates.push({
      patient: {
        id: row.id,
        folio: row.folio,
        full_name: row.full_name,
        birth_date: row.birth_date,
        birth_state: row.birth_state,
        community: row.community,
        phone_masked: maskPhone(row.phone),
        visits_count: stats?.cnt ?? 0,
        last_visit_date: stats?.last_date ?? null,
      },
      score,
      level: score >= MATCH_PROBABLE_THRESHOLD ? "probable" : "posible",
      reasons,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, options.limit ?? 5);
}

/** Validates and normalizes capture input. Returns an error message or the clean input. */
export function parseCaptureInput(body: Record<string, unknown>): PatientCaptureInput | string {
  const fullName = typeof body.full_name === "string" ? body.full_name.trim().replace(/\s+/g, " ") : "";
  const birthDate = typeof body.birth_date === "string" ? body.birth_date.trim() : "";
  const community = typeof body.community === "string" ? body.community.trim() : "";
  if (fullName.length < 5 || nameTokens(fullName).length < 2) {
    return "Escribe el nombre completo (nombre y al menos un apellido).";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate))) {
    return "La fecha de nacimiento debe tener formato AAAA-MM-DD.";
  }
  if (birthDate > new Date().toISOString().slice(0, 10)) {
    return "La fecha de nacimiento no puede ser futura.";
  }
  if (!community) return "La comunidad / municipio es obligatoria.";
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    full_name: fullName,
    birth_date: birthDate,
    birth_state: str(body.birth_state),
    phone: str(body.phone),
    email: str(body.email),
    community,
  };
}
