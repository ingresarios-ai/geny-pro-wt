const TG_API_BASE = "https://api.telegram.org";

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN no está configurado.");
  }
  return token;
}

export async function sendTelegramTyping(chatId: string | number): Promise<void> {
  try {
    const token = getBotToken();
    await fetch(`${TG_API_BASE}/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {
    // Non-critical visual indicator
  }
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<void> {
  const token = getBotToken();
  // Telegram limit is 4096 chars; split safely if longer
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += 3800) {
    chunks.push(text.slice(i, i + 3800));
  }

  for (const part of chunks) {
    const res = await fetch(`${TG_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      // Fallback sin parse_mode por si un símbolo de trading rompe Markdown de Telegram
      await fetch(`${TG_API_BASE}/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: part.replace(/\*\*/g, ""),
          disable_web_page_preview: true,
        }),
      });
    }
  }
}

export async function downloadTelegramFile(
  fileId: string
): Promise<{ buffer: Buffer; filePath: string }> {
  const token = getBotToken();
  const metaRes = await fetch(
    `${TG_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  if (!metaRes.ok) {
    throw new Error("No se pudo consultar getFile en Telegram.");
  }
  const metaJson = (await metaRes.json()) as {
    ok: boolean;
    result?: { file_path?: string };
  };
  const filePath = metaJson.result?.file_path;
  if (!filePath) {
    throw new Error("Telegram no devolvió file_path.");
  }

  const binRes = await fetch(`${TG_API_BASE}/file/bot${token}/${filePath}`);
  if (!binRes.ok) {
    throw new Error("Error descargando archivo binario de Telegram.");
  }
  const arr = await binRes.arrayBuffer();
  return { buffer: Buffer.from(arr), filePath };
}

export async function isTelegramUserInWhopGroup(
  groupChatId: string,
  telegramUserId: string | number
): Promise<boolean> {
  try {
    const token = getBotToken();
    const res = await fetch(`${TG_API_BASE}/bot${token}/getChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: groupChatId,
        user_id: Number(telegramUserId),
      }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      ok: boolean;
      result?: { status?: string };
    };
    const status = data.result?.status;
    return (
      status === "member" ||
      status === "administrator" ||
      status === "creator"
    );
  } catch {
    return false;
  }
}

