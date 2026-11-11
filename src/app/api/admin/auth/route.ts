import { NextRequest, NextResponse } from "next/server";
import {
  COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createAdminToken,
} from "@/lib/auth/admin-session";

export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string };
  const expected =
    process.env.ADMIN_ACCESS_PASSWORD || "ingresarios-dev-2026";

  if (!password || password !== expected) {
    return NextResponse.json(
      { error: "Contraseña de administrador incorrecta." },
      { status: 401 }
    );
  }

  const token = createAdminToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAME);
  return res;
}

