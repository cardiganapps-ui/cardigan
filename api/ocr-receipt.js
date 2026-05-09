/* POST /api/ocr-receipt
   Take a just-uploaded receipt document, send the image to Claude
   Haiku 4.5 with vision, and return structured fields the client can
   pre-fill into ExpenseSheet. The user always reviews and can override
   anything before saving — this is a friction-reducer, not an
   authoritative source.

   Auth: JWT-gated, Pro-only (mirrors cardi-ask).
   Rate limit: 60/hour per user (uploads are bursty when a therapist
   blitzes through a stack of receipts at month-end).

   Request:  { documentId: "<uuid>" }
   Response: {
     amount: integer | null,         // pesos, integer
     date: "YYYY-MM-DD" | null,
     vendor: string | null,          // free-form vendor / merchant name
     description: string | null,     // short memo for the form
     category: <EXPENSE_CATEGORIES> | null,
     cfdiUuid: string | null,
     confidence: "high" | "medium" | "low"
   }

   Cost note: ~$0.001 per receipt at Haiku 4.5 prices (Apr 2026).
   Receipts are usually small (~200KB jpeg ≈ 1500 input tokens incl
   image), output is ~80 tokens of JSON. */

import Anthropic from "@anthropic-ai/sdk";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getServiceClient, getAuthUser } from "./_admin.js";
import { getR2, BUCKET } from "./_r2.js";
import { isProUser } from "./_subscription.js";
import { rateLimit } from "./_ratelimit.js";
import { getFlag } from "./_flags.js";
import { withSentry } from "./_sentry.js";

const ALLOWED_CATEGORIES = [
  "consultorio", "servicios", "software", "insumos", "formacion",
  "honorarios", "transporte", "marketing", "comisiones", "impuestos", "otro",
];

const SYSTEM_PROMPT = `Eres un asistente especializado en extraer datos de recibos y facturas mexicanas para registrarlos como gastos.

Recibirás una foto o PDF de un recibo. Devuelve EXCLUSIVAMENTE un objeto JSON válido (nada antes, nada después, ningún markdown) con esta forma:

{
  "amount": <entero en pesos MXN, sin centavos, sin signo $, o null>,
  "date": "YYYY-MM-DD" | null,
  "vendor": "<nombre del comercio o vendedor, máx 60 caracteres>" | null,
  "description": "<frase corta describiendo el gasto, máx 50 caracteres>" | null,
  "category": "<una de: ${ALLOWED_CATEGORIES.join(", ")}>" | null,
  "cfdiUuid": "<UUID del CFDI si está visible>" | null,
  "confidence": "high" | "medium" | "low"
}

Reglas:
- "amount" es el TOTAL pagado (con IVA incluido), redondeado al peso entero. Si solo ves un subtotal sin total, usa el subtotal y baja confidence.
- "date" es la fecha de emisión / pago. Si el recibo trae fecha mexicana DD/MM/YYYY, conviértela a YYYY-MM-DD.
- "vendor" es el nombre comercial. Para facturas con razón social larga (ej. "WEWORK MEXICO S DE RL DE CV"), usa el nombre comercial común ("WeWork").
- "description" es para llenar el campo "Descripción" de la app. Conciso y útil. Si tienes vendor, evita repetirlo.
- "category" elige la más adecuada de la lista. Mapeo aproximado:
  - consultorio: renta de oficina, coworking, espacio compartido, mantenimiento del consultorio
  - servicios: luz, agua, internet, telefonía, gas
  - software: suscripciones (Zoom, Notion, Cardigan, antivirus), licencias
  - insumos: papelería, tests psicométricos, libros, material clínico, café/agua del consultorio
  - formacion: cursos, congresos, supervisión clínica, terapia personal
  - honorarios: contador, abogado, supervisor, consultoría externa
  - transporte: gasolina, Uber, estacionamiento, taxi, casetas
  - marketing: publicidad, sitio web, tarjetas, redes sociales
  - comisiones: Stripe, banco, terminal, intereses bancarios
  - impuestos: ISR, IVA, cuotas IMSS, cuotas profesionales
  - otro: cualquier otro caso
  Si dudas entre dos, elige la más específica (formacion > otro). Si no hay pista clara, usa null y baja confidence.
- "cfdiUuid" es el folio fiscal mexicano (formato 8-4-4-4-12 hex caracteres). Solo lo incluyes si el recibo es una factura formal (CFDI) y el UUID es visible.
- "confidence":
  - "high" si todos los campos críticos (amount, date, vendor) están claramente legibles.
  - "medium" si hay borrosidad, OCR ambiguo, o un solo campo crítico borroso.
  - "low" si la imagen está muy borrosa, no es un recibo, o falta más de un campo crítico.
- Si la imagen NO parece un recibo (selfie, paisaje, captura aleatoria), devuelve todos los campos en null y confidence="low".
- Cualquier campo que no puedas determinar → null. NUNCA inventes datos.
- Devuelve SOLO el JSON. Sin texto introductorio, sin explicaciones, sin markdown.`;

