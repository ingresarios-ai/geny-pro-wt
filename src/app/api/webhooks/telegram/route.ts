import { NextRequest, NextResponse, after } from "next/server";
import {
  claimWebhookIdempotency,
  getGenySettings,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";
import { verifyMemberAndDeviceGate } from "@/lib/auth/device-gate";
import {
  downloadTelegramFile,
  isTelegramUserInWhopGroup,
  sendTelegramMessage,
  sendTelegramTyping,
} from "@/lib/channels/telegram";
import { runGenyBrain } from "@/lib/geny/brain";

export const maxDuration = 60;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    caption?: string;
    voice?: { file_id: string; mime_type?: string };
    audio?: { file_id: string; mime_type?: string };
    photo?: Array<{ file_id: string; width: number; height: number }>;
  };
}

export async function POST(req: NextRequest) {
  if (!isSupabaseAdminConfigured()) {
    return NextResponse.json({ ok: true, skipped: "supabase_not_configured" });
  }

  await getGenySettings();

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expectedSecret) {
    const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (incomingSecret !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const update = (await req.json()) as TelegramUpdate;
  const msg = update.message;

  // Solo atendemos conversaciones 1 a 1 (chat privado) para proteger privacidad del alumno
  if (!msg || msg.chat.type !== "private" || !msg.from) {
    return NextResponse.json({ ok: true });
  }

  const eventKey = `tg:${update.update_id}`;
  const isFirstTime = await claimWebhookIdempotency(eventKey, "telegram");
  if (!isFirstTime) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // Responder 200 OK de inmediato y ejecutar IA asíncronamente en Vercel Fluid Compute
  after(async () => {
    try {
      const chatId = msg.chat.id;
      const senderId = String(msg.from!.id);
      const settings = await getGenySettings();

      const rawText = (msg.text || msg.caption || "").trim();

      if (rawText === "/start") {
        // Dejar que el gate guíe la bienvenida o reconozca si ya está vinculado
      }

      const gate = await verifyMemberAndDeviceGate({
        channel: "telegram",
        senderIdentifier: senderId,
        senderUsername: msg.from?.username ?? null,
        incomingText: rawText === "/start" ? "" : rawText,
        settings,
      });

      if (!gate.allowed) {
        await sendTelegramMessage(chatId, gate.replyText);
        return;
      }

      // Candado adicional opcional: si hay grupo del reto Whop configurado, validar membresía en vivo
      if (settings.whop_telegram_group_id) {
        const inWhopGroup = await isTelegramUserInWhopGroup(
          settings.whop_telegram_group_id,
          senderId
        );
        if (
          !inWhopGroup &&
          gate.user.billing_source === "whop" &&
          gate.user.plan_tier !== "vip" &&
          gate.user.plan_tier !== "equipo"
        ) {
          await sendTelegramMessage(
            chatId,
            `Tu usuario ya no aparece dentro del grupo activo del reto en Telegram. Verifica tu suscripción en Whop aquí:\n${settings.payment_checkout_url}`
          );
          return;
        }
      }

      if (rawText === "/start") {
        await sendTelegramMessage(
          chatId,
          `¡Hola${gate.user.full_name ? ` ${gate.user.full_name.split(" ")[0]}` : ""}! 💜 Qué alegría verte por aquí.\n\n` +
            `Puedes escribirme tus dudas de trading, enviarme una nota de voz contando cómo te sentiste en tu sesión o compartirme una foto de tu gráfico para estudiarlo juntos.`
        );
        return;
      }

      await sendTelegramTyping(chatId);

      let inputType: "text" | "audio" | "image" = "text";
      let mediaBuffer: Buffer | undefined;
      let mediaMimeType: string | undefined;

      if (msg.voice || msg.audio) {
        inputType = "audio";
        const fileId = (msg.voice || msg.audio)!.file_id;
        const downloaded = await downloadTelegramFile(fileId);
        mediaBuffer = downloaded.buffer;
        mediaMimeType = msg.voice?.mime_type || msg.audio?.mime_type || "audio/ogg";
      } else if (msg.photo && msg.photo.length > 0) {
        inputType = "image";
        const largestPhoto = msg.photo[msg.photo.length - 1];
        const downloaded = await downloadTelegramFile(largestPhoto.file_id);
        mediaBuffer = downloaded.buffer;
        mediaMimeType = "image/jpeg";
      }

      const result = await runGenyBrain({
        user: gate.user,
        settings,
        channel: "telegram",
        inputType,
        text: rawText,
        mediaBuffer,
        mediaMimeType,
      });

      await sendTelegramMessage(chatId, result.replyText);
    } catch (err) {
      console.error("[TELEGRAM WEBHOOK ERROR]", err);
    }
  });

  return NextResponse.json({ ok: true });
}

