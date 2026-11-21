export const BETHESDA = [
  { id: "1", label: "Negativa para lesión intraepitelial o malignidad", nivel: "negativo" },
  { id: "2", label: "ASC-US: células escamosas atípicas de significado indeterminado", nivel: "anormal" },
  { id: "3", label: "ASC-H: no se puede descartar lesión de alto grado", nivel: "alto" },
  { id: "4", label: "LSIL: lesión escamosa intraepitelial de bajo grado (VPH, NIC 1)", nivel: "anormal" },
  { id: "5", label: "HSIL: lesión escamosa intraepitelial de alto grado (NIC 2, NIC 3)", nivel: "alto" },
  { id: "6", label: "Carcinoma epidermoide", nivel: "alto" },
  { id: "7", label: "AGC: células glandulares endocervicales atípicas", nivel: "alto" },
  { id: "8", label: "AGC: células glandulares endometriales atípicas", nivel: "alto" },
  { id: "9", label: "AGC: células glandulares atípicas", nivel: "alto" },
  { id: "10", label: "Adenocarcinoma endocervical in situ", nivel: "alto" },
  { id: "11", label: "Adenocarcinoma (endocervical, endometrial o extrauterino)", nivel: "alto" },
  { id: "INAD", label: "Muestra inadecuada: se debe repetir el estudio", nivel: "anormal" },
] as const;

export type Sugerencia = {
  modo: "digital" | "acompanado";
  prioridad: "rutinario" | "prioritario";
  color: "verde" | "amarillo" | "rojo";
  motivo: string;
};

export function sugerir(bethesdaId: string): Sugerencia {
  const b = BETHESDA.find((x) => x.id === bethesdaId);
  if (!b) return { modo: "acompanado", prioridad: "rutinario", color: "amarillo", motivo: "Sin categoría" };
  if (b.nivel === "negativo")
    return { modo: "digital", prioridad: "rutinario", color: "verde", motivo: "Resultado negativo: apto para entrega digital directa." };
  if (b.nivel === "anormal")
    return {
      modo: "acompanado",
      prioridad: "rutinario",
      color: "amarillo",
      motivo: "Requiere orientación o repetir estudio: se sugiere entrega acompañada (seguimiento en 7 días).",
    };
  return {
    modo: "acompanado",
    prioridad: "prioritario",
    color: "rojo",
    motivo: "Hallazgo de alto grado: entrega acompañada prioritaria (contacto en 48 h).",
  };
}

export function bethesdaLabel(id: string | null) {
  return BETHESDA.find((x) => x.id === id)?.label ?? "—";
}
