import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { indexKnowledgeDocument } from "@/lib/geny/rag";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("geny_knowledge_documents")
    .select("id, title, category, raw_content, source_url, chunks_count, updated_at")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Documento no encontrado" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, document: data });
}

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    documentId?: string;
    title?: string;
    category?: string;
    rawContent?: string;
  };

  if (!body.title?.trim() || !body.rawContent?.trim()) {
    return NextResponse.json(
      { error: "Título y contenido son obligatorios." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const category = (body.category || "general").trim().toLowerCase();

  if (!category) {
    return NextResponse.json(
      { error: "Ingresa o selecciona una categoría metodológica válida." },
      { status: 400 }
    );
  }

  const { data: doc, error } = body.documentId
    ? await supabase
        .from("geny_knowledge_documents")
        .update({
          title: body.title.trim(),
          category,
          raw_content: body.rawContent.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.documentId)
        .select("id, title, category")
        .single()
    : await supabase
        .from("geny_knowledge_documents")
        .insert({
          title: body.title.trim(),
          category,
          raw_content: body.rawContent.trim(),
          is_active: true,
        })
        .select("id, title, category")
        .single();

  if (error || !doc) {
    return NextResponse.json(
      { error: error?.message || "No se pudo guardar documento." },
      { status: 400 }
    );
  }

  const { chunksIndexed } = await indexKnowledgeDocument({
    documentId: doc.id,
    title: doc.title,
    category: doc.category,
    rawContent: body.rawContent.trim(),
  });

  return NextResponse.json({ ok: true, document: doc, chunksIndexed });
}

export async function DELETE(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Falta id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("geny_knowledge_documents")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

