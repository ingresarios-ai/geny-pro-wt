import crypto from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  GenySettings,
  GenyUser,
  getSupabaseAdmin,
} from "@/lib/supabase/admin";
import { sendVerificationOtpEmail } from "@/lib/auth/email-otp";
import {
  appendGhlContactNote,
  buildGhlDeviceBoundNote,
  buildGhlOtpSentNote,
} from "@/lib/channels/ghl";

export type GateResult =
  | { allowed: true; user: GenyUser; justActivatedMessage?: string }
  | { allowed: false; replyText: string; silentDrop?: boolean };

export function normalizePhoneE164(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `+${digits}` : raw.trim();
}

export async function generateUniqueActivationCode(
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const candidate = String(crypto.randomInt(100000, 999999));
    const { data } = await supabase
      .from("geny_users")
      .select("id")
      .eq("activation_code", candidate)
      .limit(1)
      .maybeSingle();
    if (!data) {
      return candidate;
    }
  }
  return String(crypto.randomInt(100000, 999999));
}

function maskIdentifier(channel: "telegram" | "whatsapp", id: string): string {
  if (id.length <= 4) return "••••";
  const tail = id.slice(-4);
  return channel === "whatsapp" ? `+••• ••• ${tail}` : `ID ••••${tail}`;
}

function sanitizeInvisibleChars(raw: string): string {
  return raw.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");
}

function extractEmailFromMessage(input: string): string | null {
  const trimmed = sanitizeInvisibleChars(input).trim();
  if (!trimmed || trimmed.length > 220) return null;
  const match = trimmed.match(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
  );
  if (!match) return null;
  return match[0].replace(/[.,;:!?]+$/, "").toLowerCase();
}

