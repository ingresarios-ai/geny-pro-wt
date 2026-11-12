import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { estimateRagExtractionCostUsd } from "@/lib/geny/pricing";

export async function logRagUsageEvent(params: {
  operationType: string;
  modelUsed: string;
  label: string;
  llmTokensIn?: number;
  llmTokensOut?: number;
  embeddingChars?: number;
}): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const llmIn = Math.max(0, Math.round(params.llmTokensIn ?? 0));
    const llmOut = Math.max(0, Math.round(params.llmTokensOut ?? 0));
    const embedChars = Math.max(0, params.embeddingChars ?? 0);
    const approxEmbedTokens = Math.ceil(embedChars / 4);

    const costUsd = estimateRagExtractionCostUsd({
      tokensIn: llmIn,
      tokensOut: llmOut,
      embeddingChars: embedChars,
    });

    if (costUsd <= 0 && llmIn <= 0 && approxEmbedTokens <= 0) {
      return;
    }

    await supabase.from("geny_rag_usage_logs").insert({
      operation_type: params.operationType,
      model_used: params.modelUsed,
      label: params.label.slice(0, 200),
      tokens_in: llmIn + approxEmbedTokens,
      tokens_out: llmOut,
      estimated_cost_usd: costUsd,
    });
  } catch {
    // No bloquear ingesta si falla el registro estadístico
  }
}

const BASE_CATEGORIES = [
  "pedem",
  "la_rueda",
  "indicadores",
  "psicotrading",
  "faq",
  "general",
];

function sanitizeCategorySlug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
}

export async function resolveOrAutoClassifyCategory(params: {
  requestedCategory?: string | null;
  title: string;
  rawContent: string;
}): Promise<{
  category: string;
  autoClassified: boolean;
  isNewCategory: boolean;
}> {
  const reqCat = (params.requestedCategory || "").trim();
  if (reqCat && reqCat !== "__auto__") {
    const normalized = sanitizeCategorySlug(reqCat) || "general";
    return {
      category: normalized,
      autoClassified: false,
      isNewCategory: false,
    };
  }

  const supabase = getSupabaseAdmin();
  const { data: existingRows } = await supabase
    .from("geny_knowledge_documents")
    .select("category");

  const existingSet = new Set<string>(BASE_CATEGORIES);
  for (const r of existingRows || []) {
    if (r.category) existingSet.add(r.category);
  }
  const existingList = Array.from(existingSet);

  const headSample = params.rawContent.slice(0, 3500);
  const midStart = Math.max(0, Math.floor(params.rawContent.length / 2) - 750);
  const midSample =
    params.rawContent.length > 4500
      ? `\n\n[...]\n\n${params.rawContent.slice(midStart, midStart + 1500)}`
      : "";

  const prompt = `Eres el bibliotecario jefe del Cerebro IA de GENY PRO (academia de trading e inversión INGRESARIOS).
Analiza el título y extracto de este documento y clasifícalo en la categoría metodológica más precisa.

CATEGORÍAS EXISTENTES ACTUALMENTE:
- pedem: Método PEDEM, plan de trading, bitácora operativa, reglas del método INGRESARIOS.
- la_rueda: Estrategia La Rueda (The Wheel), venta de puts/calls cubiertos, opciones para flujo.
- indicadores: Indicadores técnicos propios como Reditum Sniper, Geny Trend, configuración en TradingView.
- psicotrading: Mentalidad, gestión emocional, disciplina, miedo, FOMO, sobreoperativa, hábitos del trader.
- faq: Preguntas frecuentes administrativas, soporte, accesos, horarios, membresías, pagos.
- general: Información institucional general de INGRESARIOS cuando abarca muchos temas distintos.
${existingList
  .filter((c) => !BASE_CATEGORIES.includes(c))
  .map((c) => `- ${c}: Categoría personalizada existente en la academia.`)
  .join("\n")}

REGLAS DE DECISIÓN:
1. Si el documento encaja claramente en una de las categorías existentes de la lista anterior, devuelve exactamente el identificador de esa categoría existente.
2. Si el documento trata de una temática específica que NO encaja bien en ninguna categoría existente (por ejemplo: gestion_de_riesgo, opciones_financieras, analisis_tecnico, cuentas_fondeo, acciones_etfs, fiscalidad, etc.), CREA un nuevo identificador corto en español (1 a 3 palabras en snake_case, sin tildes ni caracteres especiales).
3. Responde ÚNICAMENTE con el identificador en minúsculas (una sola palabra en snake_case, sin explicaciones ni comillas).

Título del documento: ${params.title}
Extracto del contenido:
${headSample}${midSample}`;

  const models = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
  ];

  for (const modelId of models) {
    try {
      const res = await generateText({
        model: google(modelId),
        prompt,
        maxTokens: 256,
        temperature: 0,
        ...(modelId !== "gemini-3.5-flash-lite"
          ? {
              providerOptions: {
                google: {
                  thinkingConfig: {
                    thinkingBudget: 0,
                  },
                },
              },
            }
          : {}),
      });
      const firstToken = res.text.trim().split(/[\s\r\n,.;:]+/)[0] || "";
      const slug = sanitizeCategorySlug(firstToken);
      if (slug && slug !== "auto") {
        return {
          category: slug,
          autoClassified: true,
          isNewCategory: !existingSet.has(slug),
        };
      }
    } catch {
      // Probar siguiente modelo
    }
  }

  return {
    category: "general",
    autoClassified: true,
    isNewCategory: false,
  };
}

