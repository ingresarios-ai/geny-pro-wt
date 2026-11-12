import { NextRequest, NextResponse } from "next/server";
import { inflateRawSync } from "zlib";
import { generateText, CoreMessage, UserContent } from "ai";
import { google } from "@ai-sdk/google";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import {
  getGenySettings,
  getSupabaseAdmin,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  indexKnowledgeDocument,
  logRagUsageEvent,
  resolveOrAutoClassifyCategory,
} from "@/lib/geny/rag";

export const maxDuration = 300;

const STORAGE_BUCKET = "geny-knowledge-temp";

const MULTIMODAL_EXTRACTION_PROMPT = `Eres el Ingeniero de Conocimiento Multimodal de GENY PRO (INGRESARIOS).
Tu tarea es convertir este documento o archivo en una guía técnica completa en formato Markdown para la base de conocimiento vectorial (RAG) de GENY PRO.

REGLAS ESTRICTAS DE EXTRACCIÓN:
1. TEXTO ÍNTEGRO: Transcribe de forma completa y estructurada todo el texto, definiciones, reglas operativas, pasos metodológicos (PEDEM, La Rueda, Reditum Sniper, Geny Trend, Psicotrading, Gestión de Riesgo), fórmulas y tablas del documento. No resumas ni omitas reglas.
2. IMÁGENES, GRÁFICOS Y DIAGRAMAS EMBEBIDOS: Cada vez que el documento contenga una imagen, captura de pantalla de TradingView, gráfico de velas, configuración de indicadores, diagrama o tabla visual, incluye un bloque claramente etiquetado:
   ### [ANÁLISIS VISUAL DE GRÁFICO / IMAGEN EN DOCUMENTO]
   Describe con precisión técnica todo lo que enseña esa imagen: qué indicador o estructura aparece, qué colores/bandas/señales se observan, qué regla operativa ilustra y qué texto o anotaciones aparecen dentro de la imagen.
3. ENLACES DE SESIONES, REPETICIONES Y RECURSOS (OBLIGATORIO): Conserva SIEMPRE de forma literal e intacta todas las URLs y enlaces de referencia presentes en el documento (ej. grabaciones o repeticiones como https://tinyurl.com/..., Zoom, YouTube, Vimeo, Google Drive o scripts de TradingView), colocándolos justo debajo del encabezado ## de la sesión o tema correspondiente en texto plano (sin encerrar la URL en backticks \` \`).
4. Responde únicamente con el contenido técnico en español en formato Markdown limpio, listo para ser indexado.`;

async function uploadBufferToGeminiFileApi(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ name: string; uri: string } | null> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) return null;

  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(params.buffer.length),
        "X-Goog-Upload-Header-Content-Type": params.mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: { display_name: params.fileName.slice(0, 120) },
      }),
    }
  );

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!startRes.ok || !uploadUrl) return null;

  const finalizeRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(params.buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(params.buffer),
  });

  if (!finalizeRes.ok) return null;
  const json = (await finalizeRes.json()) as {
    file?: { name?: string; uri?: string; state?: string };
  };
  const fileNameId = json.file?.name;
  const fileUri = json.file?.uri;
  if (!fileNameId || !fileUri) return null;

  // Esperar si Gemini aún está indexando el PDF grande (PROCESSING -> ACTIVE)
  let state = json.file?.state || "ACTIVE";
  for (let attempt = 0; attempt < 16 && state === "PROCESSING"; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));
    const checkRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileNameId}?key=${apiKey}`
    );
    if (checkRes.ok) {
      const checkJson = (await checkRes.json()) as { state?: string };
      state = checkJson.state || "ACTIVE";
    }
  }

  return state === "ACTIVE" ? { name: fileNameId, uri: fileUri } : null;
}

function estimatePdfPageCount(buffer: Buffer): number {
  const raw = buffer.toString("latin1");
  let maxFromPagesTree = 0;
  const pagesTreeRegex = /\/Type\s*\/Pages\b[\s\S]{0,350}?\/Count\s+(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = pagesTreeRegex.exec(raw)) !== null) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > maxFromPagesTree && n < 5000) {
      maxFromPagesTree = n;
    }
  }

  const singlePageMatches = raw.match(/\/Type\s*\/Page\b(?!s)/g);
  const leafCount = singlePageMatches ? singlePageMatches.length : 0;
  return Math.max(maxFromPagesTree, leafCount);
}

async function detectPdfPagesWithGemini(
  geminiFileUri: string,
  mimeType: string
): Promise<number> {
  const models = ["gemini-3.5-flash", "gemini-3.8-flash"];
  for (const modelId of models) {
    try {
      const res = await generateText({
        model: google(modelId),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "¿Cuántas páginas en total tiene este archivo PDF? Responde ÚNICAMENTE con el número entero (solo dígitos).",
              },
              {
                type: "file",
                data: new URL(geminiFileUri),
                mimeType,
              },
            ],
          },
        ],
        maxTokens: 32,
        temperature: 0,
        maxRetries: 0,
        providerOptions: {
          google: { thinkingConfig: { thinkingBudget: 0 } },
        },
      });
      const digits = res.text.match(/\d+/)?.[0];
      const parsed = digits ? Number(digits) : 0;
      if (parsed >= 1 && parsed < 5000) {
        return parsed;
      }
    } catch {
      // Continuar con siguiente modelo
    }
  }
  return 0;
}

async function extractPdfRangeWithGeminiVision(params: {
  fileName: string;
  mimeType: string;
  geminiFileUri: string;
  startPage?: number;
  endPage?: number;
  partIndex: number;
  totalParts: number;
}): Promise<string> {
  const candidateModels = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];

  const scopeInstruction =
    params.startPage && params.endPage
      ? `INSTRUCCIÓN DE RANGO ESTRICTA: Procesa y transcribe ÚNICAMENTE desde la página ${params.startPage} hasta la página ${params.endPage} (inclusive) de este PDF. Ignora las demás páginas porque se procesan en otros bloques. No resumas ni omitas reglas de las páginas ${params.startPage} a ${params.endPage}; si en esas páginas no hay contenido relevante (ej. páginas en blanco), indícalo brevemente.`
      : `INSTRUCCIÓN DE SECCIÓN ESTRICTA: Este libro se está procesando en ${params.totalParts} partes iguales. Procesa y transcribe ÚNICAMENTE la Parte ${params.partIndex} de ${params.totalParts} del documento en orden secuencial, sin resumir ni repetir otras partes.`;

  let lastError: unknown = null;
  for (const modelId of candidateModels) {
    try {
      const result = await generateText({
        model: google(modelId),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${MULTIMODAL_EXTRACTION_PROMPT}\n\nArchivo fuente: "${params.fileName}"\n${scopeInstruction}`,
              },
              {
                type: "file",
                data: new URL(params.geminiFileUri),
                mimeType: params.mimeType,
              },
            ],
          },
        ],
        maxTokens: 8192,
        temperature: 0.1,
        maxRetries: 0,
        ...(modelId !== "gemini-3.5-flash-lite"
          ? {
              providerOptions: {
                google: { thinkingConfig: { thinkingBudget: 0 } },
              },
            }
          : {}),
      });

      const extracted = result.text.trim();
      if (extracted) {
        await logRagUsageEvent({
          operationType: "rag_pdf_range_extract",
          modelUsed: modelId,
          label: `${params.fileName} (${params.partIndex}/${params.totalParts})`,
          llmTokensIn: result.usage?.promptTokens ?? 0,
          llmTokensOut: result.usage?.completionTokens ?? 0,
        });
        return extracted;
      }
    } catch (err) {
      lastError = err;
      console.warn(
        `[GENY RAG Chunked PDF] Modelo ${modelId} falló en bloque ${params.partIndex}/${params.totalParts} de ${params.fileName}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  throw new Error(
    `No se pudo extraer el bloque ${params.partIndex}/${params.totalParts}: ${
      lastError instanceof Error ? lastError.message : "Error desconocido"
    }`
  );
}

async function deleteGeminiUploadedFile(name: string): Promise<void> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey || !name) return;
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${name}?key=${apiKey}`,
      { method: "DELETE" }
    );
  } catch {
    // Ignorar error de limpieza
  }
}

