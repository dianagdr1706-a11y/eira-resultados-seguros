import crypto from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export function sha256Buffer(buf: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sanitizeWinAnsi(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ");
}

export interface SyntheticPdfInput {
  sampleFolio: string;
  patientName: string;
  birthDate: string;
  collectionDate: string;
  siteName: string;
  labNote: string;
  resultCategory: "Negativo para lesión intraepitelial o malignidad (Rutinario)" | "Hallazgo que requiere seguimiento médico prioritario (Acompañado)";
}

export async function generateSyntheticPapPdf(input: SyntheticPdfInput): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Header band
  page.drawRectangle({
    x: 0,
    y: 752,
    width: 595,
    height: 90,
    color: rgb(0.75, 0.07, 0.33),
  });

  page.drawText("EIRA MOVIMIENTO ROSA A.C.", {
    x: 45,
    y: 805,
    size: 18,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  page.drawText("REPORTE CITOLOGICO DE PAPANICOLAOU (DATOS SINTETICOS DE DEMOSTRACION)", {
    x: 45,
    y: 780,
    size: 10,
    font: fontRegular,
    color: rgb(1, 0.9, 0.94),
  });

  let y = 710;
  const drawField = (label: string, value: string) => {
    page.drawText(sanitizeWinAnsi(label), { x: 45, y, size: 10, font: fontBold, color: rgb(0.28, 0.33, 0.41) });
    page.drawText(sanitizeWinAnsi(value), { x: 210, y, size: 11, font: fontRegular, color: rgb(0.06, 0.09, 0.16) });
    y -= 26;
  };

  drawField("Folio de muestra:", input.sampleFolio);
  drawField("Nombre en orden de lab:", input.patientName);
  drawField("Fecha de nacimiento:", input.birthDate);
  drawField("Fecha de toma:", input.collectionDate);
  drawField("Sede / Jornada:", input.siteName);

  y -= 10;
  page.drawLine({
    start: { x: 45, y },
    end: { x: 550, y },
    thickness: 1,
    color: rgb(0.85, 0.88, 0.92),
  });
  y -= 30;

  page.drawText("INTERPRETACION CITOLOGICA (SOLO USO CLINICO / CONFIDENCIAL)", {
    x: 45,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.75, 0.07, 0.33),
  });
  y -= 24;

  page.drawRectangle({
    x: 45,
    y: y - 55,
    width: 505,
    height: 70,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.82, 0.85, 0.9),
    borderWidth: 1,
  });

  page.drawText(sanitizeWinAnsi(input.resultCategory), {
    x: 60,
    y: y - 12,
    size: 11,
    font: fontBold,
    color: rgb(0.06, 0.09, 0.16),
  });
  page.drawText(sanitizeWinAnsi(input.labNote), {
    x: 60,
    y: y - 34,
    size: 10,
    font: fontRegular,
    color: rgb(0.2, 0.25, 0.33),
  });

  y -= 110;
  page.drawText("Recomendaciones de seguimiento:", {
    x: 45,
    y,
    size: 10,
    font: fontBold,
    color: rgb(0.2, 0.25, 0.33),
  });
  y -= 20;
  page.drawText(
    "Este documento contiene datos sensibles de salud. Consulte con el equipo medico de EIRA",
    { x: 45, y, size: 10, font: fontRegular, color: rgb(0.28, 0.33, 0.41) }
  );
  y -= 16;
  page.drawText(
    "para orientacion personalizada. Documento ficticio generado para Vibeathon Nerdearla 2026.",
    { x: 45, y, size: 10, font: fontRegular, color: rgb(0.28, 0.33, 0.41) }
  );

  // Footer
  page.drawText("Laboratorio Colaborador EIRA · Control de Calidad Citologica · Uso Exclusivo Paciente", {
    x: 45,
    y: 42,
    size: 8.5,
    font: fontRegular,
    color: rgb(0.45, 0.5, 0.58),
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

export async function watermarkPdfBuffer(
  originalPdf: Buffer,
  watermarkText: string
): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.load(originalPdf);
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();
    for (const page of pages) {
      page.drawText(sanitizeWinAnsi(watermarkText), {
        x: 40,
        y: 20,
        size: 8,
        font,
        color: rgb(0.75, 0.07, 0.33),
      });
    }
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
  } catch {
    return originalPdf;
  }
}