export interface RetrievedChunk {
  id: string;
  document_title: string;
  category: string;
  content: string;
  score: number;
}

const URL_EXTRACT_REGEX = /https?:\/\/[^\s)\]`"'<>]+/gi;

function cleanExtractedUrl(rawUrl: string): string {
  return rawUrl.replace(/[.,;:!?)+]+$/, "");
}

function isSpecificReferenceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "");
    if (
      !path &&
      (host === "ingresarios.com" ||
        host === "ingresarios.net" ||
        host === "ingresarios.ai")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractReferenceUrls(text: string): string[] {
  const matches = text.match(URL_EXTRACT_REGEX) || [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const m of matches) {
    const cleaned = cleanExtractedUrl(m);
    if (cleaned && isSpecificReferenceUrl(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }
  return urls;
}

function chunkPlainBlock(
  text: string,
  maxChars: number,
  overlapChars: number
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const safeMax = Math.max(600, maxChars);
  const safeOverlap = Math.min(overlapChars, Math.floor(safeMax / 4));

  if (trimmed.length <= safeMax) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current ? `${current}\n\n${para}` : para).length <= safeMax) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) {
        chunks.push(current.trim());
        const tail = current.slice(-safeOverlap);
        const candidate = `${tail}\n\n${para}`;
        if (candidate.length <= safeMax) {
          current = candidate;
          continue;
        }
        current = "";
      }

      if (para.length <= safeMax) {
        current = para;
      } else {
        const step = safeMax - safeOverlap;
        for (let i = 0; i < para.length; i += step) {
          chunks.push(para.slice(i, i + safeMax).trim());
        }
        current = "";
      }
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function splitIntoChunks(
  rawText: string,
  maxChars = 2200,
  overlapChars = 300
): string[] {
  // Quitar backticks alrededor de URLs para que el índice y los bots entreguen links clicables limpios
  const normalized = rawText
    .replace(/\r\n/g, "\n")
    .replace(/`(https?:\/\/[^\s`]+)`/gi, "$1")
    .trim();
  if (!normalized) return [];

  const rawBlocks = normalized
    .split(/(?:\n+---\s*)?\n+(?=##\s+)/)
    .map((b) => b.trim())
    .filter(Boolean);

  // Si no hay encabezados ##, usar partición clásica preservando enlaces iniciales en guías cortas
  if (rawBlocks.length <= 1) {
    const plainChunks = chunkPlainBlock(normalized, maxChars, overlapChars);
    if (plainChunks.length <= 1 || normalized.length > 25000) {
      return plainChunks;
    }
    const headerUrls = extractReferenceUrls(normalized.slice(0, 900)).slice(0, 2);
    if (headerUrls.length === 0) return plainChunks;

    return plainChunks.map((chunk, idx) => {
      if (idx === 0 || headerUrls.every((u) => chunk.includes(u))) return chunk;
      return `[Enlace de repetición/referencia: ${headerUrls.join(" | ")}]\n\n${chunk}`;
    });
  }

  // Si el primer bloque es solo un título corto (# Título + periodo) sin URLs propias, unirlo a la primera sección
  const blocks = [...rawBlocks];
  if (
    blocks.length >= 2 &&
    !blocks[0].startsWith("## ") &&
    blocks[0].length < 420 &&
    extractReferenceUrls(blocks[0]).length === 0
  ) {
    blocks[1] = `${blocks[0]}\n\n---\n\n${blocks[1]}`;
    blocks.shift();
  }

  const blockInfos = blocks.map((block) => {
    const headingMatch = block.match(/(?:^|\n)##\s+([^\n]+)/);
    const headingTitle = headingMatch
      ? headingMatch[1].replace(/[*_`#]+/g, "").trim().slice(0, 120)
      : "";
    const topUrls = extractReferenceUrls(block.slice(0, 1000));
    const allUrls = topUrls.length > 0 ? topUrls : extractReferenceUrls(block);
    const sectionUrls = allUrls.slice(0, 2);
    return { block, headingTitle, sectionUrls };
  });

  const blocksWithUrls = blockInfos.filter((b) => b.sectionUrls.length > 0);
  // Si es una guía técnica corta de un solo tema (ej. un indicador) donde solo la ficha inicial trae el link oficial
  const docLevelUrls =
    blocksWithUrls.length === 1 && normalized.length <= 25000
      ? blocksWithUrls[0].sectionUrls
      : [];

  const finalChunks: string[] = [];
  let pendingSmallBuffer = "";

  const flushPendingBuffer = () => {
    if (!pendingSmallBuffer.trim()) return;
    finalChunks.push(
      ...chunkPlainBlock(pendingSmallBuffer, maxChars, overlapChars)
    );
    pendingSmallBuffer = "";
  };

  for (const info of blockInfos) {
    const effectiveUrls =
      info.sectionUrls.length > 0 ? info.sectionUrls : docLevelUrls;
    const shouldIsolateSection =
      effectiveUrls.length > 0 || info.block.length >= 600;

    if (!shouldIsolateSection) {
      const candidate = pendingSmallBuffer
        ? `${pendingSmallBuffer}\n\n${info.block}`
        : info.block;
      if (candidate.length <= maxChars) {
        pendingSmallBuffer = candidate;
      } else {
        flushPendingBuffer();
        pendingSmallBuffer = info.block;
      }
      continue;
    }

    flushPendingBuffer();

    const contextParts: string[] = [];
    if (info.headingTitle) {
      contextParts.push(`Sesión / Sección: ${info.headingTitle}`);
    }
    if (effectiveUrls.length > 0) {
      contextParts.push(
        `Enlace de repetición/referencia: ${effectiveUrls.join(" | ")}`
      );
    }
    const contextPrefix =
      contextParts.length > 0 ? `[${contextParts.join(" | ")}]\n\n` : "";

    const bodyBudget = Math.max(700, maxChars - contextPrefix.length);
    const subChunks = chunkPlainBlock(info.block, bodyBudget, overlapChars);

    for (let idx = 0; idx < subChunks.length; idx++) {
      const sub = subChunks[idx];
      if (idx === 0) {
        const missingUrls = effectiveUrls.filter((u) => !sub.includes(u));
        if (missingUrls.length > 0) {
          finalChunks.push(
            `[Enlace de repetición/referencia: ${missingUrls.join(" | ")}]\n\n${sub}`
          );
        } else {
          finalChunks.push(sub);
        }
      } else if (contextPrefix) {
        finalChunks.push(`${contextPrefix}${sub}`);
      } else {
        finalChunks.push(sub);
      }
    }
  }

  flushPendingBuffer();
  return finalChunks;
}

export async function generateEmbedding768(
  text: string
): Promise<number[] | null> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: text.slice(0, 8000) }] },
          outputDimensionality: 768,
        }),
      }
    );

    if (!res.ok) return null;
    const json = (await res.json()) as {
      embedding?: { values?: number[] };
    };
    const values = json.embedding?.values;
    return Array.isArray(values) && values.length === 768 ? values : null;
  } catch {
    return null;
  }
}

export async function generateEmbeddingsBatch768(
  texts: string[]
): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return texts.map(() => null);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: texts.map((text) => ({
            model: "models/gemini-embedding-001",
            content: { parts: [{ text: text.slice(0, 8000) }] },
            outputDimensionality: 768,
          })),
        }),
      }
    );

    if (res.ok) {
      const json = (await res.json()) as {
        embeddings?: Array<{ values?: number[] }>;
      };
      if (
        Array.isArray(json.embeddings) &&
        json.embeddings.length === texts.length
      ) {
        return json.embeddings.map((e) =>
          Array.isArray(e?.values) && e.values.length === 768 ? e.values : null
        );
      }
    }
  } catch {
    // Fallback paralelo individual abajo
  }

  return Promise.all(texts.map((t) => generateEmbedding768(t)));
}

export async function indexKnowledgeDocument(params: {
  documentId: string;
  title: string;
  category: string;
  rawContent: string;
}): Promise<{ chunksIndexed: number }> {
  const supabase = getSupabaseAdmin();
  const chunks = splitIntoChunks(params.rawContent);

  await supabase
    .from("geny_knowledge_chunks")
    .delete()
    .eq("document_id", params.documentId);

  const rows: Array<{
    document_id: string;
    document_title: string;
    category: string;
    chunk_index: number;
    content: string;
    embedding: number[] | null;
  }> = [];

  const BATCH_SIZE = 75;
  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const slice = chunks.slice(start, start + BATCH_SIZE);
    const embeddings = await generateEmbeddingsBatch768(
      slice.map((chunk) => `${params.title}\n${chunk}`)
    );
    for (let j = 0; j < slice.length; j++) {
      rows.push({
        document_id: params.documentId,
        document_title: params.title,
        category: params.category,
        chunk_index: start + j,
        content: slice[j],
        embedding: embeddings[j],
      });
    }
  }

  const INSERT_BATCH = 100;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from("geny_knowledge_chunks").insert(batch);
    if (error) {
      throw new Error(`Error indexando fragmentos: ${error.message}`);
    }
  }

  await supabase
    .from("geny_knowledge_documents")
    .update({
      chunks_count: rows.length,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.documentId);

  await logRagUsageEvent({
    operationType: "rag_embed_768d",
    modelUsed: "gemini-embedding-001",
    label: params.title,
    embeddingChars: params.rawContent.length,
  });

  return { chunksIndexed: rows.length };
}

export async function searchKnowledgeContext(
  queryText: string,
  limit = 4
): Promise<RetrievedChunk[]> {
  const cleanQuery = queryText.trim();
  if (!cleanQuery) return [];

  const supabase = getSupabaseAdmin();
  const queryEmbedding = await generateEmbedding768(cleanQuery);

  const { data, error } = await supabase.rpc("search_geny_knowledge", {
    query_text: cleanQuery,
    query_embedding: queryEmbedding,
    match_count: limit,
  });

  if (error || !Array.isArray(data)) {
    return [];
  }

  return data as RetrievedChunk[];
}

