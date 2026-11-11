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
import { indexKnowledgeDocument } from "@/lib/geny/rag";

export const maxDuration = 60;

const MULTIMODAL_EXTRACTION_PROMPT = `Eres el Ingeniero de Conocimiento Multimodal de GENY PRO (INGRESARIOS).
Tu tarea es convertir este documento o archivo en una guía técnica completa en formato Markdown para la base de conocimiento vectorial (RAG) de GENY PRO.

REGLAS ESTRICTAS DE EXTRACCIÓN:
1. TEXTO ÍNTEGRO: Transcribe de forma completa y estructurada todo el texto, definiciones, reglas operativas, pasos metodológicos (PEDEM, La Rueda, Reditum Sniper, Geny Trend, Psicotrading, Gestión de Riesgo), fórmulas y tablas del documento. No resumas ni omitas reglas.
2. IMÁGENES, GRÁFICOS Y DIAGRAMAS EMBEBIDOS: Cada vez que el documento contenga una imagen, captura de pantalla de TradingView, gráfico de velas, configuración de indicadores, diagrama o tabla visual, incluye un bloque claramente etiquetado:
   ### [ANÁLISIS VISUAL DE GRÁFICO / IMAGEN EN DOCUMENTO]
   Describe con precisión técnica todo lo que enseña esa imagen: qué indicador o estructura aparece, qué colores/bandas/señales se observan, qué regla operativa ilustra y qué texto o anotaciones aparecen dentro de la imagen.
3. Responde únicamente con el contenido técnico en español en formato Markdown limpio, listo para ser indexado.`;

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

      if (params.mimeType.startsWith("image/")) {
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
        maxTokens: 4096,
        temperature: 0.1,
      });

      const extracted = result.text.trim();
      if (extracted) {
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
  const cleanCategory =
    params.category.trim().toLowerCase().replace(/\s+/g, "_") || "general";

  const { data: doc, error } = await supabase
    .from("geny_knowledge_documents")
    .insert({
      title: cleanTitle,
      category: cleanCategory,
      source_url: params.sourceUrl || null,
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

  return { doc, chunksIndexed };
}

function parseGoogleDriveTargets(rawInput: string): Array<{
  type: "gdoc" | "file" | "folder";
  id: string;
  originalUrl: string;
}> {
  const lines = rawInput
    .split(/[\r\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const targets: Array<{
    type: "gdoc" | "file" | "folder";
    id: string;
    originalUrl: string;
  }> = [];

  for (const url of lines) {
    const docMatch = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (docMatch?.[1]) {
      targets.push({ type: "gdoc", id: docMatch[1], originalUrl: url });
      continue;
    }

    const folderMatch = url.match(
      /drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([a-zA-Z0-9_-]+)/
    );
    if (folderMatch?.[1]) {
      targets.push({ type: "folder", id: folderMatch[1], originalUrl: url });
      continue;
    }

    const fileMatch =
      url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
      url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (fileMatch?.[1]) {
      targets.push({ type: "file", id: fileMatch[1], originalUrl: url });
    }
  }

  return targets;
}

async function expandPublicDriveFolder(folderId: string): Promise<
  Array<{ id: string; titleHint?: string }>
> {
  try {
    const res = await fetch(
      `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(folderId)}#list`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const html = await res.text();

    const results: Array<{ id: string; titleHint?: string }> = [];
    const seen = new Set<string>();

    // En la vista embeddedfolderview cada archivo aparece con id="entry-{FILE_ID}" y <div class="flip-entry-title">Nombre</div>
    const entryRegex =
      /id="entry-([a-zA-Z0-9_-]{20,})"[\s\S]{0,600}?class="flip-entry-title">([^<]+)</g;
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(html)) !== null) {
      const id = match[1];
      const titleHint = match[2]?.trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        results.push({ id, titleHint });
      }
    }

    if (results.length === 0) {
      const genericRegex =
        /\/file\/d\/([a-zA-Z0-9_-]{20,})|\/document\/d\/([a-zA-Z0-9_-]{20,})/g;
      while ((match = genericRegex.exec(html)) !== null) {
        const id = match[1] || match[2];
        if (id && !seen.has(id)) {
          seen.add(id);
          results.push({ id });
        }
      }
    }

    return results;
  } catch {
    return [];
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

    // MODO A: Subida de archivo binario vía FormData (PDF, Imagen, DOCX, TXT, MD)
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      const category = String(form.get("category") || "general");
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

      const { doc, chunksIndexed } = await saveAndIndexDocument({
        title: cleanTitle,
        category,
        rawContent: extractedMarkdown,
      });

      return NextResponse.json({
        ok: true,
        document: doc,
        chunksIndexed,
        charactersExtracted: extractedMarkdown.length,
      });
    }

    // MODO B: Importación desde enlaces o carpeta pública de Google Drive
    const body = (await req.json()) as {
      driveUrls?: string;
      category?: string;
    };

    if (!body.driveUrls?.trim()) {
      return NextResponse.json(
        {
          error:
            "Pega al menos un enlace de archivo o carpeta de Google Drive.",
        },
        { status: 400 }
      );
    }

    const targets = parseGoogleDriveTargets(body.driveUrls);
    if (targets.length === 0) {
      return NextResponse.json(
        {
          error:
            "No se detectaron enlaces válidos de Google Drive o Google Docs.",
        },
        { status: 400 }
      );
    }

    const category = body.category || "general";
    const filesToProcess: Array<{
      type: "gdoc" | "file";
      id: string;
      titleHint?: string;
      sourceUrl: string;
    }> = [];

    for (const t of targets) {
      if (t.type === "folder") {
        const folderEntries = await expandPublicDriveFolder(t.id);
        if (folderEntries.length === 0) {
          return NextResponse.json(
            {
              error:
                "No se encontraron archivos visibles en la carpeta de Drive. Verifica que la carpeta tenga el permiso 'Cualquier persona con el enlace puede ver'.",
            },
            { status: 400 }
          );
        }
        for (const entry of folderEntries) {
          filesToProcess.push({
            type: "file",
            id: entry.id,
            titleHint: entry.titleHint,
            sourceUrl: `https://drive.google.com/file/d/${entry.id}/view`,
          });
        }
      } else {
        filesToProcess.push({
          type: t.type,
          id: t.id,
          sourceUrl: t.originalUrl,
        });
      }
    }

    const importedDocs: Array<{
      title: string;
      chunksIndexed: number;
    }> = [];
    const errors: string[] = [];

    for (const item of filesToProcess) {
      try {
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

        const { doc, chunksIndexed } = await saveAndIndexDocument({
          title: cleanTitle,
          category,
          rawContent: extractedMarkdown,
          sourceUrl: item.sourceUrl,
        });

        importedDocs.push({
          title: doc.title,
          chunksIndexed,
        });
      } catch (err) {
        errors.push(
          err instanceof Error ? err.message : `Error en archivo ${item.id}`
        );
      }
    }

    if (importedDocs.length === 0) {
      return NextResponse.json(
        {
          error:
            errors[0] ||
            "No fue posible importar los archivos desde Google Drive.",
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
