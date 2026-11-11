import { getSupabaseAdmin } from "@/lib/supabase/admin";

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

  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding768(
      `${params.title}\n${chunks[i]}`
    );
    rows.push({
      document_id: params.documentId,
      document_title: params.title,
      category: params.category,
      chunk_index: i,
      content: chunks[i],
      embedding,
    });
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

