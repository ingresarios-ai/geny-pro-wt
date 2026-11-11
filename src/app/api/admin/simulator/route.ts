import { NextRequest, NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import {
  getGenySettings,
  getSupabaseAdmin,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import {
  normalizePhoneE164,
  verifyMemberAndDeviceGate,
} from "@/lib/auth/device-gate";
import { runGenyBrain } from "@/lib/geny/brain";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json(
      {
        error:
          "Configura primero SUPABASE_SERVICE_ROLE_KEY en .env.local y reinicia o guarda para usar el simulador contra la base real.",
      },
      { status: 400 }
    );
  }

  const formData = await req.formData();
  const channelRaw = String(formData.get("channel") || "whatsapp");
  const channel: "whatsapp" | "telegram" =
    channelRaw === "telegram" ? "telegram" : "whatsapp";
  const senderIdentifier = String(formData.get("senderIdentifier") || "").trim();
  const text = String(formData.get("text") || "").trim();
  const imageFile = formData.get("image") as File | null;

  if (!senderIdentifier) {
    return NextResponse.json(
      { error: "Ingresa un número de teléfono o ID de Telegram simulado." },
      { status: 400 }
    );
  }

  const settings = await getGenySettings();
  const gate = await verifyMemberAndDeviceGate({
    channel,
    senderIdentifier,
    senderUsername: channel === "telegram" ? "alumno_demo" : null,
    incomingText: text,
    settings,
  });

  // En el simulador de Admin mostramos el estado del envío OTP para facilitar pruebas
  let devOtpHint: string | null = null;
  if (!gate.allowed) {
    const supabase = getSupabaseAdmin();
    const normalizedId =
      channel === "whatsapp"
        ? normalizePhoneE164(senderIdentifier)
        : senderIdentifier;
    const { data: pendingSession } = await supabase
      .from("geny_auth_sessions")
      .select("step, otp_code, candidate_email")
      .eq("channel", channel)
      .eq("sender_identifier", normalizedId)
      .maybeSingle();

    if (pendingSession?.step === "awaiting_otp" && pendingSession.otp_code) {
      devOtpHint = process.env.RESEND_API_KEY
        ? `Resend activo: se despachó el correo a ${pendingSession.candidate_email} (código de respaldo Admin: ${pendingSession.otp_code})`
        : `Modo local sin RESEND_API_KEY: el código OTP generado para ${pendingSession.candidate_email} es ${pendingSession.otp_code}`;
    }
  }

  if (!gate.allowed) {
    return NextResponse.json({
      allowed: false,
      aiInvoked: false,
      replyText: gate.replyText,
      devOtpHint,
    });
  }

  const hasGemini = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);

  if (
    (settings.active_provider === "gemini" && !hasGemini) ||
    (settings.active_provider === "claude" && !hasClaude)
  ) {
    return NextResponse.json({
      allowed: true,
      aiInvoked: false,
      replyText:
        `[Candado superado: el alumno ${gate.user.email} está ACTIVO y verificado en este dispositivo].\n\n` +
        `Para generar la respuesta real de GENY PRO con ${settings.active_provider.toUpperCase()}, agrega tu API key (${settings.active_provider === "gemini" ? "GOOGLE_GENERATIVE_AI_API_KEY" : "ANTHROPIC_API_KEY"}) en .env.local.`,
    });
  }

  let inputType: "text" | "image" = "text";
  let mediaBuffer: Buffer | undefined;
  let mediaMimeType: string | undefined;

  if (imageFile && imageFile.size > 0) {
    inputType = "image";
    const arr = await imageFile.arrayBuffer();
    mediaBuffer = Buffer.from(arr);
    mediaMimeType = imageFile.type || "image/png";
  }

  try {
    const brainRes = await runGenyBrain({
      user: gate.user,
      settings,
      channel,
      inputType,
      text,
      mediaBuffer,
      mediaMimeType,
    });

    return NextResponse.json({
      allowed: true,
      aiInvoked: true,
      providerUsed: brainRes.providerUsed,
      modelUsed: brainRes.modelUsed,
      needsHumanReview: brainRes.needsHumanReview,
      replyText: brainRes.replyText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Error al invocar el motor de IA (${settings.active_provider}): ${message}`,
      },
      { status: 500 }
    );
  }
}

