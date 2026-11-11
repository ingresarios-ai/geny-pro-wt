import crypto from "crypto";
import {
  GenySettings,
  GenyUser,
  getSupabaseAdmin,
} from "@/lib/supabase/admin";
import { sendVerificationOtpEmail } from "@/lib/auth/email-otp";

export type GateResult =
  | { allowed: true; user: GenyUser; justActivatedMessage?: string }
  | { allowed: false; replyText: string; silentDrop?: boolean };

export function normalizePhoneE164(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : raw.trim();
}

function maskIdentifier(channel: "telegram" | "whatsapp", id: string): string {
  if (id.length <= 4) return "••••";
  const tail = id.slice(-4);
  return channel === "whatsapp" ? `+••• ••• ${tail}` : `ID ••••${tail}`;
}

function isEmailFormat(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}

function checkActiveMembership(
  user: GenyUser,
  settings: GenySettings
): { ok: true } | { ok: false; replyText: string; silentDrop?: boolean } {
  const namePrefix = user.full_name ? `Hola ${user.full_name.split(" ")[0]}` : "Hola";

  if (user.membership_status === "suspended") {
    return {
      ok: false,
      replyText:
        `Tu acceso a GENY PRO se encuentra suspendido temporalmente. ` +
        `Si consideras que es un error, escríbenos a soporte: ${settings.human_support_url}`,
    };
  }

  const isExpiredByDate =
    user.expires_at !== null && new Date(user.expires_at).getTime() < Date.now();

  if (
    user.membership_status === "past_due" ||
    user.membership_status === "canceled" ||
    isExpiredByDate
  ) {
    return {
      ok: false,
      replyText:
        `${namePrefix}, veo que tu membresía en INGRESARIOS no se encuentra activa o tiene un pago pendiente.\n\n` +
        `Puedes actualizar o reactivar tu acceso aquí para que retomemos tu proceso:\n${settings.payment_checkout_url}`,
    };
  }

  return { ok: true };
}

/**
 * Evalúa identidad, estado de pago, límite diario y el Candado Anti-Piratería
 * (1 Membresía = 1 Telegram + 1 WhatsApp, con opción de autotransferencia 1 vez cada 90 días
 * respaldando el dispositivo anterior en geny_device_history y bloqueándolo al instante).
 */
