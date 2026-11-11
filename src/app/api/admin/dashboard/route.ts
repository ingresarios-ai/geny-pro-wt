import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import {
  getEffectiveSecretsMap,
  getGenySettings,
  getSupabaseAdmin,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    const envStatus = {
      supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      supabaseServiceRole: isSupabaseAdminConfigured(),
      geminiKey: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
      claudeKey: Boolean(process.env.ANTHROPIC_API_KEY),
      whisperKey: Boolean(
        process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY
      ),
      telegramBot: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      whatsappCloud: Boolean(
        process.env.WHATSAPP_PHONE_NUMBER_ID &&
          process.env.WHATSAPP_ACCESS_TOKEN
      ),
      resendKey: Boolean(process.env.RESEND_API_KEY),
    };

    return NextResponse.json({
      configured: false,
      envStatus,
      secretsMeta: getEffectiveSecretsMap(null),
      users: [],
      deviceHistory: [],
      knowledgeDocs: [],
      reviewMessages: [],
      settings: null,
      stats: {
        totalUsers: 0,
        activeUsers: 0,
        suspendedUsers: 0,
        pendingReviews: 0,
        goldExamples: 0,
        messagesToday: 0,
      },
    });
  }

  const supabase = getSupabaseAdmin();
  const startOfDayIso = new Date(
    new Date().setUTCHours(0, 0, 0, 0)
  ).toISOString();

  const [
    settings,
    usersRes,
    historyRes,
    docsRes,
    reviewsRes,
    msgTodayRes,
    goldCountRes,
  ] = await Promise.all([
    getGenySettings(),
    supabase
      .from("geny_users")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(250),
    supabase
      .from("geny_device_history")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("geny_knowledge_documents")
      .select("id, title, category, source_url, is_active, chunks_count, updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false }),
    supabase
      .from("geny_messages")
      .select("*, geny_users(email, full_name)")
      .or("needs_human_review.eq.true,is_gold_dataset.eq.true")
      .order("created_at", { ascending: false })
      .limit(80),
    supabase
      .from("geny_messages")
      .select("id", { count: "exact", head: true })
      .gte("created_at", startOfDayIso),
    supabase
      .from("geny_messages")
      .select("id", { count: "exact", head: true })
      .eq("is_gold_dataset", true),
  ]);

  const secretsMeta = getEffectiveSecretsMap(settings.runtime_secrets);
  const envStatus = {
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseServiceRole: isSupabaseAdminConfigured(),
    geminiKey: secretsMeta.GOOGLE_GENERATIVE_AI_API_KEY.hasValue,
    claudeKey: secretsMeta.ANTHROPIC_API_KEY.hasValue,
    whisperKey:
      secretsMeta.GROQ_API_KEY.hasValue || secretsMeta.OPENAI_API_KEY.hasValue,
    telegramBot: secretsMeta.TELEGRAM_BOT_TOKEN.hasValue,
    whatsappCloud:
      secretsMeta.WHATSAPP_PHONE_NUMBER_ID.hasValue &&
      secretsMeta.WHATSAPP_ACCESS_TOKEN.hasValue,
    resendKey: secretsMeta.RESEND_API_KEY.hasValue,
  };

  const users = usersRes.data || [];
  const activeUsers = users.filter((u) => u.membership_status === "active").length;
  const suspendedUsers = users.filter(
    (u) => u.membership_status === "suspended"
  ).length;
  const pendingReviews = (reviewsRes.data || []).filter(
    (m) => m.needs_human_review && !m.reviewed_at
  ).length;

  return NextResponse.json({
    configured: true,
    envStatus,
    secretsMeta,
    settings,
    users,
    deviceHistory: historyRes.data || [],
    knowledgeDocs: docsRes.data || [],
    reviewMessages: reviewsRes.data || [],
    stats: {
      totalUsers: users.length,
      activeUsers,
      suspendedUsers,
      pendingReviews,
      goldExamples: goldCountRes.count ?? 0,
      messagesToday: msgTodayRes.count ?? 0,
    },
  });
}