async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  if (await getFlag("ocr_paused")) {
    return res.status(503).json({ error: "OCR está pausado temporalmente." });
  }

  if (!(await isProUser(user))) {
    return res.status(403).json({ error: "OCR de recibos es una función Pro", action: "subscribe" });
  }

  const rl = await rateLimit({
    endpoint: "ocr-receipt",
    bucket: user.id,
    max: 60,
    windowSec: 3600,
  });
  if (!rl.ok) {
    res.setHeader("Retry-After", String(rl.retryAfter));
    return res.status(429).json({ error: "Demasiados recibos en poco tiempo. Intenta en un momento." });
  }

  const { documentId } = req.body || {};
  if (!documentId || typeof documentId !== "string") {
    return res.status(400).json({ error: "documentId requerido" });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "OCR no está configurado" });
  }

  // Look up the document, scoped to the auth'd user. We require
  // kind=receipt as a defense-in-depth check — a stray endpoint that
  // accepts arbitrary documentIds shouldn't be able to OCR a patient
  // file. The query already filters by user_id; the kind check is
  // belt-and-suspenders for the path where a future code change loses
  // the user filter.
  const svc = getServiceClient();
  const { data: doc, error } = await svc
    .from("documents")
    .select("id, file_path, file_type, kind, user_id")
    .eq("id", documentId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: "DB error" });
  if (!doc) return res.status(404).json({ error: "Documento no encontrado" });
  if (doc.kind !== "receipt") return res.status(400).json({ error: "Documento no es un recibo" });

  // Anthropic vision officially supports JPEG / PNG / GIF / WEBP, plus
  // PDF via the document source type. iOS-default HEIC/HEIF photos
  // would 4xx at Anthropic — we surface a useful Spanish hint instead
  // so the user knows why OCR didn't fire (the receipt itself still
  // attaches via the upload pipeline; OCR is a separate step).
  const HEIC_TYPES = new Set(["image/heic", "image/heif"]);
  if (HEIC_TYPES.has(doc.file_type)) {
    return res.status(415).json({
      error: "Foto en formato HEIC. Adjunta como JPG si quieres autocompletar con OCR.",
      code: "heic_unsupported",
    });
  }
  const ALLOWED_TYPES = new Set([
    "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/pdf",
  ]);
  if (!ALLOWED_TYPES.has(doc.file_type)) {
    return res.status(415).json({ error: "Tipo de archivo no soportado" });
  }

  // Presign a short-TTL R2 GET URL. Anthropic fetches it server-side
  // when we pass {type: "url"} in the image source — no bytes flow
  // through this function. 5 min is plenty for a single API call.
  const r2 = await getR2();
  const url = await getSignedUrl(r2, new GetObjectCommand({
    Bucket: BUCKET,
    Key: doc.file_path,
    ResponseContentType: doc.file_type,
  }), { expiresIn: 300 });

  // Build the user message. Image-via-URL keeps this lean: no
  // round-trip download, no base64 bloat in the request body.
  const isPdf = doc.file_type === "application/pdf";
  const content = isPdf
    ? [
        { type: "document", source: { type: "url", url } },
        { type: "text", text: "Extrae los campos del recibo y devuelve solo el JSON." },
      ]
    : [
        { type: "image", source: { type: "url", url } },
        { type: "text", text: "Extrae los campos del recibo y devuelve solo el JSON." },
      ];

  let parsed;
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      // System prompt is identical across requests → cache it. A
      // therapist OCRing a stack of receipts gets the cached input
      // rate from the second receipt onward.
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content }],
    });

    const textBlock = (message.content || []).find((b) => b.type === "text");
    const raw = textBlock?.text?.trim() || "";
    // Tolerate Claude wrapping the JSON in a code fence even though we
    // asked it not to. Strip optional leading/trailing fences.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    console.error("[ocr-receipt] Claude error:", err?.message);
    return res.status(502).json({ error: "No pude leer el recibo. Intenta de nuevo o llena los campos manualmente." });
  }

  // Validate + sanitize the parsed object before returning. A model
  // that hallucinates a category outside our enum, or returns a non-
  // numeric amount, would crash the form silently — better to drop
  // the bad field and let the user fill it.
  const out = {
    amount: Number.isFinite(Number(parsed.amount)) && Number(parsed.amount) > 0
      ? Math.round(Number(parsed.amount))
      : null,
    date: typeof parsed.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
      ? parsed.date
      : null,
    vendor: typeof parsed.vendor === "string" && parsed.vendor.trim()
      ? parsed.vendor.trim().slice(0, 60)
      : null,
    description: typeof parsed.description === "string" && parsed.description.trim()
      ? parsed.description.trim().slice(0, 50)
      : null,
    category: typeof parsed.category === "string" && ALLOWED_CATEGORIES.includes(parsed.category)
      ? parsed.category
      : null,
    cfdiUuid: typeof parsed.cfdiUuid === "string" && /^[0-9a-fA-F-]{30,40}$/.test(parsed.cfdiUuid.trim())
      ? parsed.cfdiUuid.trim()
      : null,
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
  };

  return res.status(200).json(out);
}

export default withSentry(handler, { name: "ocr-receipt" });
