export async function sendVerificationOtpEmail(params: {
  to: string;
  fullName?: string | null;
  otpCode: string;
  channel: "telegram" | "whatsapp";
}): Promise<{ delivered: boolean }> {
  const resendKey = process.env.RESEND_API_KEY;
  const from =
    process.env.EMAIL_FROM ||
    "GENY PRO - INGRESARIOS <genypro@mail.ingresarios.net>";
  const channelLabel = params.channel === "whatsapp" ? "WhatsApp" : "Telegram";
  const greeting = params.fullName ? `Hola ${params.fullName},` : "Hola,";

  if (!resendKey) {
    console.info(
      `[GENY OTP DEV] Canal=${channelLabel} | Email=${params.to} | Código=${params.otpCode}`
    );
    return { delivered: true };
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 28px; background: #0f172a; color: #f8fafc; border-radius: 16px;">
      <h2 style="margin: 0 0 12px; color: #a78bfa;">Activación de GENY PRO en ${channelLabel}</h2>
      <p style="color: #cbd5e1; line-height: 1.6;">${greeting}</p>
      <p style="color: #cbd5e1; line-height: 1.6;">Usa el siguiente código de verificación para vincular tu sesión de <strong>${channelLabel}</strong> con tu membresía de INGRESARIOS:</p>
      <div style="margin: 24px 0; padding: 18px; background: #1e293b; border: 1px solid #8b5cf6; border-radius: 12px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #f8fafc;">
        ${params.otpCode}
      </div>
      <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">Este código vence en 15 minutos. Si no solicitaste este acceso, ignora este correo.</p>
      <p style="color: #a78bfa; font-size: 14px; margin-top: 20px;">¡Yo honro tu proceso!</p>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: `${params.otpCode} es tu código de acceso a GENY PRO (${channelLabel})`,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("[GENY OTP ERROR]", errText);
    return { delivered: false };
  }

  return { delivered: true };
}

