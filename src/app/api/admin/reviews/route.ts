import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import { getGenySettings, getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.get("export") === "jsonl") {
    const supabase = getSupabaseAdmin();
    const settings = await getGenySettings();
    const { data: goldRows } = await supabase
      .from("geny_messages")
      .select("user_message, assistant_response, mentor_ideal_response")
      .eq("is_gold_dataset", true)
      .order("created_at", { ascending: true });

    const lines = (goldRows || []).map((row) =>
      JSON.stringify({
        messages: [
          { role: "system", content: settings.system_prompt_compliant },
          { role: "user", content: row.user_message },
          {
            role: "assistant",
            content: row.mentor_ideal_response?.trim()
              ? row.mentor_ideal_response.trim()
              : row.assistant_response,
          },
        ],
      })
    );

    return new NextResponse(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": 'attachment; filename="geny_pro_dataset_gold.jsonl"',
      },
    });
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    messageId: string;
    markReviewed?: boolean;
    reviewedBy?: string;
    is_gold_dataset?: boolean;
    mentor_ideal_response?: string | null;
  };

  if (!body.messageId) {
    return NextResponse.json({ error: "Falta messageId" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const updates: Record<string, unknown> = {};

  if (body.markReviewed) {
    updates.reviewed_at = new Date().toISOString();
    updates.reviewed_by = body.reviewedBy || "Admin";
  }
  if (body.is_gold_dataset !== undefined) {
    updates.is_gold_dataset = body.is_gold_dataset;
  }
  if (body.mentor_ideal_response !== undefined) {
    updates.mentor_ideal_response = body.mentor_ideal_response;
  }

  const { error } = await supabase
    .from("geny_messages")
    .update(updates)
    .eq("id", body.messageId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