async function extractWithGeminiVision(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  extraContextText?: string;
}): Promise<string> {
  const candidateModels = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];

  let lastError: unknown = null;
  let uploadedGeminiFile: { name: string; uri: string } | null = null;

  // Para libros o PDFs grandes (> 5 MB), usar Gemini File Upload API evita límites de payload inline
  if (params.buffer.length > 5 * 1024 * 1024) {
    try {
      uploadedGeminiFile = await uploadBufferToGeminiFileApi({
        fileName: params.fileName,
        mimeType: params.mimeType,
        buffer: params.buffer,
      });
    } catch {
      uploadedGeminiFile = null;
    }
  }

  try {
    for (const modelId of candidateModels) {
      try {
        const contentParts: UserContent = [
          {
            type: "text",
            text: `${MULTIMODAL_EXTRACTION_PROMPT}\n\nArchivo fuente: "${params.fileName}"${
              params.extraContextText
                ? `\n\nTexto extraído previamente del documento:\n${params.extraContextText}`
                : ""
            }`,
          },
        ];

        if (uploadedGeminiFile) {
          contentParts.push({
            type: "file",
            data: new URL(uploadedGeminiFile.uri),
            mimeType: params.mimeType,
          });
        } else if (params.mimeType.startsWith("image/")) {
          contentParts.push({
            type: "image",
            image: params.buffer,
            mimeType: params.mimeType,
          });
        } else {
          contentParts.push({
            type: "file",
            data: params.buffer,
            mimeType: params.mimeType,
          });
        }

        const messages: CoreMessage[] = [
          {
            role: "user",
            content: contentParts,
          },
        ];

        const result = await generateText({
          model: google(modelId),
          messages,
          maxTokens: 12288,
          temperature: 0.1,
          maxRetries: 0,
          ...(modelId !== "gemini-3.5-flash-lite"
            ? {
                providerOptions: {
                  google: { thinkingConfig: { thinkingBudget: 0 } },
                },
              }
            : {}),
        });

        const extracted = result.text.trim();
        if (extracted) {
          await logRagUsageEvent({
            operationType: "rag_multimodal_extract",
            modelUsed: modelId,
            label: params.fileName,
            llmTokensIn: result.usage?.promptTokens ?? 0,
            llmTokensOut: result.usage?.completionTokens ?? 0,
          });
          return extracted;
        }
      } catch (err) {
        lastError = err;
        console.warn(
          `[GENY RAG Ingest] Modelo ${modelId} falló al procesar ${params.fileName}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } finally {
    if (uploadedGeminiFile) {
      await deleteGeminiUploadedFile(uploadedGeminiFile.name);
    }
  }

  throw new Error(
    `No se pudo extraer contenido multimodal con Gemini: ${
      lastError instanceof Error ? lastError.message : "Error desconocido"
    }`
  );
}

/**
 * Extrae entradas de un archivo ZIP (.docx) en memoria sin dependencias externas.
 */
function extractDocxParts(zipBuffer: Buffer): {
  text: string;
  images: Array<{ name: string; mimeType: string; data: Buffer }>;
} {
  const images: Array<{ name: string; mimeType: string; data: Buffer }> = [];
  let xmlText = "";

  // Buscar End of Central Directory (EOCD)
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    return { text: "", images: [] };
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let ptr = cdOffset;
  for (let i = 0; i < totalEntries && ptr < zipBuffer.length; i++) {
    if (zipBuffer.readUInt32LE(ptr) !== 0x02014b50) break;

    const compressionMethod = zipBuffer.readUInt16LE(ptr + 10);
    const compressedSize = zipBuffer.readUInt32LE(ptr + 20);
    const fileNameLen = zipBuffer.readUInt16LE(ptr + 28);
    const extraLen = zipBuffer.readUInt16LE(ptr + 30);
    const commentLen = zipBuffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(ptr + 42);

    const entryName = zipBuffer
      .subarray(ptr + 46, ptr + 46 + fileNameLen)
      .toString("utf8");

    ptr += 46 + fileNameLen + extraLen + commentLen;

    if (
      entryName !== "word/document.xml" &&
      !entryName.startsWith("word/media/")
    ) {
      continue;
    }

    if (localHeaderOffset + 30 > zipBuffer.length) continue;
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedSlice = zipBuffer.subarray(
      dataStart,
      dataStart + compressedSize
    );

    let uncompressed: Buffer;
    try {
      if (compressionMethod === 0) {
        uncompressed = Buffer.from(compressedSlice);
      } else if (compressionMethod === 8) {
        uncompressed = inflateRawSync(compressedSlice);
      } else {
        continue;
      }
    } catch {
      continue;
    }

    if (entryName === "word/document.xml") {
      const rawXml = uncompressed.toString("utf8");
      xmlText = rawXml
        .replace(/<\/w:p>/g, "\n\n")
        .replace(/<w:br[^>]*\/>/g, "\n")
        .replace(/<w:tab[^>]*\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } else if (entryName.startsWith("word/media/") && images.length < 5) {
      const lower = entryName.toLowerCase();
      const mimeType = lower.endsWith(".png")
        ? "image/png"
        : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
          ? "image/jpeg"
          : lower.endsWith(".webp")
            ? "image/webp"
            : "";
      if (mimeType) {
        images.push({ name: entryName, mimeType, data: uncompressed });
      }
    }
  }

  return { text: xmlText, images };
}

async function processBufferToMarkdown(params: {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<string> {
  const lowerName = params.fileName.toLowerCase();

  // 1. Archivos de texto plano o Markdown
  if (
    params.mimeType.startsWith("text/") ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerName.endsWith(".csv")
  ) {
    return params.buffer.toString("utf8").trim();
  }

  // 2. Archivos Word (.docx): extraer texto XML + analizar imágenes embebidas con Gemini Vision
  if (
    lowerName.endsWith(".docx") ||
    params.mimeType.includes("officedocument.wordprocessingml.document")
  ) {
    const { text, images } = extractDocxParts(params.buffer);
    const imageAnalyses: string[] = [];

    for (const img of images) {
      try {
        const analysis = await extractWithGeminiVision({
          fileName: `${params.fileName} (${img.name})`,
          mimeType: img.mimeType,
          buffer: img.data,
        });
        if (analysis) {
          imageAnalyses.push(analysis);
        }
      } catch {
        // Continúa si alguna imagen individual falla
      }
    }

    const combined = [
      text,
      imageAnalyses.length > 0
        ? `\n\n## Imágenes y Gráficos Extraídos del Documento Word\n\n${imageAnalyses.join("\n\n---\n\n")}`
        : "",
    ]
      .join("")
      .trim();

    if (combined) return combined;
  }

  // 3. PDFs e Imágenes: Extracción Multimodal Directa con Gemini 3.8 Flash
  const effectiveMime = lowerName.endsWith(".pdf")
    ? "application/pdf"
    : params.mimeType || "application/pdf";

  return extractWithGeminiVision({
    fileName: params.fileName,
    mimeType: effectiveMime,
    buffer: params.buffer,
  });
}

async function saveAndIndexDocument(params: {
  title: string;
  category: string;
  rawContent: string;
  sourceUrl?: string | null;
}) {
  const supabase = getSupabaseAdmin();
  const cleanTitle = params.title.trim();
  const {
    category: cleanCategory,
    autoClassified,
    isNewCategory,
  } = await resolveOrAutoClassifyCategory({
    requestedCategory: params.category,
    title: cleanTitle,
    rawContent: params.rawContent,
  });
  const normalizedUrl = params.sourceUrl?.trim() || null;

  let existingId: string | null = null;
  if (normalizedUrl) {
    const { data: existingDoc } = await supabase
      .from("geny_knowledge_documents")
      .select("id")
      .eq("source_url", normalizedUrl)
      .limit(1)
      .maybeSingle();
    if (existingDoc?.id) {
      existingId = existingDoc.id;
    }
  }

  const { data: doc, error } = existingId
    ? await supabase
        .from("geny_knowledge_documents")
        .update({
          title: cleanTitle,
          category: cleanCategory,
          source_url: normalizedUrl,
          raw_content: params.rawContent,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingId)
        .select("id, title, category")
        .single()
    : await supabase
        .from("geny_knowledge_documents")
        .insert({
          title: cleanTitle,
          category: cleanCategory,
          source_url: normalizedUrl,
          raw_content: params.rawContent,
          is_active: true,
        })
        .select("id, title, category")
        .single();

  if (error || !doc) {
    throw new Error(error?.message || "No se pudo guardar el documento.");
  }

  const { chunksIndexed } = await indexKnowledgeDocument({
    documentId: doc.id,
    title: doc.title,
    category: doc.category,
    rawContent: params.rawContent,
  });

  return { doc, chunksIndexed, category: doc.category, autoClassified, isNewCategory };
}

function isSafeExternalHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

type IngestTarget =
  | { type: "gdoc" | "file" | "folder"; id: string; originalUrl: string }
  | { type: "web"; originalUrl: string };

function parseIngestTargets(rawInput: string): IngestTarget[] {
  const lines = rawInput
    .split(/[\r\n]+/)
    .flatMap((line) => line.split(/\s+/))
    .map((l) => l.trim().replace(/,+$/, ""))
    .filter(Boolean);

  const targets: IngestTarget[] = [];
  const seenUrls = new Set<string>();

  for (const rawCandidate of lines) {
    const url = /^https?:\/\//i.test(rawCandidate)
      ? rawCandidate
      : /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(rawCandidate)
        ? `https://${rawCandidate}`
        : rawCandidate;

    if (seenUrls.has(url)) continue;

    const docMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (docMatch?.[1]) {
      seenUrls.add(url);
      targets.push({ type: "gdoc", id: docMatch[1], originalUrl: url });
      continue;
    }

    const folderMatch = url.match(
      /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/
    );
    if (folderMatch?.[1]) {
      seenUrls.add(url);
      targets.push({ type: "folder", id: folderMatch[1], originalUrl: url });
      continue;
    }

    const fileMatch =
      url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      (url.includes("drive.google.com")
        ? url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
        : null);
    if (fileMatch?.[1]) {
      seenUrls.add(url);
      targets.push({ type: "file", id: fileMatch[1], originalUrl: url });
      continue;
    }

    if (isSafeExternalHttpUrl(url)) {
      seenUrls.add(url);
      targets.push({ type: "web", originalUrl: url });
    }
  }

  return targets;
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number(dec);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    });
}

