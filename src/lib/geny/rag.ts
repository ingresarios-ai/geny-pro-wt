import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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
        maxTokens: 32,
        temperature: 0,
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

export function splitIntoChunks(
  rawText: string,
  maxChars = 2200,
  overlapChars = 300
): string[] {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length <= maxChars) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) {
        chunks.push(current.trim());
        const tail = current.slice(-overlapChars);
        current = `${tail}\n\n${para}`.slice(0, maxChars);
      } else {
        // Párrafo muy largo: cortar por tamaño fijo
        for (let i = 0; i < para.length; i += maxChars - overlapChars) {
          chunks.push(para.slice(i, i + maxChars).trim());
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

  const BATCH_SIZE = 8;
  for (let start = 0; start < chunks.length; start += BATCH_SIZE) {
    const slice = chunks.slice(start, start + BATCH_SIZE);
    const embeddings = await Promise.all(
      slice.map((chunk) => generateEmbedding768(`${params.title}\n${chunk}`))
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

  if (rows.length > 0) {
    const { error } = await supabase.from("geny_knowledge_chunks").insert(rows);
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

