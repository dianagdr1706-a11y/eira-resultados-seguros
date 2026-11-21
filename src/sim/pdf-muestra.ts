import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { bethesdaLabel } from "@/lib/bethesda";

export type SampleInput = {
  nombre: string; fecha_nacimiento: string; id_eira: string; folio: string; fecha_toma: string; bethesda?: string;
};

export async function samplePdf(s: SampleInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const rose = rgb(0.75, 0.1, 0.35);
  let y = 740;
  const line = (label: string, value: string) => {
    page.drawText(label, { x: 50, y, size: 11, font: bold });
    page.drawText(value, { x: 230, y, size: 11, font });
    y -= 22;
  };
  page.drawText("LABORATORIO DE CITOLOGÍA (DEMO)", { x: 50, y, size: 16, font: bold, color: rose });
  y -= 22;
  page.drawText("Solicitud y reporte de citología cervical", { x: 50, y, size: 12, font });
  y -= 36;
  line("Nombre:", s.nombre);
  line("Fecha de nacimiento:", s.fecha_nacimiento);
  line("ID EIRA:", s.id_eira);
  line("Número citológico:", s.folio);
  line("Fecha de toma:", s.fecha_toma);
  line("Características:", "1. Adecuada");
  y -= 10;
  page.drawText("27. Diagnóstico citológico (Bethesda)", { x: 50, y, size: 11, font: bold });
  y -= 20;
  page.drawText(bethesdaLabel(s.bethesda ?? "1"), { x: 50, y, size: 11, font });
  y -= 40;
  line("Cédula citotecnólogo:", "0000000 (ficticia)");
  page.drawRectangle({ x: 40, y: 60, width: 532, height: 40, color: rgb(1, 0.92, 0.94) });
  page.drawText("DOCUMENTO FICTICIO GENERADO PARA DEMOSTRACIÓN. NO TIENE VALIDEZ CLÍNICA.", { x: 55, y: 76, size: 10, font: bold, color: rose });
  return Buffer.from(await doc.save());
}