function extractSixDigitCode(input: string): string | null {
  const trimmed = sanitizeInvisibleChars(input).trim();
  if (!trimmed || trimmed.length > 100 || trimmed.includes("@")) return null;
  const compactDigits = trimmed.replace(/[\s-]+/g, "");
  if (/^\d{6}$/.test(compactDigits)) {
    return compactDigits;
  }
  const normalizedSpaced = trimmed.replace(/\b(\d{3})[\s-]+(\d{3})\b/, "$1$2");
  const match = normalizedSpaced.match(/(?:^|\D)(\d{6})(?:\D|$)/);
  return match ? match[1] : null;
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

async function finalizeVerifiedUserDevice(params: {
  supabase: SupabaseClient;
  targetUser: GenyUser;
  channel: "telegram" | "whatsapp";
  senderId: string;
  senderUsername?: string | null;
  settings: GenySettings;
  usedSupportCode: boolean;
  sessionIdToDelete?: string | null;
}): Promise<GateResult> {
  const {
    supabase,
    targetUser,
    channel,
    senderId,
    senderUsername,
    settings,
    usedSupportCode,
    sessionIdToDelete,
  } = params;

  const statusCheck = checkActiveMembership(targetUser, settings);
  if (!statusCheck.ok) {
    if (sessionIdToDelete) {
      await supabase.from("geny_auth_sessions").delete().eq("id", sessionIdToDelete);
    }
    return { allowed: false, replyText: statusCheck.replyText };
  }

  // Si usó el código de respaldo de soporte, rotarlo por seguridad tras validar
  if (usedSupportCode) {
    const nextCode = await generateUniqueActivationCode(supabase);
    await supabase
      .from("geny_users")
      .update({ activation_code: nextCode })
      .eq("id", targetUser.id);
  }

  const columnId = channel === "whatsapp" ? "whatsapp_phone" : "telegram_id";
  const columnBoundAt =
    channel === "whatsapp" ? "whatsapp_bound_at" : "telegram_bound_at";
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
      reason: usedSupportCode
        ? "Vinculación inicial verificada con código de activación de soporte"
        : "Vinculación inicial verificada con OTP por correo",
    });

    await supabase
      .from("geny_users")
      .update({
        [columnId]: senderId,
        [columnBoundAt]: nowIso,
        ...(channel === "telegram" && senderUsername
          ? { telegram_username: senderUsername }
          : {}),
        updated_at: nowIso,
      })
      .eq("id", targetUser.id);

    await supabase
      .from("geny_auth_sessions")
      .delete()
      .eq("channel", channel)
      .eq("sender_identifier", senderId);

    await appendGhlContactNote({
      ghlContactId: targetUser.ghl_contact_id,
      email: targetUser.email,
      userId: targetUser.id,
      noteBody: buildGhlDeviceBoundNote({
        channel,
        identifier:
          channel === "telegram" && senderUsername
            ? `@${senderUsername}`
            : senderId,
      }),
    });

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

      if (sessionIdToDelete) {
        await supabase.from("geny_auth_sessions").delete().eq("id", sessionIdToDelete);
      }

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
  await supabase.from("geny_auth_sessions").upsert(
    {
      channel,
      sender_identifier: senderId,
      step: "awaiting_swap_confirm",
      target_user_id: targetUser.id,
      candidate_email: targetUser.email,
      attempts: 0,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "channel,sender_identifier" }
  );

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
  const candidateEmail = extractEmailFromMessage(cleanText);
  const sixDigitCode = candidateEmail ? null : extractSixDigitCode(cleanText);

  const { data: session } = await supabase
    .from("geny_auth_sessions")
    .select("*")
    .eq("channel", channel)
    .eq("sender_identifier", senderId)
    .maybeSingle();

  const isSessionExpired = session
    ? new Date(session.expires_at).getTime() <= Date.now()
    : false;

  // --- PASO A: El usuario está confirmando el CAMBIO DE DISPOSITIVO (SI / NO) ---
  if (
    session &&
    session.step === "awaiting_swap_confirm" &&
    session.target_user_id &&
    !candidateEmail &&
    !sixDigitCode
  ) {
    const normalizedAnswer = cleanText
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    if (isSessionExpired) {
      await supabase.from("geny_auth_sessions").delete().eq("id", session.id);
      if (
        ["si", "cambiar", "confirmar", "transferir", "acepto"].includes(
          normalizedAnswer
        )
      ) {
        return {
          allowed: false,
          replyText:
            "⏰ Tu ventana de confirmación venció por seguridad. Escríbeme nuevamente tu correo electrónico o tu código de activación de 6 dígitos.",
        };
      }
    } else {
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
            replyText:
              "No pudimos encontrar tu cuenta. Escribe tu correo nuevamente.",
          };
        }

        const previousIdentifier =
          channel === "whatsapp"
            ? targetUser.whatsapp_phone
            : targetUser.telegram_id;
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
  }

  // --- PASO B: El usuario tiene una sesión awaiting_otp e ingresa su código ---
  if (
    session &&
    session.step === "awaiting_otp" &&
    session.target_user_id &&
    !candidateEmail
  ) {
    if (!sixDigitCode) {
      if (!isSessionExpired) {
        return {
          allowed: false,
          replyText:
            `Ingresa el código de **6 dígitos** que enviamos a **${session.candidate_email}** (o vuelve a escribir tu correo si te equivocaste).`,
        };
      }
      await supabase.from("geny_auth_sessions").delete().eq("id", session.id);
    } else {
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

      const matchesOtp = !isSessionExpired && sixDigitCode === session.otp_code;
      const matchesSupportCode =
        Boolean(targetUser.activation_code) &&
        sixDigitCode === targetUser.activation_code;

      if (matchesOtp || matchesSupportCode) {
        return await finalizeVerifiedUserDevice({
          supabase,
          targetUser,
          channel,
          senderId,
          senderUsername: params.senderUsername,
          settings,
          usedSupportCode: matchesSupportCode && !matchesOtp,
          sessionIdToDelete: session.id,
        });
      }

      // Verificar si ingresó el código directo de soporte de su cuenta real (por si había escrito otro correo antes)
      const { data: directUsers } = await supabase
        .from("geny_users")
        .select("*")
        .eq("activation_code", sixDigitCode)
        .limit(2);

      if (directUsers && directUsers.length === 1) {
        return await finalizeVerifiedUserDevice({
          supabase,
          targetUser: directUsers[0] as GenyUser,
          channel,
          senderId,
          senderUsername: params.senderUsername,
          settings,
          usedSupportCode: true,
          sessionIdToDelete: session.id,
        });
      }

      if (isSessionExpired) {
        await supabase.from("geny_auth_sessions").delete().eq("id", session.id);
        return {
          allowed: false,
          replyText:
            `⏰ El código temporal enviado a **${session.candidate_email}** ya venció (vigencia de 15 minutos).\n\n` +
            `• Escríbeme nuevamente tu correo **${session.candidate_email}** para enviarte un código nuevo al instante.\n` +
            `• O ingresa el código directo de 6 dígitos que te comparta nuestro equipo de soporte.`,
        };
      }

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
        replyText: `Código incorrecto (intento ${nextAttempts}/5). Verifica tu correo o el código de soporte e inténtalo de nuevo.`,
      };
    }
  }

  // --- PASO B2: El usuario ingresó directamente un código de activación de 6 dígitos (Soporte) sin haber puesto su correo antes ---
  if (sixDigitCode && !candidateEmail) {
    const priorAttempts =
      session && session.step === "awaiting_email" && !isSessionExpired
        ? session.attempts ?? 0
        : 0;

    if (priorAttempts >= 6) {
      return {
        allowed: false,
        replyText:
          "Demasiados intentos con códigos inválidos. Por favor **escríbeme tu correo electrónico** registrado para enviarte un código nuevo.",
      };
    }

    const { data: directUsers } = await supabase
      .from("geny_users")
      .select("*")
      .eq("activation_code", sixDigitCode)
      .limit(2);

    if (directUsers && directUsers.length === 1) {
      return await finalizeVerifiedUserDevice({
        supabase,
        targetUser: directUsers[0] as GenyUser,
        channel,
        senderId,
        senderUsername: params.senderUsername,
        settings,
        usedSupportCode: true,
        sessionIdToDelete: session?.id ?? null,
      });
    }

    await supabase.from("geny_auth_sessions").upsert(
      {
        channel,
        sender_identifier: senderId,
        step: "awaiting_email",
        target_user_id: null,
        candidate_email: null,
        otp_code: null,
        attempts: priorAttempts + 1,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "channel,sender_identifier" }
    );

    return {
      allowed: false,
      replyText:
        `⚠️ Ese código de **6 dígitos** no coincide o ya fue utilizado.\n\n` +
        `• Para recibir un código nuevo al instante, **escríbeme aquí tu correo electrónico** registrado en INGRESARIOS.\n` +
        `• Si nuestro equipo de soporte te compartió un código de activación, verifica los 6 números e inténtalo de nuevo.`,
    };
  }

  // --- PASO C: ¿El usuario escribió un correo electrónico para verificarse? ---
  if (candidateEmail) {
    const emailNormalized = candidateEmail;
    let { data: candidateUser } = await supabase
      .from("geny_users")
      .select("*")
      .eq("email", emailNormalized)
      .maybeSingle<GenyUser>();

    if (!candidateUser) {
      const { data: altMatchedUsers } = await supabase
        .from("geny_users")
        .select("*")
        .contains("alternate_emails", [emailNormalized])
        .limit(1);
      if (altMatchedUsers && altMatchedUsers.length === 1) {
        candidateUser = altMatchedUsers[0] as GenyUser;
      }
    }

    if (!candidateUser) {
      await supabase.from("geny_auth_sessions").upsert(
        {
          channel,
          sender_identifier: senderId,
          step: "awaiting_email",
          target_user_id: null,
          candidate_email: emailNormalized,
          otp_code: null,
          attempts: 0,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "channel,sender_identifier" }
      );

      return {
        allowed: false,
        replyText:
          `No encontré una membresía registrada con el correo **${emailNormalized}**.\n\n` +
          `• Verifica que sea el mismo correo con el que realizaste tu compra (o ingresa directamente tu código de activación de 6 dígitos si te lo compartió soporte).\n` +
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

    const otpEmailRes = await sendVerificationOtpEmail({
      to: emailNormalized,
      fullName: candidateUser.full_name,
      otpCode,
      channel,
    });

    await appendGhlContactNote({
      ghlContactId: candidateUser.ghl_contact_id,
      email: emailNormalized,
      userId: candidateUser.id,
      noteBody: buildGhlOtpSentNote({
        email: emailNormalized,
        channel,
        otpCode,
        delivered: otpEmailRes.delivered,
      }),
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
      `Para activar tu acceso, **escribe aquí abajo en este mismo chat de Telegram** el correo electrónico con el que te inscribiste (o escribe directamente tu código de 6 dígitos si te lo dio soporte) y presiona Enviar.`,
  };
}

