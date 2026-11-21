import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const FORBIDDEN_CLINICAL_TERMS = [
  "cancer",
  "cáncer",
  "carcinoma",
  "lesion",
  "lesión",
  "displasia",
  "positivo",
  "anormal",
  "maligno",
  "malignidad",
  "hsil",
  "lsil",
  "asc-us",
  "nic ",
  "colposcop",
];

function assertNoClinicalLeak(text, contextLabel) {
  const lower = String(text || "").toLowerCase();
  for (const term of FORBIDDEN_CLINICAL_TERMS) {
    assert.ok(
      !lower.includes(term),
      `Privacy leak in ${contextLabel}: forbidden clinical term "${term}" found in: ${text}`
    );
  }
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")]
        : [];

    for (const raw of setCookies) {
      if (!raw) continue;
      const [pair] = raw.split(";");
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const name = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      if (!val || raw.toLowerCase().includes("max-age=0")) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, val);
      }
    }
  }

  header() {
    if (this.cookies.size === 0) return undefined;
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  async fetch(urlPath, options = {}) {
    const headers = new Headers(options.headers || {});
    const cookieHeader = this.header();
    if (cookieHeader) {
      headers.set("cookie", cookieHeader);
    }
    const res = await fetch(`${BASE_URL}${urlPath}`, {
      ...options,
      headers,
      redirect: "manual",
    });
    this.capture(res);
    return res;
  }
}

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Expected JSON response (status ${res.status}), got: ${text.slice(0, 300)}`);
  }
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursive(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

const results = [];
async function runStep(name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - start;
    results.push({ name, ok: true, ms, detail });
    console.log(`PASS [${ms}ms] ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ name, ok: false, ms, error: err });
    console.error(`FAIL [${ms}ms] ${name}: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function main() {
  console.log(`Running EIRA Resultados Seguros E2E QA suite against ${BASE_URL}`);
  console.log(`Project root: ${PROJECT_ROOT}\n`);

  const staffJar = new CookieJar();
  const patientJarDigital = new CookieJar();
  const patientJarAccompanied = new CookieJar();
  const kioskJar = new CookieJar();
  const adminJar = new CookieJar();

  let createdStudyId = "";
  let createdPdfFilename = "";

  // a. All 6 pages return HTTP 200
  await runStep("a. All 6 App Router pages return HTTP 200", async () => {
    const routes = ["/", "/eira", "/medico", "/paciente", "/kiosco", "/alertas-loop"];
    for (const route of routes) {
      const res = await fetch(`${BASE_URL}${route}`);
      assert.equal(res.status, 200, `Expected 200 for ${route}, got ${res.status}`);
      const html = await res.text();
      assert.ok(html.includes("EIRA"), `Expected page ${route} HTML to contain EIRA`);
    }
    return routes.join(", ");
  });

  // a2. Staff-only APIs reject anonymous callers (no PII / no loop control without session)
  await runStep("a2. Staff-only APIs return 401 without session; patients list is role-restricted", async () => {
    const anonGets = ["/api/patients", "/api/studies", "/api/studies/std-104", "/api/audit", "/api/notifications", "/api/loop", "/api/export?format=json", "/api/kiosk/sync?kiosk_id=KIOSK-SIERRA-01"];
    for (const p of anonGets) {
      const res = await fetch(`${BASE_URL}${p}`);
      assert.equal(res.status, 401, `Expected 401 for anonymous GET ${p}, got ${res.status}`);
    }
    for (const p of ["/api/loop/advance", "/api/loop/ack", "/api/kiosk/verify-qr"]) {
      const res = await fetch(`${BASE_URL}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ study_id: "std-104", pseudonym_code: "EIRA-ALR-4104" }) });
      assert.equal(res.status, 401, `Expected 401 for anonymous POST ${p}, got ${res.status}`);
    }
    const adminLogin = await adminJar.fetch("/api/auth/staff-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "eira-1" }) });
    assert.equal(adminLogin.status, 200);
    const promJar = new CookieJar();
    await promJar.fetch("/api/auth/staff-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: "prom-1" }) });
    const promPatients = await promJar.fetch("/api/patients");
    assert.equal(promPatients.status, 403, `Expected 403 for promotora on /api/patients, got ${promPatients.status}`);
    const adminPatients = await adminJar.fetch("/api/patients");
    assert.equal(adminPatients.status, 200);
    return `${anonGets.length} GET + 3 POST -> 401; promotora /api/patients -> 403`;
  });

  // b. Unauthenticated GET /api/studies/std-103/pdf returns 401
  await runStep("b. Unauthenticated PDF access returns HTTP 401", async () => {
    const res = await fetch(`${BASE_URL}/api/studies/std-103/pdf`);
    assert.equal(res.status, 401, `Expected 401 for unauthenticated PDF, got ${res.status}`);
    const body = await readJson(res);
    assert.ok(body.error, "Expected error message in 401 response");

    const invalidTokenRes = await fetch(`${BASE_URL}/api/studies/std-103/pdf?token=fake-token-123`);
    assert.equal(invalidTokenRes.status, 401, `Expected 401 for invalid token, got ${invalidTokenRes.status}`);
    return "HTTP 401 confirmed (no cookies & invalid token)";
  });

  // c. Staff login (lab-1) + POST /api/studies (synthetic PDF) -> 201, SHA-256, private_storage only
  await runStep("c. Staff login (lab-1) + synthetic PDF upload -> private_storage + SHA-256", async () => {
    const loginRes = await staffJar.fetch("/api/auth/staff-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "lab-1" }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await readJson(loginRes);
    assert.equal(loginData.staff?.id, "lab-1");
    assert.equal(loginData.staff?.role, "laboratorio");

    // Reject non-PDF multipart upload (magic bytes validation)
    const badForm = new FormData();
    badForm.append("file", new Blob(["not a pdf"], { type: "application/pdf" }), "fake.pdf");
    const badUploadRes = await staffJar.fetch("/api/studies", {
      method: "POST",
      body: badForm,
    });
    assert.equal(badUploadRes.status, 400, `Expected 400 for invalid PDF magic bytes, got ${badUploadRes.status}`);

    const createRes = await staffJar.fetch("/api/studies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generate_synthetic: true,
        patient_name: "Maria Guadalupe Hernandez Perez",
        birth_date: "1988-05-14",
        collection_date: "2026-11-20",
        site_name: "Jornada Municipal Teotihuacan",
        community: "San Juan Teotihuacán",
        priority: "rutinario",
        lab_note: "Citologia cervical satisfactoria dentro de limites normales (prueba E2E).",
      }),
    });
    assert.equal(createRes.status, 201, `Expected 201 on POST /api/studies, got ${createRes.status}`);
    const createData = await readJson(createRes);
    const study = createData.study;
    assert.ok(study?.id, "Expected created study.id");
    assert.ok(study?.pdf_sha256 && /^[a-f0-9]{64}$/.test(study.pdf_sha256), "Expected valid 64-char pdf_sha256");
    assert.equal(study.status, "cargado");
    assert.ok(study.pdf_filename, "Expected pdf_filename");

    createdStudyId = study.id;
    createdPdfFilename = study.pdf_filename;

    const privatePath = path.join(PROJECT_ROOT, "private_storage", "pdfs", createdPdfFilename);
    assert.ok(fs.existsSync(privatePath), `Expected PDF at ${privatePath}`);

    const fileBytes = fs.readFileSync(privatePath);
    assert.equal(fileBytes.subarray(0, 5).toString("ascii"), "%PDF-", "Stored file must start with %PDF-");
    const actualSha = crypto.createHash("sha256").update(fileBytes).digest("hex");
    assert.equal(actualSha, study.pdf_sha256, "Stored PDF SHA-256 must match database metadata");

    const publicFiles = listFilesRecursive(path.join(PROJECT_ROOT, "public"));
    const publicPdfs = publicFiles.filter((f) => f.toLowerCase().endsWith(".pdf"));
    assert.equal(publicPdfs.length, 0, `Found unexpected PDFs in public/: ${publicPdfs.join(", ")}`);

    return `study=${createdStudyId}, sha256=${actualSha.slice(0, 12)}...`;
  });

  // d. Anti-homonym guard
  await runStep("d. Anti-homonym guard rejects incomplete checklist (400) and accepts 3-true checklist (200)", async () => {
    const badRes = await staffJar.fetch(`/api/studies/${createdStudyId}/associate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: "pat-1",
        checklist: {
          name_matches: true,
          dob_or_folio_matches: false,
          pdf_legible_complete: true,
        },
      }),
    });
    assert.equal(badRes.status, 400, `Expected 400 for incomplete checklist, got ${badRes.status}`);

    const okRes = await staffJar.fetch(`/api/studies/${createdStudyId}/associate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: "pat-1",
        checklist: {
          name_matches: true,
          dob_or_folio_matches: true,
          pdf_legible_complete: true,
          notes: "Verificado homónimo Pérez vs Peralta con fecha 1988-05-14",
        },
      }),
    });
    assert.equal(okRes.status, 200, `Expected 200 for complete checklist, got ${okRes.status}`);
    const okData = await readJson(okRes);
    assert.equal(okData.study?.status, "asociado");
    assert.equal(okData.study?.patient_id, "pat-1");
    return `${createdStudyId} -> asociado (pat-1)`;
  });

  // e. Dual-gate RBAC & Neutral notification verification
  await runStep("e. Dual-gate RBAC & neutral notifications (no diagnosis leak)", async () => {
    // 1. Login as eira_admin (eira-1)
    const adminLogin = await staffJar.fetch("/api/auth/staff-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "eira-1" }),
    });
    assert.equal(adminLogin.status, 200);

    // eira_admin attempting clinical review -> 403
    const adminClinicalAttempt = await staffJar.fetch(`/api/studies/${createdStudyId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "clinica", decision: "aprobado", delivery_mode: "digital" }),
    });
    assert.ok(
      adminClinicalAttempt.status === 401 || adminClinicalAttempt.status === 403,
      `Expected 401/403 when eira_admin attempts clinical review, got ${adminClinicalAttempt.status}`
    );

    // 2. Login as medico (med-1) BEFORE admin review -> 400
    const medLoginBefore = await staffJar.fetch("/api/auth/staff-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "med-1" }),
    });
    assert.equal(medLoginBefore.status, 200);

    const medEarlyAttempt = await staffJar.fetch(`/api/studies/${createdStudyId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "clinica",
        decision: "aprobado",
        delivery_mode: "digital",
        comments: "Nota interna confidencial: sin lesión ni displasia",
      }),
    });
    assert.equal(
      medEarlyAttempt.status,
      400,
      `Expected 400 when medico tries clinical review before admin review, got ${medEarlyAttempt.status}`
    );

    // 3. Switch back to eira_admin -> approve Gate 1 -> status === "pendiente_clinica"
    await staffJar.fetch("/api/auth/staff-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "eira-1" }),
    });
    const adminApproveRes = await staffJar.fetch(`/api/studies/${createdStudyId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "administrativa",
        decision: "aprobado",
        comments: "PDF legible y cotejo verificado.",
      }),
    });
    assert.equal(adminApproveRes.status, 200);
    const adminApproveData = await readJson(adminApproveRes);
    assert.equal(adminApproveData.study?.status, "pendiente_clinica");

    // 4. Switch to medico -> approve Gate 2 (digital) -> status === "notificado", loop_status === "activo"
    await staffJar.fetch("/api/auth/staff-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "med-1" }),
    });
    const secretClinicalNote = "NOTA_INTERNA_SOLO_MEDICO: Citologia rutinaria sin lesion ni displasia.";
    const medApproveRes = await staffJar.fetch(`/api/studies/${createdStudyId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        stage: "clinica",
        decision: "aprobado",
        priority: "rutinario",
        delivery_mode: "digital",
        comments: secretClinicalNote,
      }),
    });
    assert.equal(medApproveRes.status, 200);
    const medApproveData = await readJson(medApproveRes);
    assert.equal(medApproveData.study?.status, "notificado");
    assert.equal(medApproveData.study?.loop_status, "activo");

    // 5. Verify notifications contain ZERO diagnosis words and ZERO clinical_note_internal
    const notifsRes = await adminJar.fetch(`/api/notifications?study_id=${encodeURIComponent(createdStudyId)}`);
    assert.equal(notifsRes.status, 200);
    const notifsData = await readJson(notifsRes);
    assert.ok(Array.isArray(notifsData.notifications) && notifsData.notifications.length >= 1);
    for (const n of notifsData.notifications) {
      assertNoClinicalLeak(n.neutral_message, `notification ${n.id}`);
      assert.ok(
        !n.neutral_message.includes("NOTA_INTERNA_SOLO_MEDICO"),
        "Notification leaked clinical_note_internal"
      );
    }

    // 6. Verify non-medico staff (eira_admin) GET /api/studies and /api/studies/[id] redact clinical_note_internal & pin_code
    const publicStudiesRes = await adminJar.fetch(`/api/studies`);
    assert.equal(publicStudiesRes.status, 200);
    const publicStudiesRaw = await publicStudiesRes.text();
    assert.ok(
      !publicStudiesRaw.includes("NOTA_INTERNA_SOLO_MEDICO"),
      "Unauthenticated GET /api/studies leaked clinical_note_internal!"
    );
    assert.ok(!publicStudiesRaw.includes("pin_code"), "GET /api/studies exposed pin_code!");

    const publicDetailRes = await adminJar.fetch(`/api/studies/${createdStudyId}`);
    assert.equal(publicDetailRes.status, 200);
    const publicDetailRaw = await publicDetailRes.text();
    assert.ok(
      !publicDetailRaw.includes("NOTA_INTERNA_SOLO_MEDICO"),
      "Unauthenticated GET /api/studies/[id] leaked clinical_note_internal or review comment!"
    );

    // Verify medico CAN view clinical_note_internal on GET /api/studies/[id]
    const medDetailRes = await staffJar.fetch(`/api/studies/${createdStudyId}`);
    assert.equal(medDetailRes.status, 200);
    const medDetailData = await readJson(medDetailRes);
    assert.equal(medDetailData.study?.clinical_note_internal, secretClinicalNote);

    return `Gate1->pendiente_clinica, Gate2->notificado + loop=activo, 0 clinical leaks`;
  });

  // f. Patient OTP flow (PAC-2026-006, 1995-07-08) -> ephemeral token download 200 + std-103 consultado + cerrado_ack
  await runStep("f. Patient OTP auth (PAC-2026-006) + ephemeral PDF download (200) -> ACK closure", async () => {
    const reqOtpRes = await patientJarDigital.fetch("/api/patient-portal/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folio: "PAC-2026-006", birth_date: "1995-07-08" }),
    });
    assert.equal(reqOtpRes.status, 200, `Expected 200 from request-otp, got ${reqOtpRes.status}`);
    const otpData = await readJson(reqOtpRes);
    const otp = otpData.simulated_otp_for_demo;
    assert.ok(otp && /^\d{6}$/.test(otp), `Expected 6-digit simulated_otp_for_demo, got ${otp}`);

    // Confirm raw OTP is NOT exposed in public /api/notifications
    const notifCheckRes = await adminJar.fetch(`/api/notifications?study_id=std-103`);
    const notifCheckData = await readJson(notifCheckRes);
    for (const n of notifCheckData.notifications || []) {
      assert.ok(!String(n.neutral_message).includes(otp), "Public /api/notifications leaked live OTP!");
      assertNoClinicalLeak(n.neutral_message, `notification ${n.id}`);
    }

    const verifyRes = await patientJarDigital.fetch("/api/patient-portal/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folio: "PAC-2026-006", birth_date: "1995-07-08", code: otp }),
    });
    assert.equal(verifyRes.status, 200, `Expected 200 from verify-otp, got ${verifyRes.status}`);
    const verifyData = await readJson(verifyRes);
    assert.equal(verifyData.ok, true);

    const studiesRes = await patientJarDigital.fetch("/api/patient-portal/studies");
    assert.equal(studiesRes.status, 200, `Expected 200 from patient-portal/studies, got ${studiesRes.status}`);
    const studiesData = await readJson(studiesRes);
    const std103 = (studiesData.studies || []).find((s) => s.id === "std-103");
    assert.ok(std103, "Expected std-103 in PAC-2026-006 studies");
    assert.ok(std103.ephemeral_download_token, "Expected ephemeral_download_token for std-103");
    assert.equal(std103.clinical_note_internal, undefined, "Patient portal must strip clinical_note_internal");

    const pdfRes = await patientJarDigital.fetch(
      `/api/studies/std-103/pdf?token=${encodeURIComponent(std103.ephemeral_download_token)}`
    );
    assert.equal(pdfRes.status, 200, `Expected 200 for ephemeral PDF download, got ${pdfRes.status}`);
    assert.ok(
      (pdfRes.headers.get("content-type") || "").includes("application/pdf"),
      "Expected Content-Type application/pdf"
    );
    const cacheCtrl = (pdfRes.headers.get("cache-control") || "").toLowerCase();
    assert.ok(cacheCtrl.includes("no-store"), `Expected Cache-Control to include no-store, got: ${cacheCtrl}`);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    assert.equal(pdfBuf.subarray(0, 5).toString("ascii"), "%PDF-", "Downloaded PDF must start with %PDF-");

    const updatedRes = await adminJar.fetch(`/api/studies/std-103`);
    assert.equal(updatedRes.status, 200);
    const updatedData = await readJson(updatedRes);
    assert.equal(updatedData.study?.status, "consultado");
    assert.equal(updatedData.study?.loop_status, "cerrado_ack");

    return `OTP verified, PDF=${pdfBuf.length}B, std-103 -> consultado + cerrado_ack`;
  });

  // g. Priority accompanied patient (PAC-2026-005, 1984-01-19) with 4-digit PIN (3047) -> PDF blocked 403
  await runStep("g. Accompanied priority patient (PAC-2026-005) PIN fallback (3047) -> direct PDF 403", async () => {
    const verifyRes = await patientJarAccompanied.fetch("/api/patient-portal/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folio: "PAC-2026-005", birth_date: "1984-01-19", code: "3047" }),
    });
    assert.equal(verifyRes.status, 200, `Expected 200 for PIN 3047 login, got ${verifyRes.status}`);

    const portalRes = await patientJarAccompanied.fetch("/api/patient-portal/studies");
    assert.equal(portalRes.status, 200);
    const portalData = await readJson(portalRes);
    const std104 = (portalData.studies || []).find((s) => s.id === "std-104");
    assert.ok(std104, "Expected std-104 for PAC-2026-005");
    assert.equal(std104.delivery_mode, "acompanado");
    assert.equal(std104.ephemeral_download_token, null, "Accompanied study must not issue PDF token");

    const blockedPdfRes = await patientJarAccompanied.fetch("/api/studies/std-104/pdf");
    assert.equal(
      blockedPdfRes.status,
      403,
      `Expected 403 when accompanied patient tries direct PDF download of std-104, got ${blockedPdfRes.status}`
    );

    return "PIN 3047 verified, std-104 direct PDF blocked with HTTP 403";
  });

  // h. Closed-Loop insistent escalation on std-104 (+24h)
  await runStep("h. Closed-Loop advance (+24h) on std-104 emits pseudonymous event with 0 clinical leaks", async () => {
    const advRes = await adminJar.fetch(`/api/loop/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study_id: "std-104", hours: 24 }),
    });
    assert.equal(advRes.status, 200, `Expected 200 from /api/loop/advance, got ${advRes.status}`);
    const advData = await readJson(advRes);
    assert.equal(advData.updated_count, 1, `Expected updated_count=1, got ${advData.updated_count}`);
    assert.ok(Array.isArray(advData.new_events) && advData.new_events.length === 1);

    const ev = advData.new_events[0];
    assert.equal(ev.pseudonym_code, "EIRA-ALR-4104");
    assert.ok(
      ev.channel === "lora_modulo_comunitario" || ev.channel === "escalamiento_promotora",
      `Expected LoRa or Promotora escalation channel, got ${ev.channel}`
    );
    assertNoClinicalLeak(ev.payload_preview, "loop advance event");

    const notifsRes = await adminJar.fetch(`/api/notifications?study_id=std-104`);
    const notifsData = await readJson(notifsRes);
    for (const n of notifsData.notifications || []) {
      assertNoClinicalLeak(n.neutral_message, `std-104 notification ${n.id}`);
    }

    const loopRes = await adminJar.fetch(`/api/loop`);
    assert.equal(loopRes.status, 200);
    const loopRaw = await loopRes.text();
    assert.ok(!loopRaw.includes("NOTA_INTERNA_SOLO_MEDICO"), "GET /api/loop leaked clinical_note_internal");
    assert.ok(!loopRaw.includes("pin_code"), "GET /api/loop leaked pin_code");
    const loopParsed = JSON.parse(loopRaw);
    for (const st of loopParsed.studies || []) {
      assert.equal(st.clinical_note_internal, null, "GET /api/loop must redact clinical_note_internal");
    }

    return `event=${ev.channel} level=${ev.level} (${ev.pseudonym_code})`;
  });

  // i. Raspberry Pi Kiosk Sync + verify-qr + prom-1 assisted-delivery + loop stops
  await runStep("i. Kiosk AES-256-GCM sync + verify-qr (rojo) + prom-1 offline ACK stops loop", async () => {
    const syncRes = await adminJar.fetch(`/api/kiosk/sync?kiosk_id=KIOSK-SIERRA-01`);
    assert.equal(syncRes.status, 200, `Expected 200 from kiosk/sync, got ${syncRes.status}`);
    const syncData = await readJson(syncRes);
    assert.equal(syncData.encrypted_bundle?.algorithm, "AES-256-GCM");
    assert.ok(syncData.encrypted_bundle?.iv_hex, "Expected iv_hex");
    assert.ok(syncData.encrypted_bundle?.auth_tag_hex, "Expected auth_tag_hex");
    assert.ok(syncData.encrypted_bundle?.ciphertext_b64, "Expected ciphertext_b64");
    assert.ok(syncData.encrypted_bundle?.sha256, "Expected bundle sha256");
    assert.ok(Array.isArray(syncData.local_cache_records) && syncData.local_cache_records.length >= 1);

    const syncJsonText = JSON.stringify(syncData.local_cache_records);
    assert.ok(!syncJsonText.includes("pin_code"), "Kiosk cache must not contain pin_code");
    assert.ok(!syncJsonText.includes("clinical_note_internal"), "Kiosk cache must not contain clinical_note_internal");

    // Verify AES-256-GCM ciphertext integrity & decryptability
    const bundle = syncData.encrypted_bundle;
    const ciphertextBuf = Buffer.from(bundle.ciphertext_b64, "base64");
    const actualBundleSha = crypto.createHash("sha256").update(ciphertextBuf).digest("hex");
    assert.equal(actualBundleSha, bundle.sha256, "AES-256-GCM bundle SHA-256 mismatch");
    const kioskKey = crypto
      .createHash("sha256")
      .update(process.env.EIRA_KIOSK_KEY || "eira-kiosk-edge-sync-key-2026", "utf8")
      .digest();
    const decipher = crypto.createDecipheriv("aes-256-gcm", kioskKey, Buffer.from(bundle.iv_hex, "hex"));
    decipher.setAuthTag(Buffer.from(bundle.auth_tag_hex, "hex"));
    const decryptedBundle = JSON.parse(
      Buffer.concat([decipher.update(ciphertextBuf), decipher.final()]).toString("utf8")
    );
    assert.equal(decryptedBundle.kiosk_id, "KIOSK-SIERRA-01");
    assert.equal(decryptedBundle.count, syncData.local_cache_records.length);

    const verifyQrRes = await adminJar.fetch(`/api/kiosk/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pseudonym_code: "EIRA-ALR-4104" }),
    });
    assert.equal(verifyQrRes.status, 200);
    const verifyQrData = await readJson(verifyQrRes);
    assert.equal(verifyQrData.found, true);
    assert.equal(verifyQrData.traffic_light?.color, "rojo");
    assertNoClinicalLeak(verifyQrData.traffic_light?.label, "kiosk traffic_light.label");

    // Staff login prom-1
    const promLoginRes = await kioskJar.fetch("/api/auth/staff-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "prom-1" }),
    });
    assert.equal(promLoginRes.status, 200);

    // Confirm promotora_kiosco is blocked by RBAC from clinical PDF download
    const promPdfDenied = await kioskJar.fetch("/api/studies/std-104/pdf");
    assert.equal(
      promPdfDenied.status,
      403,
      `Expected 403 when promotora_kiosco tries clinical PDF download, got ${promPdfDenied.status}`
    );

    const deliveryRes = await kioskJar.fetch("/api/kiosk/assisted-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        study_id: "std-104",
        kiosk_id: "KIOSK-SIERRA-01",
        modality: "kiosco_presencial",
        notes: "Entrega presencial en Kiosco Sierra Norte tras sincronizar modo sin señal.",
        synced_from_offline: true,
      }),
    });
    assert.equal(deliveryRes.status, 200, `Expected 200 from assisted-delivery, got ${deliveryRes.status}`);
    const deliveryData = await readJson(deliveryRes);
    assert.equal(deliveryData.ok, true);
    assert.equal(deliveryData.study?.status, "entregado_asistido");
    assert.equal(deliveryData.study?.loop_status, "cerrado_ack");
    assert.equal(deliveryData.delivery?.synced_from_offline, 1);

    // Subsequent advance on std-104 MUST emit 0 events
    const postAckAdvance = await adminJar.fetch(`/api/loop/advance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ study_id: "std-104", hours: 24 }),
    });
    assert.equal(postAckAdvance.status, 200);
    const postAckData = await readJson(postAckAdvance);
    assert.equal(postAckData.updated_count, 0, "Expected 0 studies updated after ACK");
    assert.equal(postAckData.new_events?.length, 0, "Expected 0 new events after ACK");

    return `AES-256-GCM synced (${syncData.count} recs), EIRA-ALR-4104=rojo, ACK closed, post-ACK advance=0`;
  });

  // j. Open-format export (CSV & JSON) -> 200, zero pin_code or clinical_note_internal
  await runStep("j. Open-format CSV & JSON export -> 200 & zero pin_code/clinical_note_internal", async () => {
    const csvRes = await adminJar.fetch(`/api/export?format=csv`);
    assert.equal(csvRes.status, 200);
    assert.ok((csvRes.headers.get("content-type") || "").includes("text/csv"));
    const csvText = await csvRes.text();
    assert.ok(csvText.startsWith("sample_folio,pseudonym_code,"), "Unexpected CSV header");
    assert.ok(!csvText.includes("pin_code"), "CSV export must not contain pin_code");
    assert.ok(!csvText.includes("clinical_note_internal"), "CSV export must not contain clinical_note_internal");
    assert.ok(!csvText.includes("NOTA_INTERNA_SOLO_MEDICO"), "CSV export leaked clinical note text");
    assert.ok(!csvText.includes("3047"), "CSV export leaked patient PIN code");

    const jsonRes = await adminJar.fetch(`/api/export?format=json`);
    assert.equal(jsonRes.status, 200);
    assert.ok((jsonRes.headers.get("content-type") || "").includes("application/json"));
    const jsonText = await jsonRes.text();
    assert.ok(!jsonText.includes("pin_code"), "JSON export must not contain pin_code");
    assert.ok(!jsonText.includes("clinical_note_internal"), "JSON export must not contain clinical_note_internal");
    assert.ok(!jsonText.includes("NOTA_INTERNA_SOLO_MEDICO"), "JSON export leaked clinical note text");
    assert.ok(!jsonText.includes("3047"), "JSON export leaked patient PIN code");

    const parsed = JSON.parse(jsonText);
    assert.equal(parsed.sanitized, true);
    assert.ok(Array.isArray(parsed.studies) && parsed.studies.length >= 6);

    return `CSV (${csvText.split("\n").length} lines) & JSON (${parsed.count} studies) sanitized`;
  });

  // ---------------------------------------------------------------------------
  // Reto 1 · Expediente Digital Único (integrado con Reto 4)
  // ---------------------------------------------------------------------------
  const promJar = new CookieJar();
  const runTag = crypto.randomBytes(3).toString("hex").replace(/\d/g, (d) => "abcdefghij"[Number(d)]);
  const postJson = (jar, url, body, method = "POST") =>
    jar.fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  await runStep("k. Reto 1: duplicate registration -> 409 with probable candidate; justified new record is created", async () => {
    const anon = await fetch(`${BASE_URL}/api/patients/match`, { method: "POST" });
    assert.equal(anon.status, 401, "match without session must be 401");
    const login = await postJson(promJar, "/api/auth/staff-login", { userId: "prom-1" });
    assert.equal(login.status, 200);

    const capture = {
      full_name: "Ma. Gpe. Hernandez Perez",
      birth_date: "1988-05-14",
      birth_state: "Estado de México",
      community: "San Juan Teotihuacán",
    };
    const matchRes = await postJson(promJar, "/api/patients/match", capture);
    assert.equal(matchRes.status, 200);
    const { candidates } = await readJson(matchRes);
    assert.ok(candidates.length >= 1, "expected at least one candidate");
    assert.equal(candidates[0].patient.folio, "PAC-2026-001");
    assert.equal(candidates[0].level, "probable");
    assert.ok(candidates[0].score >= 70 && candidates[0].reasons.length > 0);
    assert.ok(
      !candidates.some((c) => c.patient.folio === "PAC-2026-002" && c.level === "probable"),
      "near-homonym Peralta must not be a probable match"
    );

    const dupRes = await postJson(promJar, "/api/patients", capture);
    assert.equal(dupRes.status, 409, "duplicate without justification must be 409");
    assert.equal((await readJson(dupRes)).code, "POSSIBLE_DUPLICATE");

    const createRes = await postJson(promJar, "/api/patients", {
      ...capture,
      confirm_new_reason: "Hermana gemela, verificado con INE en jornada",
      first_visit: { site_name: "Jornada E2E", services: ["papanicolaou"] },
    });
    assert.equal(createRes.status, 201);
    const created = await readJson(createRes);
    assert.match(created.patient.folio, /^PAC-\d{4}-\d{3}$/);
    assert.match(created.pin_code, /^\d{4}$/);
    assert.equal(created.visit?.services?.[0], "papanicolaou");
    return `top=${candidates[0].patient.folio} score=${candidates[0].score}; 409 then 201 ${created.patient.folio}`;
  });

  await runStep("l. Reto 1: idempotent second visit + history (clinical note hidden) + version conflict", async () => {
    const visitBody = {
      site_name: "Jornada E2E",
      community: "San Juan Teotihuacán",
      services: ["exploracion_mama"],
      client_uuid: crypto.randomUUID(),
      from_match: true,
    };
    const first = await postJson(promJar, "/api/patients/pat-1/visits", visitBody);
    assert.equal(first.status, 201);
    const again = await postJson(promJar, "/api/patients/pat-1/visits", visitBody);
    assert.equal(again.status, 200);
    assert.equal((await readJson(again)).duplicate, true, "same client_uuid must not duplicate");

    const histRes = await promJar.fetch("/api/patients/pat-1/history");
    assert.equal(histRes.status, 200);
    const hist = await readJson(histRes);
    assert.ok(hist.visits.length >= 4, `expected >=4 visits, got ${hist.visits.length}`);
    assert.ok(Array.isArray(hist.studies));
    for (const s of hist.studies) assert.equal(s.clinical_note_internal, null, "promotora must not see clinical notes");

    const stale = await postJson(promJar, "/api/patients/pat-1", { base_version: 999, changes: { phone: "+525500000000" } }, "PATCH");
    assert.equal(stale.status, 409);
    assert.equal((await readJson(stale)).code, "VERSION_CONFLICT");
    return `visits=${hist.visits.length}, idempotent, stale PATCH -> 409`;
  });

  await runStep("m. Reto 1: offline sync is idempotent and never auto-merges", async () => {
    const now = new Date().toISOString();
    const u1 = crypto.randomUUID();
    const u2 = crypto.randomUUID();
    const newName = `Ximena Offline ${runTag}`;
    const batch = {
      device_id: "e2e-device",
      items: [
        { kind: "new_patient", client_uuid: u1, captured_at: now,
          data: { full_name: "María Guadalupe Hernández Pérez", birth_date: "1988-05-14", community: "San Juan Teotihuacán" },
          first_visit: { site_name: "Brigada offline", services: ["papanicolaou"] } },
        { kind: "new_patient", client_uuid: u2, captured_at: now,
          data: { full_name: newName, birth_date: "2000-01-15", community: "Otumba" },
          first_visit: { site_name: "Brigada offline", services: ["papanicolaou"] } },
      ],
    };
    const r1 = await postJson(promJar, "/api/sync/registrations", batch);
    assert.equal(r1.status, 200);
    const s1 = (await readJson(r1)).results;
    const byId1 = Object.fromEntries(s1.map((r) => [r.client_uuid, r]));
    assert.equal(byId1[u1].status, "conflicto");
    assert.equal(byId1[u1].conflict?.type, "POSSIBLE_DUPLICATE");
    assert.equal(byId1[u2].status, "creado");

    const r2 = await postJson(promJar, "/api/sync/registrations", batch);
    const byId2 = Object.fromEntries((await readJson(r2)).results.map((r) => [r.client_uuid, r]));
    assert.equal(byId2[u2].status, "ya_sincronizado", "re-sent batch must not duplicate");
    assert.equal(byId2[u1].status, "conflicto", "conflict must persist until a human resolves it");

    const search = await adminJar.fetch(`/api/patients?q=${encodeURIComponent(newName)}`);
    const found = (await readJson(search)).patients;
    assert.equal(found.length, 1, `expected exactly 1 '${newName}', got ${found.length}`);
    return `conflict kept, new record created once (${found[0].folio})`;
  });

  await runStep("n. Reto 1 -> 4 bridge: suggested patient by sample folio + registry stats", async () => {
    const sug = await adminJar.fetch("/api/studies/std-101/suggested-patient");
    assert.equal(sug.status, 200);
    const sugData = await readJson(sug);
    assert.equal(sugData.suggestion?.patient?.folio, "PAC-2026-001");
    const stats = await adminJar.fetch("/api/registry/stats");
    assert.equal(stats.status, 200);
    const st = await readJson(stats);
    assert.ok(st.unique_patients >= 6 && st.total_visits >= 8, JSON.stringify(st));
    assert.ok(st.duplicates_prevented >= 1, "DUPLICADO_EVITADO should be audited");
    return `std-101 -> PAC-2026-001; stats ${JSON.stringify(st)}`;
  });

  console.log(`\nALL ${results.length}/${results.length} E2E VERIFICATION STEPS PASSED!`);
}

main().catch((err) => {
  console.error("\nE2E VERIFICATION FAILED:", err);
  process.exit(1);
});