function htmlToStructuredText(html: string): {
  title: string;
  description: string;
  bodyText: string;
} {
  const titleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);

  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i) ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);

  const title = decodeHtmlEntities(
    (titleMatch?.[1] || "").replace(/\s+/g, " ").trim()
  );
  const description = decodeHtmlEntities(
    (descMatch?.[1] || "").replace(/\s+/g, " ").trim()
  );

  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|canvas|iframe|nav|footer)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n\n#### $1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1")
    .replace(/<(tr|p|div|section|article|blockquote)[^>]*>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  const bodyText = decodeHtmlEntities(cleaned)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, description, bodyText };
}

async function structureWebTextWithGemini(params: {
  url: string;
  pageTitle: string;
  rawText: string;
}): Promise<string> {
  const candidateModels = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];

  const prompt = `Eres el Ingeniero de Conocimiento de GENY PRO (INGRESARIOS).
Convierte el contenido extraído de la siguiente página web en un documento técnico en formato Markdown limpio, completo y estructurado para la base de conocimiento vectorial (RAG) de GENY PRO.

REGLAS:
1. Conserva el 100% de la información útil: conceptos, metodología, reglas, pasos, preguntas frecuentes (FAQs), planes, precios, fechas, enlaces clave y definiciones.
2. Elimina únicamente ruido de navegación web (botones de cookies, "iniciar sesión", avisos legales repetitivos o menús vacíos).
3. Organiza con encabezados Markdown claros (#, ##, ###) y listas con viñetas.
4. Responde solo con el documento Markdown en español.

URL fuente: ${params.url}
Título detectado: ${params.pageTitle}

Contenido extraído de la página:
${params.rawText.slice(0, 75000)}`;

  for (const modelId of candidateModels) {
    try {
      const result = await generateText({
        model: google(modelId),
        prompt,
        maxTokens: 4096,
        temperature: 0.1,
        maxRetries: 0,
        ...(modelId !== "gemini-3.5-flash-lite"
          ? {
              providerOptions: {
                google: { thinkingConfig: { thinkingBudget: 0 } },
              },
            }
          : {}),
      });
      const text = result.text.trim();
      if (text.length >= 80) {
        await logRagUsageEvent({
          operationType: "rag_web_extract",
          modelUsed: modelId,
          label: params.pageTitle || params.url,
          llmTokensIn: result.usage?.promptTokens ?? 0,
          llmTokensOut: result.usage?.completionTokens ?? 0,
        });
        return text;
      }
    } catch (err) {
      console.warn(
        `[GENY Web Ingest] Fallo modelo ${modelId} en ${params.url}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return `# ${params.pageTitle}\n\nFuente oficial: ${params.url}\n\n${params.rawText}`;
}

async function fetchAndExtractWebUrl(rawUrl: string): Promise<{
  title: string;
  markdown: string;
}> {
  if (!isSafeExternalHttpUrl(rawUrl)) {
    throw new Error(`URL no permitida o inválida: ${rawUrl}`);
  }

  const parsedUrl = new URL(rawUrl);
  const res = await fetch(rawUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/pdf,text/markdown,text/plain,*/*;q=0.8",
      "Accept-Language": "es-419,es;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `No se pudo leer ${rawUrl} (HTTP ${res.status}). Verifica que la página sea pública.`
    );
  }

  const contentType = (res.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const pathName = decodeURIComponent(
    parsedUrl.pathname.split("/").filter(Boolean).pop() || parsedUrl.hostname
  );

  // Si la URL apunta directamente a un PDF, DOCX, Imagen o Markdown/TXT
  if (
    contentType === "application/pdf" ||
    contentType.startsWith("image/") ||
    contentType.includes("officedocument.wordprocessingml") ||
    /\.(pdf|docx|png|jpe?g|webp)$/i.test(parsedUrl.pathname)
  ) {
    const arr = await res.arrayBuffer();
    const markdown = await processBufferToMarkdown({
      fileName: pathName,
      mimeType: contentType || "application/pdf",
      buffer: Buffer.from(arr),
    });
    return {
      title: pathName.replace(/\.[a-zA-Z0-9]+$/, "") || parsedUrl.hostname,
      markdown,
    };
  }

  if (
    contentType === "text/plain" ||
    contentType === "text/markdown" ||
    /\.(md|txt)$/i.test(parsedUrl.pathname)
  ) {
    const plain = (await res.text()).trim();
    return {
      title: pathName.replace(/\.[a-zA-Z0-9]+$/, "") || parsedUrl.hostname,
      markdown: plain,
    };
  }

  // Página Web HTML
  const html = await res.text();
  let { title, description, bodyText } = htmlToStructuredText(html);

  // Fallback automático para sitios dinámicos SPA (React/Framer/Notion) cuyo HTML inicial viene casi vacío
  if (bodyText.length < 140) {
    try {
      const readerRes = await fetch(`https://r.jina.ai/${rawUrl}`, {
        headers: { Accept: "text/plain" },
        cache: "no-store",
      });
      if (readerRes.ok) {
        const readerText = (await readerRes.text()).trim();
        if (readerText.length > bodyText.length) {
          bodyText = readerText;
        }
      }
    } catch {
      // Continuar con el texto disponible
    }
  }

  const combinedRaw = [description, bodyText].filter(Boolean).join("\n\n").trim();
  if (!combinedRaw) {
    throw new Error(
      `La página ${rawUrl} no devolvió texto legible (puede requerir inicio de sesión privado).`
    );
  }

  const cleanTitle =
    title ||
    `${parsedUrl.hostname}${parsedUrl.pathname !== "/" ? parsedUrl.pathname : ""}`;

  const markdown = await structureWebTextWithGemini({
    url: rawUrl,
    pageTitle: cleanTitle,
    rawText: combinedRaw,
  });

  return {
    title: cleanTitle,
    markdown,
  };
}

async function expandPublicDriveFolder(folderId: string): Promise<{
  status: "ok" | "private" | "empty";
  entries: Array<{ id: string; titleHint?: string; isDoc?: boolean }>;
}> {
  try {
    // 1. Verificar primero si la carpeta redirige a inicio de sesión privado de Google
    const folderCheck = await fetch(
      `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        redirect: "manual",
        cache: "no-store",
      }
    );

    const redirectLoc = folderCheck.headers.get("location") || "";
    if (
      (folderCheck.status === 301 ||
        folderCheck.status === 302 ||
        folderCheck.status === 303 ||
        folderCheck.status === 307) &&
      redirectLoc.includes("accounts.google.com")
    ) {
      return { status: "private", entries: [] };
    }

    const results: Array<{ id: string; titleHint?: string; isDoc?: boolean }> =
      [];
    const seen = new Set<string>();

    // 2. Intentar vista limpia embeddedfolderview para carpetas públicas ("Cualquier persona con el enlace")
    const res = await fetch(
      `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        cache: "no-store",
      }
    );

    if (res.ok) {
      const html = await res.text();
      const entryRegex =
        /id="entry-([a-zA-Z0-9_-]{20,})"[\s\S]{0,800}?class="flip-entry-title">([^<]+)</g;
      let match: RegExpExecArray | null;
      while ((match = entryRegex.exec(html)) !== null) {
        const id = match[1];
        const titleHint = decodeHtmlEntities(match[2]?.trim() || "");
        const blockSlice = match[0] || "";
        const isDoc = blockSlice.includes("docs.google.com/document/");
        if (id && id !== folderId && !seen.has(id)) {
          seen.add(id);
          results.push({ id, titleHint, isDoc });
        }
      }

      if (results.length === 0) {
        const genericRegex =
          /\/file\/d\/([a-zA-Z0-9_-]{20,})|\/document\/d\/([a-zA-Z0-9_-]{20,})/g;
        while ((match = genericRegex.exec(html)) !== null) {
          const id = match[1] || match[2];
          const isDoc = Boolean(match[2]);
          if (id && id !== folderId && !seen.has(id)) {
            seen.add(id);
            results.push({ id, isDoc });
          }
        }
      }
    } else if (res.status === 401 || res.status === 403 || res.status === 500) {
      // embeddedfolderview devuelve 500/403 cuando la carpeta está en modo "Restringido"
      if (folderCheck.status >= 400) {
        return { status: "private", entries: [] };
      }
    }

    // 3. Fallback: extraer IDs embebidos del HTML directo de la carpeta pública si embeddedfolderview no devolvió entradas
    if (results.length === 0 && folderCheck.ok) {
      const folderHtml = await folderCheck.text();
      if (
        folderHtml.includes("ServiceLogin") &&
        !folderHtml.includes("_initData")
      ) {
        return { status: "private", entries: [] };
      }
      const dataIdRegex = /data-id="([a-zA-Z0-9_-]{25,45})"/g;
      let m: RegExpExecArray | null;
      while ((m = dataIdRegex.exec(folderHtml)) !== null) {
        const id = m[1];
        if (id && id !== folderId && !seen.has(id)) {
          seen.add(id);
          results.push({ id });
        }
      }
    }

    if (results.length === 0) {
      return { status: "empty", entries: [] };
    }

    return { status: "ok", entries: results };
  } catch {
    return { status: "empty", entries: [] };
  }
}

async function fetchDriveItemBuffer(params: {
  type: "gdoc" | "file";
  id: string;
  titleHint?: string;
}): Promise<{ fileName: string; mimeType: string; buffer: Buffer }> {
  const downloadUrl =
    params.type === "gdoc"
      ? `https://docs.google.com/document/d/${params.id}/export?format=pdf`
      : `https://drive.google.com/uc?export=download&id=${params.id}&confirm=t`;

  const res = await fetch(downloadUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `No se pudo descargar el archivo (${params.id}) desde Google Drive (HTTP ${res.status}). Verifica que tenga permiso "Cualquier persona con el enlace puede ver".`
    );
  }

  const contentType =
    res.headers.get("content-type") || "application/octet-stream";

  // Si devuelve HTML en lugar de binario, puede ser porque es un Google Doc abierto como file o porque la carpeta/archivo es privado
  if (contentType.includes("text/html")) {
    // Intentar exportar como PDF de Google Docs por si era un Google Doc con link de Drive
    const fallbackDocRes = await fetch(
      `https://docs.google.com/document/d/${params.id}/export?format=pdf`,
      { redirect: "follow", cache: "no-store" }
    );
    if (
      fallbackDocRes.ok &&
      (fallbackDocRes.headers.get("content-type") || "").includes("pdf")
    ) {
      const arr = await fallbackDocRes.arrayBuffer();
      return {
        fileName: params.titleHint || `GoogleDoc_${params.id.slice(0, 8)}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from(arr),
      };
    }

    throw new Error(
      `El archivo ${params.id} en Google Drive requiere acceso público ("Cualquier persona con el enlace").`
    );
  }

  const disposition = res.headers.get("content-disposition") || "";
  const filenameMatch =
    disposition.match(/filename\*=UTF-8''([^;]+)/i) ||
    disposition.match(/filename="?([^";]+)"?/i);

  const decodedName = filenameMatch?.[1]
    ? decodeURIComponent(filenameMatch[1].trim())
    : params.titleHint || `Drive_${params.id.slice(0, 8)}.pdf`;

  const arrayBuffer = await res.arrayBuffer();
  return {
    fileName: decodedName,
    mimeType: contentType.split(";")[0].trim(),
    buffer: Buffer.from(arrayBuffer),
  };
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  if (isSupabaseAdminConfigured()) {
    await getGenySettings();
  }

  try {
    const contentType = req.headers.get("content-type") || "";

    // MODO A (legado archivos pequeños): Subida de archivo binario vía FormData
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const category = String(form.get("category") || "__auto__");
      const customTitle = String(form.get("title") || "").trim();

      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "No se recibió ningún archivo válido." },
          { status: 400 }
        );
      }

      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      const extractedMarkdown = await processBufferToMarkdown({
        fileName: file.name,
        mimeType: file.type || "application/pdf",
        buffer,
      });

      if (!extractedMarkdown.trim()) {
        return NextResponse.json(
          {
            error: `No se pudo extraer contenido legible de ${file.name}.`,
          },
          { status: 400 }
        );
      }

      const cleanTitle =
        customTitle || file.name.replace(/\.[a-zA-Z0-9]+$/, "");

      const saved = await saveAndIndexDocument({
        title: cleanTitle,
        category,
        rawContent: extractedMarkdown,
      });

      return NextResponse.json({
        ok: true,
        document: saved.doc,
        category: saved.category,
        autoClassified: saved.autoClassified,
        isNewCategory: saved.isNewCategory,
        chunksIndexed: saved.chunksIndexed,
        charactersExtracted: extractedMarkdown.length,
      });
    }

    const body = (await req.json()) as {
      action?:
        | "create_upload_url"
        | "prepare_storage_file"
        | "extract_gemini_pdf_range"
        | "finalize_chunked_document"
        | "cleanup_chunked_document"
        | "ingest_storage_file"
        | "expand_targets";
      fileName?: string;
      mimeType?: string;
      storagePath?: string;
      draftDocumentId?: string;
      geminiFileName?: string;
      geminiFileUri?: string;
      startPage?: number;
      endPage?: number;
      partIndex?: number;
      totalParts?: number;
      title?: string;
      titleHint?: string;
      driveUrls?: string;
      category?: string;
    };

    // ACCIÓN 1: Crear URL firmada para subida directa a Supabase Storage (soporta PDFs pesados > 4.5 MB con progreso real 0-100%)
    if (body.action === "create_upload_url") {
      const supabase = getSupabaseAdmin();
      const safeName = (body.fileName || "documento.pdf")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]+/g, "_")
        .slice(-90);
      const storagePath = `ingest/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUploadUrl(storagePath);

      if (error || !data?.signedUrl) {
        return NextResponse.json(
          {
            error:
              error?.message ||
              "No se pudo generar enlace de subida en Supabase Storage.",
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        signedUrl: data.signedUrl,
        storagePath,
      });
    }

    // ACCIÓN 1B: Preparar archivo subido; si es un libro/PDF mediano o grande, subir a Gemini File API y dividir en bloques de 15 páginas (< 15s por bloque, cero error 504)
    if (body.action === "prepare_storage_file") {
      if (!body.storagePath || !body.fileName) {
        return NextResponse.json(
          { error: "Falta storagePath o fileName." },
          { status: 400 }
        );
      }

      const supabase = getSupabaseAdmin();
      try {
        const { data: blobData, error: dlErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .download(body.storagePath);

        if (dlErr || !blobData) {
          return NextResponse.json(
            {
              error:
                dlErr?.message ||
                "No se encontró el archivo subido en el almacenamiento temporal.",
            },
            { status: 400 }
          );
        }

        const arrayBuf = await blobData.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const cleanTitle =
          (body.title || "").trim() ||
          body.fileName.replace(/\.[a-zA-Z0-9]+$/, "");
        const lowerName = body.fileName.toLowerCase();
        const isPdf =
          lowerName.endsWith(".pdf") ||
          (body.mimeType || "").toLowerCase() === "application/pdf";

        if (isPdf) {
          const estimatedPages = estimatePdfPageCount(buffer);
          const isSmallPdf =
            buffer.length <= 600 * 1024 &&
            estimatedPages >= 1 &&
            estimatedPages <= 10;

          if (!isSmallPdf) {
            const uploaded = await uploadBufferToGeminiFileApi({
              fileName: body.fileName,
              mimeType: "application/pdf",
              buffer,
            });

            if (uploaded) {
              const totalPages =
                estimatedPages >= 2
                  ? estimatedPages
                  : await detectPdfPagesWithGemini(
                      uploaded.uri,
                      "application/pdf"
                    );

              const { data: draftDoc, error: draftErr } = await supabase
                .from("geny_knowledge_documents")
                .insert({
                  title: cleanTitle,
                  category:
                    body.category &&
                    body.category !== "__auto__" &&
                    body.category !== "__custom__"
                      ? body.category
                      : "general",
                  raw_content: "",
                  is_active: false,
                })
                .select("id")
                .single();

              if (draftErr || !draftDoc) {
                await deleteGeminiUploadedFile(uploaded.name);
                throw new Error(
                  draftErr?.message ||
                    "No se pudo inicializar el borrador del libro."
                );
              }

              const PAGES_PER_WINDOW = 15;
              const ranges: Array<{
                partIndex: number;
                totalParts: number;
                startPage?: number;
                endPage?: number;
                label: string;
              }> = [];

              if (totalPages >= 1) {
                const totalParts = Math.ceil(totalPages / PAGES_PER_WINDOW);
                for (let p = 0; p < totalParts; p++) {
                  const startPage = p * PAGES_PER_WINDOW + 1;
                  const endPage = Math.min(
                    (p + 1) * PAGES_PER_WINDOW,
                    totalPages
                  );
                  ranges.push({
                    partIndex: p + 1,
                    totalParts,
                    startPage,
                    endPage,
                    label: `Págs. ${startPage}–${endPage} de ${totalPages}`,
                  });
                }
              } else {
                const fallbackParts = Math.max(
                  4,
                  Math.min(12, Math.ceil(buffer.length / (2 * 1024 * 1024)))
                );
                for (let p = 0; p < fallbackParts; p++) {
                  ranges.push({
                    partIndex: p + 1,
                    totalParts: fallbackParts,
                    label: `Sección ${p + 1} de ${fallbackParts}`,
                  });
                }
              }

              return NextResponse.json({
                ok: true,
                mode: "chunked_pdf",
                draftDocumentId: draftDoc.id,
                geminiFileName: uploaded.name,
                geminiFileUri: uploaded.uri,
                totalPages,
                ranges,
              });
            }
          }
        }

        // Archivos rápidos (.md, .txt, .csv, .docx, imágenes o PDF corto <= 10 págs)
        const extractedMarkdown = await processBufferToMarkdown({
          fileName: body.fileName,
          mimeType: body.mimeType || "application/pdf",
          buffer,
        });

        if (!extractedMarkdown.trim()) {
          return NextResponse.json(
            {
              error: `No se pudo extraer contenido legible de ${body.fileName}.`,
            },
            { status: 400 }
          );
        }

        const saved = await saveAndIndexDocument({
          title: cleanTitle,
          category: body.category || "__auto__",
          rawContent: extractedMarkdown,
        });

        return NextResponse.json({
          ok: true,
          mode: "completed",
          document: saved.doc,
          category: saved.category,
          autoClassified: saved.autoClassified,
          isNewCategory: saved.isNewCategory,
          chunksIndexed: saved.chunksIndexed,
          charactersExtracted: extractedMarkdown.length,
        });
      } finally {
        await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([body.storagePath])
          .catch(() => undefined);
      }
    }

    // ACCIÓN 1C: Extraer un bloque de 15 páginas de un libro PDF ya cargado en Gemini File API (< 15s por llamada)
    if (body.action === "extract_gemini_pdf_range") {
      if (
        !body.draftDocumentId ||
        !body.geminiFileUri ||
        !body.partIndex ||
        !body.totalParts
      ) {
        return NextResponse.json(
          { error: "Faltan parámetros para extraer el bloque del PDF." },
          { status: 400 }
        );
      }

      const supabase = getSupabaseAdmin();
      const markdownPart = await extractPdfRangeWithGeminiVision({
        fileName: body.fileName || "Libro.pdf",
        mimeType: body.mimeType || "application/pdf",
        geminiFileUri: body.geminiFileUri,
        startPage: body.startPage,
        endPage: body.endPage,
        partIndex: body.partIndex,
        totalParts: body.totalParts,
      });

      const { data: currentDoc, error: readErr } = await supabase
        .from("geny_knowledge_documents")
        .select("raw_content")
        .eq("id", body.draftDocumentId)
        .single();

      if (readErr || !currentDoc) {
        return NextResponse.json(
          { error: "No se encontró el borrador del libro en progreso." },
          { status: 404 }
        );
      }

      const headerLabel =
        body.startPage && body.endPage
          ? `<!-- Páginas ${body.startPage}-${body.endPage} -->\n`
          : `<!-- Bloque ${body.partIndex}/${body.totalParts} -->\n`;

      const nextRawContent = currentDoc.raw_content
        ? `${currentDoc.raw_content}\n\n---\n\n${headerLabel}${markdownPart}`
        : `${headerLabel}${markdownPart}`;

      const { error: updErr } = await supabase
        .from("geny_knowledge_documents")
        .update({
          raw_content: nextRawContent,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.draftDocumentId);

      if (updErr) {
        throw new Error(updErr.message);
      }

      return NextResponse.json({
        ok: true,
        charsExtracted: markdownPart.length,
      });
    }

    // ACCIÓN 1D: Clasificar categoría IA, activar documento completo y vectorizar por lotes rápidos
    if (body.action === "finalize_chunked_document") {
      if (!body.draftDocumentId) {
        return NextResponse.json(
          { error: "Falta draftDocumentId." },
          { status: 400 }
        );
      }

      const supabase = getSupabaseAdmin();
      if (body.geminiFileName) {
        await deleteGeminiUploadedFile(body.geminiFileName);
      }

      const { data: draftDoc, error: readErr } = await supabase
        .from("geny_knowledge_documents")
        .select("id, title, raw_content")
        .eq("id", body.draftDocumentId)
        .single();

      if (readErr || !draftDoc || !draftDoc.raw_content.trim()) {
        if (body.draftDocumentId) {
          await supabase
            .from("geny_knowledge_documents")
            .delete()
            .eq("id", body.draftDocumentId)
            .eq("is_active", false);
        }
        return NextResponse.json(
          { error: "No se extrajo contenido válido del PDF." },
          { status: 400 }
        );
      }

      const {
        category: cleanCategory,
        autoClassified,
        isNewCategory,
      } = await resolveOrAutoClassifyCategory({
        requestedCategory: body.category || "__auto__",
        title: draftDoc.title,
        rawContent: draftDoc.raw_content,
      });

      const { error: activateErr } = await supabase
        .from("geny_knowledge_documents")
        .update({
          category: cleanCategory,
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", draftDoc.id);

      if (activateErr) {
        throw new Error(activateErr.message);
      }

      const { chunksIndexed } = await indexKnowledgeDocument({
        documentId: draftDoc.id,
        title: draftDoc.title,
        category: cleanCategory,
        rawContent: draftDoc.raw_content,
      });

      return NextResponse.json({
        ok: true,
        category: cleanCategory,
        autoClassified,
        isNewCategory,
        chunksIndexed,
        charactersExtracted: draftDoc.raw_content.length,
      });
    }

    // ACCIÓN 1E: Limpieza en caso de error durante extracción por bloques
    if (body.action === "cleanup_chunked_document") {
      const supabase = getSupabaseAdmin();
      if (body.geminiFileName) {
        await deleteGeminiUploadedFile(body.geminiFileName);
      }
      if (body.draftDocumentId) {
        await supabase
          .from("geny_knowledge_documents")
          .delete()
          .eq("id", body.draftDocumentId)
          .eq("is_active", false);
      }
      return NextResponse.json({ ok: true });
    }

    // ACCIÓN 2: Procesar archivo ya subido a Supabase Storage y limpiar el archivo temporal al terminar
    if (body.action === "ingest_storage_file") {
      if (!body.storagePath || !body.fileName) {
        return NextResponse.json(
          { error: "Falta storagePath o fileName." },
          { status: 400 }
        );
      }

      const supabase = getSupabaseAdmin();
      try {
        const { data: blobData, error: dlErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .download(body.storagePath);

        if (dlErr || !blobData) {
          return NextResponse.json(
            {
              error:
                dlErr?.message ||
                "No se encontró el archivo subido en el almacenamiento temporal.",
            },
            { status: 400 }
          );
        }

        const arrayBuf = await blobData.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const extractedMarkdown = await processBufferToMarkdown({
          fileName: body.fileName,
          mimeType: body.mimeType || "application/pdf",
          buffer,
        });

        if (!extractedMarkdown.trim()) {
          return NextResponse.json(
            {
              error: `No se pudo extraer contenido legible de ${body.fileName}.`,
            },
            { status: 400 }
          );
        }

        const cleanTitle =
          (body.title || "").trim() ||
          body.fileName.replace(/\.[a-zA-Z0-9]+$/, "");

        const saved = await saveAndIndexDocument({
          title: cleanTitle,
          category: body.category || "__auto__",
          rawContent: extractedMarkdown,
        });

        return NextResponse.json({
          ok: true,
          document: saved.doc,
          category: saved.category,
          autoClassified: saved.autoClassified,
          isNewCategory: saved.isNewCategory,
          chunksIndexed: saved.chunksIndexed,
          charactersExtracted: extractedMarkdown.length,
        });
      } finally {
        await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([body.storagePath])
          .catch(() => undefined);
      }
    }

    // ACCIÓN 3: Expandir carpetas de Google Drive (ej. 20+ documentos) + URLs individuales para cola en segundo plano
    if (body.action === "expand_targets") {
      if (!body.driveUrls?.trim()) {
        return NextResponse.json(
          {
            error:
              "Pega al menos una URL web (https://...) o enlace/carpeta de Google Drive.",
          },
          { status: 400 }
        );
      }

      const parsed = parseIngestTargets(body.driveUrls);
      if (parsed.length === 0) {
        return NextResponse.json(
          {
            error:
              "No se detectaron URLs públicas válidas (https://...) ni enlaces de Google Drive.",
          },
          { status: 400 }
        );
      }

      const expandedItems: Array<{
        label: string;
        url: string;
        titleHint?: string;
      }> = [];

      for (const t of parsed) {
        if (t.type === "folder") {
          const folderResult = await expandPublicDriveFolder(t.id);
          if (folderResult.status === "private") {
            return NextResponse.json(
              {
                error:
                  "🔒 Esa carpeta de Google Drive es PRIVADA ('Restringido'). Haz clic derecho en la carpeta en Google Drive → Compartir → cambia Acceso general a 'Cualquier persona con el enlace (Lector)' e inténtalo de nuevo.",
              },
              { status: 400 }
            );
          }
          if (folderResult.entries.length === 0) {
            return NextResponse.json(
              {
                error:
                  "No se encontraron archivos visibles dentro de la carpeta de Google Drive (verifica que no esté vacía o que sus archivos no estén solo dentro de subcarpetas).",
              },
              { status: 400 }
            );
          }
          for (const entry of folderResult.entries) {
            const fileUrl = entry.isDoc
              ? `https://docs.google.com/document/d/${entry.id}/edit`
              : `https://drive.google.com/file/d/${entry.id}/view`;
            expandedItems.push({
              label: entry.titleHint || `Archivo Drive (${entry.id.slice(0, 8)})`,
              url: fileUrl,
              titleHint: entry.titleHint,
            });
          }
        } else if (t.type === "gdoc") {
          expandedItems.push({
            label: `Google Doc (${t.id.slice(0, 8)})`,
            url: t.originalUrl,
          });
        } else if (t.type === "file") {
          expandedItems.push({
            label: `Archivo Drive (${t.id.slice(0, 8)})`,
            url: t.originalUrl,
          });
        } else {
          expandedItems.push({
            label: t.originalUrl,
            url: t.originalUrl,
          });
        }
      }

      return NextResponse.json({
        ok: true,
        expandedItems,
      });
    }

    // MODO B: Importación universal desde URLs Web (páginas, artículos, PDFs online) o Google Drive
    if (!body.driveUrls?.trim()) {
      return NextResponse.json(
        {
          error:
            "Pega al menos una URL web (https://...) o enlace de Google Drive.",
        },
        { status: 400 }
      );
    }

    const targets = parseIngestTargets(body.driveUrls);
    if (targets.length === 0) {
      return NextResponse.json(
        {
          error:
            "No se detectaron URLs públicas válidas (https://...) ni enlaces de Google Drive.",
        },
        { status: 400 }
      );
    }

    const category = body.category || "__auto__";
    const itemsToProcess: Array<
      | {
          kind: "drive";
          type: "gdoc" | "file";
          id: string;
          titleHint?: string;
          sourceUrl: string;
        }
      | {
          kind: "web";
          sourceUrl: string;
        }
    > = [];

    for (const t of targets) {
      if (t.type === "web") {
        itemsToProcess.push({
          kind: "web",
          sourceUrl: t.originalUrl,
        });
      } else if (t.type === "folder") {
        const folderResult = await expandPublicDriveFolder(t.id);
        if (folderResult.status === "private") {
          return NextResponse.json(
            {
              error:
                "🔒 Esa carpeta de Google Drive es PRIVADA ('Restringido'). Haz clic derecho en la carpeta en Google Drive → Compartir → cambia Acceso general a 'Cualquier persona con el enlace (Lector)' e inténtalo de nuevo.",
            },
            { status: 400 }
          );
        }
        if (folderResult.entries.length === 0) {
          return NextResponse.json(
            {
              error:
                "No se encontraron archivos visibles dentro de la carpeta de Google Drive.",
            },
            { status: 400 }
          );
        }
        for (const entry of folderResult.entries) {
          itemsToProcess.push({
            kind: "drive",
            type: entry.isDoc ? "gdoc" : "file",
            id: entry.id,
            titleHint: entry.titleHint,
            sourceUrl: entry.isDoc
              ? `https://docs.google.com/document/d/${entry.id}/edit`
              : `https://drive.google.com/file/d/${entry.id}/view`,
          });
        }
      } else {
        itemsToProcess.push({
          kind: "drive",
          type: t.type,
          id: t.id,
          titleHint: body.titleHint,
          sourceUrl: t.originalUrl,
        });
      }
    }

    const importedDocs: Array<{
      title: string;
      category: string;
      autoClassified: boolean;
      isNewCategory: boolean;
      chunksIndexed: number;
    }> = [];
    const errors: string[] = [];

    for (const item of itemsToProcess) {
      try {
        if (item.kind === "web") {
          const { title, markdown } = await fetchAndExtractWebUrl(
            item.sourceUrl
          );
          if (!markdown.trim()) {
            errors.push(`${item.sourceUrl}: sin contenido extraíble.`);
            continue;
          }

          const saved = await saveAndIndexDocument({
            title: body.titleHint?.trim() || title,
            category,
            rawContent: markdown,
            sourceUrl: item.sourceUrl,
          });

          importedDocs.push({
            title: saved.doc.title,
            category: saved.category,
            autoClassified: saved.autoClassified,
            isNewCategory: saved.isNewCategory,
            chunksIndexed: saved.chunksIndexed,
          });
          continue;
        }

        const { fileName, mimeType, buffer } = await fetchDriveItemBuffer({
          type: item.type,
          id: item.id,
          titleHint: item.titleHint,
        });

        const extractedMarkdown = await processBufferToMarkdown({
          fileName,
          mimeType,
          buffer,
        });

        if (!extractedMarkdown.trim()) {
          errors.push(`${fileName}: sin contenido extraíble.`);
          continue;
        }

        const cleanTitle = (item.titleHint || fileName).replace(
          /\.[a-zA-Z0-9]+$/,
          ""
        );

        const saved = await saveAndIndexDocument({
          title: cleanTitle,
          category,
          rawContent: extractedMarkdown,
          sourceUrl: item.sourceUrl,
        });

        importedDocs.push({
          title: saved.doc.title,
          category: saved.category,
          autoClassified: saved.autoClassified,
          isNewCategory: saved.isNewCategory,
          chunksIndexed: saved.chunksIndexed,
        });
      } catch (err) {
        errors.push(
          err instanceof Error
            ? err.message
            : `Error procesando ${item.sourceUrl}`
        );
      }
    }

    if (importedDocs.length === 0) {
      return NextResponse.json(
        {
          error:
            errors[0] ||
            "No fue posible leer o indexar las URLs proporcionadas.",
          details: errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      importedCount: importedDocs.length,
      totalChunks: importedDocs.reduce((acc, d) => acc + d.chunksIndexed, 0),
      importedDocs,
      warnings: errors,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Error procesando archivo multimodal.",
      },
      { status: 500 }
    );
  }
}