export async function verifyMemberAndDeviceGate(params: {
  channel: "telegram" | "whatsapp";
  senderIdentifier: string;
  senderUsername?: string | null;
  incomingText: string;
  settings: GenySettings;
}): Promise<GateResult> {
  const supabase = getSupabaseAdmin();
  const { channel, incomingText, settings } = params;
  const senderId =
    channel === "whatsapp"
      ? normalizePhoneE164(params.senderIdentifier)
      : params.senderIdentifier.trim();

  const columnId = channel === "whatsapp" ? "whatsapp_phone" : "telegram_id";
  const columnBoundAt = channel === "whatsapp" ? "whatsapp_bound_at" : "telegram_bound_at";
  const columnLastSwap =
    channel === "whatsapp" ? "whatsapp_last_swap_at" : "telegram_last_swap_at";

  // 1. ¿El dispositivo actual YA está vinculado a un usuario?
  const { data: boundUser } = await supabase
    .from("geny_users")
    .select("*")
    .eq(columnId, senderId)
    .maybeSingle<GenyUser>();

  if (boundUser) {
    const statusCheck = checkActiveMembership(boundUser, settings);
    if (!statusCheck.ok) {
      return { allowed: false, replyText: statusCheck.replyText };
    }

    // Verificar límite diario de mensajes anti-abuso
    const maxDaily = boundUser.daily_message_override ?? settings.daily_message_limit;
    const startOfDayIso = new Date(
      new Date().setUTCHours(0, 0, 0, 0)
    ).toISOString();

    const { count } = await supabase
      .from("geny_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", boundUser.id)
      .gte("created_at", startOfDayIso);

    if ((count ?? 0) >= maxDaily) {
      return {
        allowed: false,
        replyText:
          `Has alcanzado tu límite diario de ${maxDaily} mensajes por hoy para cuidar la calidad de tu estudio. ` +
          `¡Descansa, repasa tu bitácora y mañana seguimos entrenando! 💜`,
      };
    }

    return { allowed: true, user: boundUser };
  }

  // 2. No está vinculado actualmente: revisar si hay una sesión de autenticación/cambio en curso
  const cleanText = incomingText.trim();

  const { data: session } = await supabase
    .from("geny_auth_sessions")
    .select("*")
    .eq("channel", channel)
    .eq("sender_identifier", senderId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  // --- PASO A: El usuario está confirmando el CAMBIO DE DISPOSITIVO (SI / NO) ---
  if (session && session.step === "awaiting_swap_confirm" && session.target_user_id) {
    const normalizedAnswer = cleanText
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (["no", "cancelar", "cancel"].includes(normalizedAnswer)) {
      await supabase.from("geny_auth_sessions").delete().eq("id", session.id);
      return {
        allowed: false,
        replyText:
          "Operación cancelada. Tu sesión permanece activa en tu dispositivo anterior.",
      };
    }

    if (
      ["si", "cambiar", "confirmar", "transferir", "acepto"].includes(
        normalizedAnswer
      )
    ) {
      const { data: targetUser } = await supabase
        .from("geny_users")
        .select("*")
        .eq("id", session.target_user_id)
        .single<GenyUser>();

      if (!targetUser) {
        await supabase.from("geny_auth_sessions").delete().eq("id", session.id);
        return {
          allowed: false,
          replyText: "No pudimos encontrar tu cuenta. Escribe tu correo nuevamente.",
        };
      }

      const previousIdentifier =
        channel === "whatsapp" ? targetUser.whatsapp_phone : targetUser.telegram_id;
      const nowIso = new Date().toISOString();

      // 1) Guardar el teléfono/ID anterior como respaldo y auditoría con estado 'revoked'
      await supabase.from("geny_device_history").insert({
        user_id: targetUser.id,
        channel,
        previous_identifier: previousIdentifier,
        new_identifier: senderId,
        action_type: "user_self_swap",
        previous_status: "revoked",
        reason: `Autotransferencia confirmada por OTP (bloqueo de ${settings.device_swap_cooldown_days} días activado)`,
        metadata: {
          sender_username: params.senderUsername ?? null,
          cooldown_days: settings.device_swap_cooldown_days,
        },
      });

      // 2) Actualizar al nuevo dispositivo, bloquear implícitamente el anterior y sellar fecha de cambio
      const updatePayload: Record<string, unknown> = {
        [columnId]: senderId,
        [columnBoundAt]: nowIso,
        [columnLastSwap]: nowIso,
        updated_at: nowIso,
      };
      if (channel === "telegram" && params.senderUsername) {
        updatePayload.telegram_username = params.senderUsername;
      }

      const { data: updatedUser, error: updateErr } = await supabase
        .from("geny_users")
        .update(updatePayload)
        .eq("id", targetUser.id)
        .select("*")
        .single<GenyUser>();

      await supabase.from("geny_auth_sessions").delete().eq("id", session.id);

      if (updateErr || !updatedUser) {
        return {
          allowed: false,
          replyText:
            "Ocurrió un error al actualizar tu dispositivo. Por favor contacta a soporte: " +
            settings.human_support_url,
        };
      }

      return {
        allowed: false,
        replyText:
          `✅ ¡Listo${updatedUser.full_name ? `, ${updatedUser.full_name.split(" ")[0]}` : ""}! Tu sesión fue transferida exitosamente a este dispositivo.\n\n` +
          `• El dispositivo anterior (${maskIdentifier(channel, previousIdentifier || "")}) ha quedado **bloqueado** y registrado en respaldo.\n` +
          `• Recuerda que el próximo cambio de dispositivo estará disponible en **${settings.device_swap_cooldown_days} días**.\n\n` +
          `Cuéntame, ¿en qué trabajamos hoy? ¡Yo honro tu proceso! 💜`,
      };
    }

    return {
      allowed: false,
      replyText:
        `Por favor responde **SI** para confirmar el cambio de sesión a este dispositivo (bloqueando el anterior por ${settings.device_swap_cooldown_days} días) o **NO** para cancelar.`,
    };
  }

  // --- PASO B: El usuario está ingresando su código OTP de 6 dígitos ---
  if (session && session.step === "awaiting_otp" && session.target_user_id) {
    // Si escribió otro correo por equivocación, permitir reiniciar flujo abajo
    if (!isEmailFormat(cleanText)) {
      const digitsOnly = cleanText.replace(/\s+/g, "");
      if (!/^\d{6}$/.test(digitsOnly)) {
        return {
          allowed: false,
          replyText:
            `Ingresa el código de **6 dígitos** que enviamos a **${session.candidate_email}** (o vuelve a escribir tu correo si te equivocaste).`,
        };
      }

      if (digitsOnly !== session.otp_code) {
        const nextAttempts = (session.attempts ?? 0) + 1;
        if (nextAttempts >= 5) {
          await supabase.from("geny_auth_sessions").delete().eq("id", session.id);
          return {
            allowed: false,
            replyText:
              "Demasiados intentos incorrectos. Escribe tu correo nuevamente para generar un código nuevo.",
          };
        }
        await supabase
          .from("geny_auth_sessions")
          .update({ attempts: nextAttempts })
          .eq("id", session.id);
        return {
          allowed: false,
          replyText: `Código incorrecto (intento ${nextAttempts}/5). Verifica tu correo e inténtalo de nuevo.`,
        };
      }

      // ¡OTP válido! Revisar si la cuenta ya tiene otro dispositivo en este canal
      const { data: targetUser } = await supabase
        .from("geny_users")
        .select("*")
        .eq("id", session.target_user_id)
        .single<GenyUser>();

      if (!targetUser) {
        await supabase.from("geny_auth_sessions").delete().eq("id", session.id);
        return {
          allowed: false,
          replyText: "Cuenta no encontrada. Escribe tu correo nuevamente.",
        };
      }

      const existingIdentifier =
        channel === "whatsapp" ? targetUser.whatsapp_phone : targetUser.telegram_id;
      const lastSwapAt =
        channel === "whatsapp"
          ? targetUser.whatsapp_last_swap_at
          : targetUser.telegram_last_swap_at;

      // CASO 1: Primer dispositivo vinculado en este canal -> activar de inmediato
      if (!existingIdentifier || existingIdentifier === senderId) {
        const nowIso = new Date().toISOString();
        await supabase.from("geny_device_history").insert({
          user_id: targetUser.id,
          channel,
          previous_identifier: null,
          new_identifier: senderId,
          action_type: "initial_bind",
          previous_status: "archived",
          reason: "Vinculación inicial verificada con OTP por correo",
        });

        await supabase
          .from("geny_users")
          .update({
            [columnId]: senderId,
            [columnBoundAt]: nowIso,
            ...(channel === "telegram" && params.senderUsername
              ? { telegram_username: params.senderUsername }
              : {}),
            updated_at: nowIso,
          })
          .eq("id", targetUser.id);

        await supabase.from("geny_auth_sessions").delete().eq("id", session.id);

        return {
          allowed: false,
          replyText:
            `🎉 ¡Bienvenid@${targetUser.full_name ? ` ${targetUser.full_name.split(" ")[0]}` : ""}! Tu membresía quedó verificada y vinculada a este dispositivo.\n\n` +
            `Ya puedes escribirme tus dudas de trading, enviarme notas de voz sobre tu sesión o fotos de tus gráficos para revisarlos juntos.\n\n¡Yo honro tu proceso! 💜`,
        };
      }

      // CASO 2: Ya existe OTRO número/dispositivo registrado -> evaluar regla de 90 días (3 meses)
      const cooldownDays = settings.device_swap_cooldown_days;
      if (lastSwapAt && cooldownDays > 0) {
        const msSinceLastSwap = Date.now() - new Date(lastSwapAt).getTime();
        const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
        if (msSinceLastSwap < cooldownMs) {
          const daysRemaining = Math.ceil(
            (cooldownMs - msSinceLastSwap) / (24 * 60 * 60 * 1000)
          );
          const availableDate = new Date(
            new Date(lastSwapAt).getTime() + cooldownMs
          ).toLocaleDateString("es-CO", {
            day: "numeric",
            month: "long",
            year: "numeric",
          });

          await supabase.from("geny_auth_sessions").delete().eq("id", session.id);

          return {
            allowed: false,
            replyText:
              `⚠️ Esta cuenta ya se encuentra activa en otro dispositivo (${maskIdentifier(channel, existingIdentifier)}) y ya utilizó su cambio permitido recientemente.\n\n` +
              `Por seguridad anti-uso compartido, solo se permite **1 cambio de dispositivo cada ${cooldownDays} días** (disponible nuevamente el **${availableDate}**, en ${daysRemaining} días).\n\n` +
              `Si extraviaste tu teléfono o tuviste una emergencia, solicita apoyo a nuestro equipo aquí: ${settings.human_support_url}`,
          };
        }
      }

      // Sí puede cambiar -> pedir confirmación explícita advirtiendo bloqueo del anterior y regla de 90 días
      await supabase
        .from("geny_auth_sessions")
        .update({
          step: "awaiting_swap_confirm",
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);

      return {
        allowed: false,
        replyText:
          `⚠️ **Esta cuenta ya se está usando en otro dispositivo (${maskIdentifier(channel, existingIdentifier)}).**\n\n` +
          `¿Deseas cambiar tu sesión a este dispositivo?\n` +
          `• El número/dispositivo anterior se guardará en respaldo y **quedará bloqueado de inmediato**.\n` +
          `• Por seguridad, **solo se permite 1 cambio de dispositivo o teléfono cada ${cooldownDays} días**.\n\n` +
          `Responde **SI** para confirmar el cambio o **NO** para cancelar.`,
      };
    }
  }

  // --- PASO C: ¿El usuario escribió un correo electrónico para verificarse? ---
  if (isEmailFormat(cleanText)) {
    const emailNormalized = cleanText.toLowerCase();
    const { data: candidateUser } = await supabase
      .from("geny_users")
      .select("*")
      .eq("email", emailNormalized)
      .maybeSingle<GenyUser>();

    if (!candidateUser) {
      return {
        allowed: false,
        replyText:
          `No encontré una membresía registrada con el correo **${emailNormalized}**.\n\n` +
          `• Verifica que sea el mismo correo con el que realizaste tu compra.\n` +
          `• Si aún no eres miembro activo de INGRESARIOS, inscríbete aquí: ${settings.payment_checkout_url}`,
      };
    }

    const statusCheck = checkActiveMembership(candidateUser, settings);
    if (!statusCheck.ok) {
      return { allowed: false, replyText: statusCheck.replyText };
    }

    const otpCode = String(crypto.randomInt(100000, 999999));
    await supabase.from("geny_auth_sessions").upsert(
      {
        channel,
        sender_identifier: senderId,
        step: "awaiting_otp",
        target_user_id: candidateUser.id,
        candidate_email: emailNormalized,
        otp_code: otpCode,
        attempts: 0,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel,sender_identifier" }
    );

    await sendVerificationOtpEmail({
      to: emailNormalized,
      fullName: candidateUser.full_name,
      otpCode,
      channel,
    });

    return {
      allowed: false,
      replyText:
        `Te envié un código de verificación de **6 dígitos** a **${emailNormalized}**.\n\n` +
        `Escríbelo aquí para activar tu acceso en este dispositivo (revisa también Spam/Promociones).`,
    };
  }

  // --- PASO D: Revisar si este número fue BLOQUEADO previamente por transferencia a otro equipo ---
  const { data: revokedRecord } = await supabase
    .from("geny_device_history")
    .select("created_at")
    .eq("channel", channel)
    .eq("previous_identifier", senderId)
    .eq("previous_status", "revoked")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (revokedRecord) {
    return {
      allowed: false,
      replyText:
        `🔒 **Sesión transferida a otro dispositivo.**\n\n` +
        `Este número fue desvinculado cuando tu cuenta se activó en un nuevo teléfono. ` +
        `Si necesitas recuperar tu sesión aquí (sujeto al límite de 1 cambio cada ${settings.device_swap_cooldown_days} días), escríbeme tu correo electrónico de miembro.`,
    };
  }

  // --- PASO E: Primer contacto de un usuario desconocido ---
  return {
    allowed: false,
    replyText:
      `¡Hola! Soy **GENY PRO**, tu mentora de trading y mentalidad en **INGRESARIOS** 💜.\n\n` +
      `Para verificar tu membresía activa y vincular este dispositivo, por favor **escríbeme el correo electrónico** con el que realizaste tu inscripción.\n\n` +
      `¿Aún no eres parte? Únete aquí: ${settings.payment_checkout_url}`,
  };
}

