"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Users,
  BookOpen,
  ShieldAlert,
  Settings,
  Plus,
  Upload,
  LogOut,
  RefreshCw,
  Smartphone,
  Ban,
  CheckCircle2,
  Unlock,
  Download,
  Trash2,
  AlertTriangle,
  Search,
  Activity,
  Cpu,
  Database,
  Lock,
  Terminal,
  Pencil,
  Eye,
  EyeOff,
  RotateCcw,
  Globe,
  ExternalLink,
  DollarSign,
  X,
} from "lucide-react";
import {
  DEFAULT_AI_PRICING,
  type AiPricingConfig,
} from "@/lib/geny/pricing";
import type {
  BillingSource,
  GenyDeviceHistory,
  GenyMessage,
  GenySettings,
  GenyUser,
  ManagedSecretKey,
  MembershipStatus,
  PlanTier,
  UsageAnalyticsPayload,
  UserUsageRow,
} from "@/lib/supabase/admin";

interface KnowledgeDocSummary {
  id: string;
  title: string;
  category: string;
  source_url?: string | null;
  is_active: boolean;
  chunks_count: number;
  updated_at: string;
}

interface IngestJobItem {
  id: string;
  name: string;
  stage: "queued" | "uploading" | "analyzing" | "done" | "error";
  uploadPercent?: number;
  analyzePercent?: number;
  detailText: string;
  categoryAssigned?: string;
  isNewCategory?: boolean;
  chunksIndexed?: number;
}

interface ReviewMessageRow extends GenyMessage {
  geny_users?: { email?: string; full_name?: string | null } | null;
}

interface ChannelsPayload {
  origin: string;
  webhooks: {
    telegram: string;
    whatsapp: string;
    whop: string;
    stripe: string;
    hotmart: string;
  };
  secretsConfigured: {
    telegramToken: boolean;
    telegramSecret: boolean;
    whatsappVerifyToken: string;
    whopSecret: boolean;
    stripeSecret: boolean;
    hotmartHottok: boolean;
  };
  telegramBotInfo: {
    ok: boolean;
    username?: string;
    firstName?: string;
    webhookUrl?: string;
    pendingUpdateCount?: number;
    lastErrorMessage?: string;
  };
}

interface SecretMetaEntry {
  hasValue: boolean;
  source: "supabase" | "env" | "none";
  maskedPreview: string;
  value: string;
}

interface DashboardPayload {
  configured: boolean;
  envStatus: {
    supabaseUrl: boolean;
    supabaseServiceRole: boolean;
    geminiKey: boolean;
    claudeKey: boolean;
    whisperKey: boolean;
    telegramBot: boolean;
    whatsappCloud: boolean;
    resendKey: boolean;
  };
  secretsMeta?: Record<ManagedSecretKey, SecretMetaEntry>;
  settings: GenySettings | null;
  users: GenyUser[];
  deviceHistory: GenyDeviceHistory[];
  knowledgeDocs: KnowledgeDocSummary[];
  reviewMessages: ReviewMessageRow[];
  usageAnalytics?: UsageAnalyticsPayload;
  resolvedPricing?: AiPricingConfig;
  stats: {
    totalUsers: number;
    activeUsers: number;
    suspendedUsers: number;
    pendingReviews: number;
    goldExamples: number;
    messagesToday: number;
  };
}

const STATUS_BADGE: Record<
  MembershipStatus,
  { label: string; classes: string; dot: string }
> = {
  active: {
    label: "Activo",
    classes: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400 shadow-[0_0_8px_#34d399]",
  },
  past_due: {
    label: "Pago pendiente",
    classes: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    dot: "bg-amber-400",
  },
  canceled: {
    label: "Baja / Cancelado",
    classes: "bg-slate-500/15 text-slate-300 border-white/15",
    dot: "bg-slate-400",
  },
  suspended: {
    label: "Suspendido",
    classes: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    dot: "bg-rose-400 shadow-[0_0_8px_#fb7185]",
  },
};

function getInitials(name?: string | null, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (
      (parts[0]?.[0] || "") + (parts[1]?.[0] || parts[0]?.[1] || "")
    ).toUpperCase();
  }
  return (email?.slice(0, 2) || "GP").toUpperCase();
}

function getOneMonthFromTodayDateStr(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function getOneYearFromTodayDateStr(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function getDaysUntilExpiration(expiresAt?: string | null): number | null {
  if (!expiresAt) return null;
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function formatUsd(amount?: number | null): string {
  const val = Number(amount ?? 0);
  if (!Number.isFinite(val) || val <= 0) return "$0.00";
  if (val < 1) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(2)}`;
}

function formatTokensCompact(tokens?: number | null): string {
  const val = Math.max(0, Math.round(Number(tokens ?? 0)));
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}k`;
  return String(val);
}

export default function AdminDashboardClient() {
  const router = useRouter();
  const uid = useId();

  const [tab, setTab] = useState<
    "users" | "knowledge" | "reviews" | "channels" | "settings"
  >("users");
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [channelsInfo, setChannelsInfo] = useState<ChannelsPayload | null>(
    null
  );
  const [publicDomainUrl, setPublicDomainUrl] = useState("");
  const [connectingTelegram, setConnectingTelegram] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  // Filtros combinables inteligentes de usuarios
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | MembershipStatus>(
    "all"
  );
  const [planFilter, setPlanFilter] = useState<"all" | PlanTier>("all");
  const [expirationFilter, setExpirationFilter] = useState<
    | "all"
    | "expiring_7d"
    | "expiring_15d"
    | "expiring_30d"
    | "expired"
    | "permanent"
  >("all");
  const [deviceFilter, setDeviceFilter] = useState<
    | "all"
    | "with_whatsapp"
    | "without_whatsapp"
    | "with_telegram"
    | "without_telegram"
    | "swap_locked"
  >("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | BillingSource>(
    "all"
  );
  const [sortBy, setSortBy] = useState<
    "created_desc" | "expires_asc" | "name_asc" | "cost_desc" | "messages_desc"
  >("created_desc");

  // Native <dialog> refs (modern-web-guidance: dialog)
  const createDialogRef = useRef<HTMLDialogElement>(null);
  const csvDialogRef = useRef<HTMLDialogElement>(null);
  const manageDialogRef = useRef<HTMLDialogElement>(null);
  const dangerDialogRef = useRef<HTMLDialogElement>(null);

  // Estado formulario Alta Manual
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPhone, setNewUserPhone] = useState("");
  const [newUserPlan, setNewUserPlan] = useState<PlanTier>("reto");
  const [newUserExpires, setNewUserExpires] = useState("");
  const [newUserNotes, setNewUserNotes] = useState("");
  const [savingUser, setSavingUser] = useState(false);

  // Estado CSV
  const [csvText, setCsvText] = useState("");
  const [importingCsv, setImportingCsv] = useState(false);

  // Usuario seleccionado para gestionar ficha + historial de dispositivos
  const [selectedUser, setSelectedUser] = useState<GenyUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editTelegramId, setEditTelegramId] = useState("");
  const [editTelegramUsername, setEditTelegramUsername] = useState("");
  const [editStatus, setEditStatus] = useState<MembershipStatus>("active");
  const [editPlan, setEditPlan] = useState<PlanTier>("reto");
  const [editExpires, setEditExpires] = useState("");
  const [editSuspendReason, setEditSuspendReason] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [updatingSelected, setUpdatingSelected] = useState(false);

  // Conocimiento RAG (Opción A: Archivos PDF/Word/Imágenes, Opción B: URLs Web / Google Drive, Manual/Edición)
  const [ingestMode, setIngestMode] = useState<"files" | "drive" | "manual">(
    "files"
  );
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docCategory, setDocCategory] = useState("__auto__");
  const [customCategory, setCustomCategory] = useState("");
  const [docContent, setDocContent] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [driveUrlsText, setDriveUrlsText] = useState("");
  const [ingestStatusText, setIngestStatusText] = useState<string | null>(null);
  const [indexingDoc, setIndexingDoc] = useState(false);
  const [ingestJobs, setIngestJobs] = useState<IngestJobItem[]>([]);
  const [ingestDrawerMinimized, setIngestDrawerMinimized] = useState(false);

  // Settings editables + Bóveda de APIs (Zona de Peligro)
  const [settingsForm, setSettingsForm] = useState<GenySettings | null>(null);
  const [pricingDraft, setPricingDraft] =
    useState<AiPricingConfig>(DEFAULT_AI_PRICING);
  const [savingSettings, setSavingSettings] = useState(false);
  const [dangerZoneUnlocked, setDangerZoneUnlocked] = useState(false);
  const [secretsDraft, setSecretsDraft] = useState<
    Partial<Record<ManagedSecretKey, string>>
  >({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>(
    {}
  );
  const [restoringSnapshot, setRestoringSnapshot] = useState(false);

  const loadDashboard = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) {
        setLoading(true);
      }
      try {
        const [res, chRes] = await Promise.all([
          fetch("/api/admin/dashboard", { cache: "no-store" }),
          fetch("/api/admin/channels", { cache: "no-store" }),
        ]);
        if (res.status === 401) {
          router.refresh();
          return;
        }
        const json = (await res.json()) as DashboardPayload;
        setData(json);
        if (json.settings) {
          setSettingsForm((prev) =>
            opts?.silent && prev ? prev : json.settings
          );
        }
        if (json.resolvedPricing && !opts?.silent) {
          setPricingDraft(json.resolvedPricing);
        }
        if (chRes.ok) {
          const chJson = (await chRes.json()) as ChannelsPayload;
          setChannelsInfo(chJson);
          const preferredOrigin =
            chJson.origin.includes("localhost") ||
            chJson.origin.includes(".vercel.app")
              ? "https://genypro.ingresarios.ai"
              : chJson.origin;
          setPublicDomainUrl((prev) => prev || preferredOrigin);
        }
      } finally {
        if (!opts?.silent) {
          setLoading(false);
        }
      }
    },
    [router]
  );

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const hasActiveIngestJobs = useMemo(
    () =>
      ingestJobs.some(
        (j) =>
          j.stage === "queued" ||
          j.stage === "uploading" ||
          j.stage === "analyzing"
      ),
    [ingestJobs]
  );

  // Evitar que arrastrar un PDF a la ventana abra una pestaña nueva del navegador y proteger cierres accidentales durante subidas
  useEffect(() => {
    function preventBrowserFileOpen(e: DragEvent) {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    }
    window.addEventListener("dragover", preventBrowserFileOpen);
    window.addEventListener("drop", preventBrowserFileOpen);
    return () => {
      window.removeEventListener("dragover", preventBrowserFileOpen);
      window.removeEventListener("drop", preventBrowserFileOpen);
    };
  }, []);

  useEffect(() => {
    if (!hasActiveIngestJobs) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveIngestJobs]);

  function notify(msg: string) {
    setFeedbackBanner(msg);
    setTimeout(() => {
      setFeedbackBanner((curr) => (curr === msg ? null : curr));
    }, 4500);
  }

  const hasActiveUserFilters =
    Boolean(searchQuery.trim()) ||
    statusFilter !== "all" ||
    planFilter !== "all" ||
    expirationFilter !== "all" ||
    deviceFilter !== "all" ||
    sourceFilter !== "all" ||
    sortBy !== "created_desc";

  function resetAllUserFilters() {
    setSearchQuery("");
    setStatusFilter("all");
    setPlanFilter("all");
    setExpirationFilter("all");
    setDeviceFilter("all");
    setSourceFilter("all");
    setSortBy("created_desc");
  }

  const usageByUserMap = useMemo(() => {
    const map = new Map<string, UserUsageRow>();
    for (const row of data?.usageAnalytics?.per_user || []) {
      map.set(row.user_id, row);
    }
    return map;
  }, [data]);

  const filteredUsers = useMemo(() => {
    if (!data) return [];
    const q = searchQuery.trim().toLowerCase();

    const list = data.users.filter((u) => {
      if (statusFilter !== "all" && u.membership_status !== statusFilter) {
        return false;
      }
      if (planFilter !== "all" && u.plan_tier !== planFilter) {
        return false;
      }
      if (sourceFilter !== "all" && u.billing_source !== sourceFilter) {
        return false;
      }

      // Filtro por vencimiento
      if (expirationFilter !== "all") {
        const daysLeft = getDaysUntilExpiration(u.expires_at);
        if (expirationFilter === "permanent" && u.expires_at !== null) {
          return false;
        }
        if (expirationFilter === "expired") {
          if (daysLeft === null || daysLeft > 0) return false;
        }
        if (expirationFilter === "expiring_7d") {
          if (daysLeft === null || daysLeft < 0 || daysLeft > 7) return false;
        }
        if (expirationFilter === "expiring_15d") {
          if (daysLeft === null || daysLeft < 0 || daysLeft > 15) return false;
        }
        if (expirationFilter === "expiring_30d") {
          if (daysLeft === null || daysLeft < 0 || daysLeft > 30) return false;
        }
      }

      // Filtro por dispositivo / candado
      if (deviceFilter !== "all") {
        if (deviceFilter === "with_whatsapp" && !u.whatsapp_phone) return false;
        if (deviceFilter === "without_whatsapp" && u.whatsapp_phone)
          return false;
        if (deviceFilter === "with_telegram" && !u.telegram_id) return false;
        if (deviceFilter === "without_telegram" && u.telegram_id) return false;
        if (
          deviceFilter === "swap_locked" &&
          !u.whatsapp_last_swap_at &&
          !u.telegram_last_swap_at
        ) {
          return false;
        }
      }

      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.whatsapp_phone || "").toLowerCase().includes(q) ||
        (u.telegram_id || "").toLowerCase().includes(q) ||
        (u.telegram_username || "").toLowerCase().includes(q) ||
        (u.admin_notes || "").toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === "cost_desc") {
        const aCost = usageByUserMap.get(a.id)?.cost_total_usd ?? 0;
        const bCost = usageByUserMap.get(b.id)?.cost_total_usd ?? 0;
        if (bCost !== aCost) return bCost - aCost;
        const aMsgs = usageByUserMap.get(a.id)?.messages_total ?? 0;
        const bMsgs = usageByUserMap.get(b.id)?.messages_total ?? 0;
        return bMsgs - aMsgs;
      }
      if (sortBy === "messages_desc") {
        const aMsgs = usageByUserMap.get(a.id)?.messages_total ?? 0;
        const bMsgs = usageByUserMap.get(b.id)?.messages_total ?? 0;
        if (bMsgs !== aMsgs) return bMsgs - aMsgs;
      }
      if (sortBy === "expires_asc") {
        const aTime = a.expires_at
          ? new Date(a.expires_at).getTime()
          : Number.MAX_SAFE_INTEGER;
        const bTime = b.expires_at
          ? new Date(b.expires_at).getTime()
          : Number.MAX_SAFE_INTEGER;
        return aTime - bTime;
      }
      if (sortBy === "name_asc") {
        const aName = (a.full_name || a.email).toLowerCase();
        const bName = (b.full_name || b.email).toLowerCase();
        return aName.localeCompare(bName, "es");
      }
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [
    data,
    usageByUserMap,
    searchQuery,
    statusFilter,
    planFilter,
    expirationFilter,
    deviceFilter,
    sourceFilter,
    sortBy,
  ]);

  function handleExportFilteredCsv() {
    if (filteredUsers.length === 0) {
      notify("No hay usuarios en el filtro actual para exportar.");
      return;
    }

    const escapeCsvCell = (val: string | number | null | undefined) => {
      const str = String(val ?? "").replace(/"/g, '""');
      return `"${str}"`;
    };

    const headers = [
      "Nombre",
      "Email",
      "Plan",
      "Estado",
      "Fecha_Vencimiento",
      "Dias_Restantes",
      "WhatsApp",
      "Telegram_ID",
      "Telegram_Usuario",
      "Mensajes_Hoy",
      "Mensajes_Mes",
      "Mensajes_Total",
      "Notas_Voz",
      "Graficos_Analizados",
      "Tokens_Totales",
      "Costo_Mes_USD",
      "Costo_Total_USD",
      "Origen",
      "Notas_Admin",
      "Fecha_Alta",
    ];

    const rows = filteredUsers.map((u) => {
      const daysLeft = getDaysUntilExpiration(u.expires_at);
      const uUsage = usageByUserMap.get(u.id);
      const totalTokens =
        (uUsage?.tokens_in_total ?? 0) + (uUsage?.tokens_out_total ?? 0);
      return [
        escapeCsvCell(u.full_name || ""),
        escapeCsvCell(u.email),
        escapeCsvCell(u.plan_tier),
        escapeCsvCell(STATUS_BADGE[u.membership_status].label),
        escapeCsvCell(
          u.expires_at ? u.expires_at.slice(0, 10) : "Permanente"
        ),
        escapeCsvCell(
          daysLeft === null ? "Permanente" : `${daysLeft} dias`
        ),
        escapeCsvCell(u.whatsapp_phone || ""),
        escapeCsvCell(u.telegram_id || ""),
        escapeCsvCell(
          u.telegram_username ? `@${u.telegram_username}` : ""
        ),
        escapeCsvCell(uUsage?.messages_today ?? 0),
        escapeCsvCell(uUsage?.messages_month ?? 0),
        escapeCsvCell(uUsage?.messages_total ?? 0),
        escapeCsvCell(uUsage?.audio_count ?? 0),
        escapeCsvCell(uUsage?.image_count ?? 0),
        escapeCsvCell(totalTokens),
        escapeCsvCell((uUsage?.cost_month_usd ?? 0).toFixed(4)),
        escapeCsvCell((uUsage?.cost_total_usd ?? 0).toFixed(4)),
        escapeCsvCell(u.billing_source),
        escapeCsvCell(u.admin_notes || ""),
        escapeCsvCell(u.created_at.slice(0, 10)),
      ].join(",");
    });

    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `geny-pro-miembros-filtrados-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    notify(
      `Exportados ${filteredUsers.length} miembro(s) filtrados a CSV.`
    );
  }

  const selectedUserHistory = useMemo(() => {
    if (!data || !selectedUser) return [];
    return data.deviceHistory.filter((h) => h.user_id === selectedUser.id);
  }, [data, selectedUser]);

  const selectedUserUsage = useMemo(() => {
    if (!selectedUser) return null;
    return usageByUserMap.get(selectedUser.id) ?? null;
  }, [selectedUser, usageByUserMap]);

  function openManageUserDialog(u: GenyUser) {
    setSelectedUser(u);
    setEditEmail(u.email);
    setEditName(u.full_name || "");
    setEditPhone(u.whatsapp_phone || "");
    setEditTelegramId(u.telegram_id || "");
    setEditTelegramUsername(u.telegram_username || "");
    setEditStatus(u.membership_status);
    setEditPlan(u.plan_tier);
    setEditExpires(
      u.expires_at
        ? u.expires_at.slice(0, 10)
        : u.plan_tier === "mensual"
          ? getOneMonthFromTodayDateStr()
          : ""
    );
    setEditSuspendReason(u.suspended_reason || "");
    setEditNotes(u.admin_notes || "");
    manageDialogRef.current?.showModal();
  }

  async function handleCreateUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (savingUser) return;
    setSavingUser(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "single",
          email: newUserEmail,
          full_name: newUserName,
          whatsapp_phone: newUserPhone,
          plan_tier: newUserPlan,
          membership_status: "active",
          expires_at: newUserExpires || null,
          admin_notes: newUserNotes,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        notify(json.error || "No se pudo guardar el usuario.");
      } else {
        setNewUserEmail("");
        setNewUserName("");
        setNewUserPhone("");
        setNewUserExpires("");
        setNewUserNotes("");
        createDialogRef.current?.close();
        notify("Miembro guardado correctamente.");
        await loadDashboard();
      }
    } finally {
      setSavingUser(false);
    }
  }

  async function handleCsvImport(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (importingCsv || !csvText.trim()) return;
    setImportingCsv(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "csv", csvText }),
      });
      const json = (await res.json()) as { imported?: number; error?: string };
      if (!res.ok) {
        notify(json.error || "Error al importar CSV.");
      } else {
        setCsvText("");
        csvDialogRef.current?.close();
        notify(`Importados ${json.imported ?? 0} miembros activos.`);
        await loadDashboard();
      }
    } finally {
      setImportingCsv(false);
    }
  }

  async function handleQuickStatusChange(
    userId: string,
    nextStatus: MembershipStatus
  ) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, membership_status: nextStatus }),
    });
    notify(`Estado actualizado a ${STATUS_BADGE[nextStatus].label}.`);
    await loadDashboard();
  }

  async function handleSaveSelectedUser(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedUser || updatingSelected) return;
    setUpdatingSelected(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          action: "update_fields",
          email: editEmail,
          full_name: editName,
          whatsapp_phone: editPhone,
          telegram_id: editTelegramId,
          telegram_username: editTelegramUsername,
          membership_status: editStatus,
          plan_tier: editPlan,
          expires_at: editExpires || null,
          suspended_reason: editSuspendReason || null,
          admin_notes: editNotes || null,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        notify(json.error || "No se pudo actualizar el usuario.");
      } else {
        manageDialogRef.current?.close();
        notify("Datos del miembro actualizados correctamente.");
        await loadDashboard();
      }
    } finally {
      setUpdatingSelected(false);
    }
  }

  async function handleDeleteSelectedUser() {
    if (!selectedUser) return;
    const res = await fetch(
      `/api/admin/users?id=${encodeURIComponent(selectedUser.id)}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      manageDialogRef.current?.close();
      notify("Miembro eliminado del directorio.");
      await loadDashboard();
    }
  }

  async function handleDeviceAction(
    action: "unlink_whatsapp" | "unlink_telegram" | "reset_swap_cooldown"
  ) {
    if (!selectedUser) return;
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selectedUser.id, action }),
    });
    notify(
      action === "reset_swap_cooldown"
        ? "Candado de 90 días liberado para este usuario."
        : "Dispositivo desvinculado y respaldado en historial."
    );
    manageDialogRef.current?.close();
    await loadDashboard();
  }

  function resolveSelectedCategory(): string | null {
    if (docCategory === "__auto__") {
      return "__auto__";
    }
    const finalCategory =
      docCategory === "__custom__"
        ? customCategory
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_")
        : docCategory;
    if (!finalCategory) {
      notify("Escribe el nombre de la nueva categoría.");
      return null;
    }
    return finalCategory;
  }

  function appendIncomingFiles(incoming: File[]) {
    const allowedExt = /\.(pdf|docx|png|jpe?g|webp|txt|md|csv)$/i;
    const valid = incoming.filter((f) => allowedExt.test(f.name));
    if (valid.length === 0) {
      notify(
        "Formato no soportado. Arrastra o selecciona archivos PDF, Word (.docx), PNG/JPG/WebP, TXT, MD o CSV."
      );
      return;
    }
    setSelectedFiles((prev) => {
      const existingKeys = new Set(prev.map((p) => `${p.name}:${p.size}`));
      const merged = [...prev];
      for (const f of valid) {
        const key = `${f.name}:${f.size}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          merged.push(f);
        }
      }
      return merged;
    });
  }

  async function safeParseJson<T>(res: Response): Promise<T & { error?: string }> {
    const raw = await res.text();
    try {
      return JSON.parse(raw) as T & { error?: string };
    } catch {
      return {
        error:
          res.status === 413
            ? "El archivo supera el límite directo HTTP (413)."
            : res.status === 504
              ? "El análisis tardó más de 60 segundos en el servidor (504)."
              : raw.slice(0, 160) || `Error HTTP ${res.status}`,
      } as T & { error?: string };
    }
  }

  function updateIngestJob(
    jobId: string,
    patch: Partial<IngestJobItem>
  ): void {
    setIngestJobs((prev) =>
      prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j))
    );
  }

  function uploadFileDirectWithProgress(params: {
    file: File;
    signedUrl: string;
    onProgress: (pct: number, loadedBytes: number, totalBytes: number) => void;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", params.signedUrl, true);
      xhr.setRequestHeader(
        "Content-Type",
        params.file.type || "application/octet-stream"
      );
      xhr.upload.onprogress = (evt) => {
        if (evt.lengthComputable && evt.total > 0) {
          const pct = Math.min(100, Math.round((evt.loaded / evt.total) * 100));
          params.onProgress(pct, evt.loaded, evt.total);
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new Error(
              `Error subiendo archivo a la nube (HTTP ${xhr.status}).`
            )
          );
        }
      };
      xhr.onerror = () =>
        reject(new Error("Error de red durante la subida del archivo."));
      xhr.send(params.file);
    });
  }

  function handleBulkFilesIngest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      notify(
        "⚠️ Arrastra o selecciona al menos un archivo (PDF, Word o Imagen) para subir y vectorizar."
      );
      document.getElementById(`${uid}-file-drop`)?.focus();
      return;
    }

    const finalCategory = resolveSelectedCategory();
    if (!finalCategory) return;

    const filesBatch = [...selectedFiles];
    const customSingleTitle =
      filesBatch.length === 1 ? docTitle.trim() : "";

    // Limpiar formulario de inmediato para permitir seguir trabajando o cambiar de pestaña
    setSelectedFiles([]);
    setDocTitle("");
    if (docCategory === "__custom__") {
      setCustomCategory("");
    }
    setIngestDrawerMinimized(false);

    const createdJobs: IngestJobItem[] = filesBatch.map((f, idx) => ({
      id: `file-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      name: customSingleTitle || f.name,
      stage: "queued",
      uploadPercent: 0,
      detailText: `En cola (${(f.size / (1024 * 1024)).toFixed(2)} MB)`,
    }));

    setIngestJobs((prev) => [
      ...createdJobs,
      ...prev.filter((j) => j.stage !== "done"),
    ]);

    notify(
      `Iniciando carga en segundo plano de ${filesBatch.length} archivo(s). Puedes cambiar de pestaña libremente.`
    );

    // Ejecutar en segundo plano sin bloquear navegación entre pestañas
    void (async () => {
      let okCount = 0;
      let chunksTotal = 0;

      for (let i = 0; i < filesBatch.length; i++) {
        const file = filesBatch[i];
        const jobId = createdJobs[i].id;
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);

        try {
          updateIngestJob(jobId, {
            stage: "uploading",
            uploadPercent: 2,
            detailText: `Preparando subida segura (${sizeMb} MB)...`,
          });

          const signRes = await fetch("/api/admin/knowledge/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_upload_url",
              fileName: file.name,
              mimeType: file.type || "application/pdf",
            }),
          });
          const signJson = await safeParseJson<{
            ok?: boolean;
            signedUrl?: string;
            storagePath?: string;
          }>(signRes);

          if (!signRes.ok || !signJson.ok || !signJson.signedUrl || !signJson.storagePath) {
            throw new Error(
              signJson.error || "No se pudo iniciar la subida en Supabase Storage."
            );
          }

          await uploadFileDirectWithProgress({
            file,
            signedUrl: signJson.signedUrl,
            onProgress: (pct, loaded, total) => {
              const loadedMb = (loaded / (1024 * 1024)).toFixed(2);
              const totalMb = (total / (1024 * 1024)).toFixed(2);
              updateIngestJob(jobId, {
                stage: "uploading",
                uploadPercent: pct,
                detailText: `Subiendo archivo: ${pct}% (${loadedMb} / ${totalMb} MB)`,
              });
            },
          });

          updateIngestJob(jobId, {
            stage: "analyzing",
            uploadPercent: 100,
            analyzePercent: undefined,
            detailText: "Preparando lectura multimodal con Gemini 3.8...",
          });

          const prepRes = await fetch("/api/admin/knowledge/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "prepare_storage_file",
              storagePath: signJson.storagePath,
              fileName: file.name,
              mimeType: file.type || "application/pdf",
              category: finalCategory,
              title: customSingleTitle || undefined,
            }),
          });

          const prepJson = await safeParseJson<{
            ok?: boolean;
            mode?: "completed" | "chunked_pdf";
            draftDocumentId?: string;
            geminiFileName?: string;
            geminiFileUri?: string;
            totalPages?: number;
            ranges?: Array<{
              partIndex: number;
              totalParts: number;
              startPage?: number;
              endPage?: number;
              label: string;
            }>;
            category?: string;
            autoClassified?: boolean;
            isNewCategory?: boolean;
            chunksIndexed?: number;
          }>(prepRes);

          if (!prepRes.ok || !prepJson.ok) {
            throw new Error(
              prepJson.error || "Error durante la preparación del archivo."
            );
          }

          let finalAssignedCat = (prepJson.category || "general").toUpperCase();
          let finalIsNewCat = Boolean(prepJson.isNewCategory);
          let finalChunks = prepJson.chunksIndexed ?? 0;

          // Si es un libro/PDF mediano o extenso, procesar por bloques de 15 páginas (0 riesgo de timeout 504)
          if (
            prepJson.mode === "chunked_pdf" &&
            prepJson.draftDocumentId &&
            prepJson.geminiFileUri &&
            prepJson.ranges &&
            prepJson.ranges.length > 0
          ) {
            const ranges = prepJson.ranges;
            try {
              for (let rIdx = 0; rIdx < ranges.length; rIdx++) {
                const rng = ranges[rIdx];
                const pct = Math.max(
                  8,
                  Math.min(90, Math.round(((rIdx + 0.35) / ranges.length) * 90))
                );

                updateIngestJob(jobId, {
                  stage: "analyzing",
                  analyzePercent: pct,
                  detailText: `Analizando libro (${rng.label}) — Bloque ${rng.partIndex} de ${rng.totalParts}...`,
                });

                let rangeSuccess = false;
                let lastRangeErr = "";
                for (let attempt = 0; attempt < 2 && !rangeSuccess; attempt++) {
                  const rangeRes = await fetch("/api/admin/knowledge/ingest", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "extract_gemini_pdf_range",
                      draftDocumentId: prepJson.draftDocumentId,
                      geminiFileUri: prepJson.geminiFileUri,
                      fileName: file.name,
                      mimeType: "application/pdf",
                      startPage: rng.startPage,
                      endPage: rng.endPage,
                      partIndex: rng.partIndex,
                      totalParts: rng.totalParts,
                    }),
                  });
                  const rangeJson = await safeParseJson<{ ok?: boolean }>(
                    rangeRes
                  );
                  if (rangeRes.ok && rangeJson.ok) {
                    rangeSuccess = true;
                  } else {
                    lastRangeErr =
                      rangeJson.error ||
                      `Error leyendo ${rng.label} (HTTP ${rangeRes.status}).`;
                  }
                }

                if (!rangeSuccess) {
                  throw new Error(lastRangeErr);
                }
              }

              updateIngestJob(jobId, {
                stage: "analyzing",
                analyzePercent: 95,
                detailText:
                  finalCategory === "__auto__"
                    ? "Clasificando categoría con IA y vectorizando libro completo (768d)..."
                    : "Vectorizando libro completo en Cerebro IA (768d)...",
              });

              const finRes = await fetch("/api/admin/knowledge/ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "finalize_chunked_document",
                  draftDocumentId: prepJson.draftDocumentId,
                  geminiFileName: prepJson.geminiFileName,
                  category: finalCategory,
                }),
              });

              const finJson = await safeParseJson<{
                ok?: boolean;
                category?: string;
                isNewCategory?: boolean;
                chunksIndexed?: number;
              }>(finRes);

              if (!finRes.ok || !finJson.ok) {
                throw new Error(
                  finJson.error || "Error al finalizar la indexación del libro."
                );
              }

              finalAssignedCat = (finJson.category || "general").toUpperCase();
              finalIsNewCat = Boolean(finJson.isNewCategory);
              finalChunks = finJson.chunksIndexed ?? 0;
            } catch (chunkErr) {
              await fetch("/api/admin/knowledge/ingest", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "cleanup_chunked_document",
                  draftDocumentId: prepJson.draftDocumentId,
                  geminiFileName: prepJson.geminiFileName,
                }),
              }).catch(() => undefined);
              throw chunkErr;
            }
          }

          okCount++;
          chunksTotal += finalChunks;

          updateIngestJob(jobId, {
            stage: "done",
            uploadPercent: 100,
            analyzePercent: 100,
            categoryAssigned: finalAssignedCat,
            isNewCategory: finalIsNewCat,
            chunksIndexed: finalChunks,
            detailText: `Completado · ${finalChunks} fragmentos · Categoría: ${finalAssignedCat}${
              finalIsNewCat ? " (Nueva creada por IA)" : ""
            }`,
          });

          await loadDashboard({ silent: true });
        } catch (err) {
          updateIngestJob(jobId, {
            stage: "error",
            detailText:
              err instanceof Error ? err.message : "Error inesperado al procesar.",
          });
        }
      }

      if (okCount > 0) {
        notify(
          `✅ Procesamiento finalizado: ${okCount} de ${filesBatch.length} archivo(s) indexados (${chunksTotal} fragmentos en Cerebro IA).`
        );
      } else {
        notify(
          `⚠️ No se pudo completar el procesamiento. Revisa el detalle en el monitor de carga.`
        );
      }
    })();
  }

  async function handleDriveLinksIngest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!driveUrlsText.trim()) return;

    const finalCategory = resolveSelectedCategory();
    if (!finalCategory) return;

    const rawUrlsSnapshot = driveUrlsText;
    setIndexingDoc(true);
    setIngestStatusText(
      "Inspeccionando enlaces y listando documentos de carpetas de Google Drive..."
    );

    try {
      const expandRes = await fetch("/api/admin/knowledge/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "expand_targets",
          driveUrls: rawUrlsSnapshot,
        }),
      });

      const expandJson = await safeParseJson<{
        ok?: boolean;
        expandedItems?: Array<{
          label: string;
          url: string;
          titleHint?: string;
        }>;
      }>(expandRes);

      if (
        !expandRes.ok ||
        !expandJson.ok ||
        !expandJson.expandedItems ||
        expandJson.expandedItems.length === 0
      ) {
        notify(
          expandJson.error ||
            "No se detectaron URLs públicas ni documentos visibles en la carpeta de Drive."
        );
        return;
      }

      const items = expandJson.expandedItems;
      setDriveUrlsText("");
      if (docCategory === "__custom__") {
        setCustomCategory("");
      }
      setIngestDrawerMinimized(false);

      const createdJobs: IngestJobItem[] = items.map((item, idx) => ({
        id: `url-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        name: item.label,
        stage: "queued",
        detailText: `En cola (${idx + 1} de ${items.length})`,
      }));

      setIngestJobs((prev) => [
        ...createdJobs,
        ...prev.filter((j) => j.stage !== "done"),
      ]);

      notify(
        `Procesando ${items.length} documento(s)/URL(s) en segundo plano. Puedes cambiar de pestaña libremente.`
      );

      // Procesar 1 por 1 en segundo plano para que incluso una carpeta de Drive de 20+ documentos nunca tenga timeout
      void (async () => {
        let okCount = 0;
        let chunksTotal = 0;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const jobId = createdJobs[i].id;

          updateIngestJob(jobId, {
            stage: "analyzing",
            detailText: `Leyendo documento ${i + 1} de ${items.length} con Gemini 3.8${
              finalCategory === "__auto__" ? " + categorización IA" : ""
            } y vectorizando...`,
          });

          try {
            const res = await fetch("/api/admin/knowledge/ingest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                driveUrls: item.url,
                titleHint: item.titleHint,
                category: finalCategory,
              }),
            });

            const json = await safeParseJson<{
              ok?: boolean;
              totalChunks?: number;
              importedDocs?: Array<{
                title: string;
                category: string;
                isNewCategory: boolean;
                chunksIndexed: number;
              }>;
            }>(res);

            if (!res.ok || !json.ok) {
              throw new Error(
                json.error || "No se pudo leer o indexar este enlace."
              );
            }

            const firstDoc = json.importedDocs?.[0];
            const assignedCat = (firstDoc?.category || "general").toUpperCase();
            const chunks = json.totalChunks ?? firstDoc?.chunksIndexed ?? 0;
            okCount++;
            chunksTotal += chunks;

            updateIngestJob(jobId, {
              name: firstDoc?.title || item.label,
              stage: "done",
              categoryAssigned: assignedCat,
              isNewCategory: firstDoc?.isNewCategory,
              chunksIndexed: chunks,
              detailText: `Completado · ${chunks} fragmentos · Categoría: ${assignedCat}${
                firstDoc?.isNewCategory ? " (Nueva creada por IA)" : ""
              }`,
            });

            await loadDashboard({ silent: true });
          } catch (err) {
            updateIngestJob(jobId, {
              stage: "error",
              detailText:
                err instanceof Error ? err.message : "Error al leer URL.",
            });
          }
        }

        if (okCount > 0) {
          notify(
            `✅ Lectura de enlaces completada: ${okCount} de ${items.length} indexados (${chunksTotal} fragmentos en Cerebro IA).`
          );
        } else {
          notify(
            `⚠️ No fue posible indexar los enlaces. Revisa el detalle en el monitor.`
          );
        }
      })();
    } finally {
      setIngestStatusText(null);
      setIndexingDoc(false);
    }
  }

  function handleResyncDocUrl(doc: KnowledgeDocSummary) {
    if (!doc.source_url) return;
    const jobId = `resync-${Date.now()}-${doc.id.slice(0, 6)}`;
    setIngestDrawerMinimized(false);
    setIngestJobs((prev) => [
      {
        id: jobId,
        name: doc.title,
        stage: "analyzing",
        detailText: `Re-leyendo URL y regenerando vectores 768d...`,
      },
      ...prev.filter((j) => j.stage !== "done"),
    ]);

    void (async () => {
      try {
        const res = await fetch("/api/admin/knowledge/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            driveUrls: doc.source_url,
            category: doc.category,
          }),
        });
        const json = await safeParseJson<{
          ok?: boolean;
          totalChunks?: number;
        }>(res);
        if (!res.ok || !json.ok) {
          throw new Error(json.error || "No se pudo re-sincronizar la URL.");
        }
        updateIngestJob(jobId, {
          stage: "done",
          chunksIndexed: json.totalChunks ?? 0,
          categoryAssigned: doc.category.toUpperCase(),
          detailText: `Actualizado · ${json.totalChunks ?? 0} fragmentos · Categoría: ${doc.category.toUpperCase()}`,
        });
        notify(`✅ URL actualizada y re-vectorizada: ${doc.title}`);
        await loadDashboard({ silent: true });
      } catch (err) {
        updateIngestJob(jobId, {
          stage: "error",
          detailText:
            err instanceof Error ? err.message : "Error al re-sincronizar.",
        });
      }
    })();
  }

  async function handleLoadDocForEdit(docId: string) {
    const res = await fetch(
      `/api/admin/knowledge?id=${encodeURIComponent(docId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      notify("No se pudo cargar el contenido del documento.");
      return;
    }
    const json = (await res.json()) as {
      document?: {
        id: string;
        title: string;
        category: string;
        raw_content: string;
      };
    };
    if (json.document) {
      setEditingDocId(json.document.id);
      setDocTitle(json.document.title);
      setDocCategory(json.document.category);
      setDocContent(json.document.raw_content);
      setIngestMode("manual");
      notify(`Editando documento: ${json.document.title}`);
    }
  }

  async function handleIndexDocument(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (indexingDoc) return;

    const finalCategory = resolveSelectedCategory();
    if (!finalCategory) return;

    setIndexingDoc(true);
    try {
      const res = await fetch("/api/admin/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: editingDocId || undefined,
          title: docTitle,
          category: finalCategory,
          rawContent: docContent,
        }),
      });
      const json = (await res.json()) as {
        document?: { category?: string };
        chunksIndexed?: number;
        isNewCategory?: boolean;
        error?: string;
      };
      if (!res.ok) {
        notify(json.error || "Error al indexar documento.");
      } else {
        const assignedCat = json.document?.category || finalCategory;
        setEditingDocId(null);
        setDocTitle("");
        setDocContent("");
        setCustomCategory("");
        setDocCategory(finalCategory === "__auto__" ? "__auto__" : assignedCat);
        notify(
          `Documento vectorizado en Supabase (${json.chunksIndexed ?? 0} fragmentos) en categoría "${assignedCat.toUpperCase()}"${
            json.isNewCategory ? " (nueva categoría creada automáticamente)" : ""
          }.`
        );
        await loadDashboard();
      }
    } finally {
      setIndexingDoc(false);
    }
  }

  async function handleDeleteDoc(docId: string) {
    await fetch(`/api/admin/knowledge?id=${encodeURIComponent(docId)}`, {
      method: "DELETE",
    });
    notify("Documento eliminado de la base de conocimiento.");
    await loadDashboard();
  }

  async function handleReviewAction(
    messageId: string,
    payload: {
      markReviewed?: boolean;
      is_gold_dataset?: boolean;
      mentor_ideal_response?: string;
    }
  ) {
    await fetch("/api/admin/reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId, ...payload }),
    });
    notify("Registro de auditoría actualizado.");
    await loadDashboard();
  }

  async function handleSaveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!settingsForm || savingSettings) return;
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          active_provider: settingsForm.active_provider,
          gemini_model: settingsForm.gemini_model,
          claude_model: settingsForm.claude_model,
          whisper_provider: settingsForm.whisper_provider,
          daily_message_limit: Number(settingsForm.daily_message_limit),
          device_swap_cooldown_days: Number(
            settingsForm.device_swap_cooldown_days
          ),
          whop_telegram_group_id:
            settingsForm.whop_telegram_group_id?.trim() || null,
          payment_checkout_url: settingsForm.payment_checkout_url,
          human_support_url: settingsForm.human_support_url,
          system_prompt_compliant: settingsForm.system_prompt_compliant,
          runtime_secrets_updates: secretsDraft,
          pricing_overrides: pricingDraft,
        }),
      });
      if (res.ok) {
        setSecretsDraft({});
        notify(
          "Respaldo funcional creado y nueva configuración / APIs guardadas en vivo en Supabase."
        );
        await loadDashboard();
      } else {
        const errJson = (await res.json()) as { error?: string };
        notify(errJson.error || "Error al guardar la configuración.");
      }
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleRestoreLastWorking() {
    if (restoringSnapshot) return;
    setRestoringSnapshot(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore_last_working" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        restoredFrom?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        notify(json.error || "No se pudo restaurar la versión anterior.");
      } else {
        setSecretsDraft({});
        notify(
          "Valores de APIs, tokens y configuración restaurados a la última versión funcional."
        );
        await loadDashboard();
      }
    } finally {
      setRestoringSnapshot(false);
    }
  }

  async function handleConnectTelegramWebhook(
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    if (connectingTelegram) return;
    setConnectingTelegram(true);
    try {
      const res = await fetch("/api/admin/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicBaseUrl: publicDomainUrl }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        webhookUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        notify(json.error || "No se pudo conectar el webhook de Telegram.");
      } else {
        notify(`Webhook de Telegram activo en: ${json.webhookUrl}`);
        await loadDashboard();
      }
    } finally {
      setConnectingTelegram(false);
    }
  }

  async function handleCopyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copiado al portapapeles.`);
    } catch {
      notify(value);
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-grid-pattern pb-20 text-slate-50">
      {/* Floating Executive Navbar (uiux-designer: top-4 spacing) */}
      <header className="sticky top-4 z-30 mx-auto max-w-7xl px-4 sm:px-6">
        <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-3.5">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-400/30 bg-gradient-to-br from-violet-600 to-indigo-700 font-mono text-sm font-extrabold tracking-tighter text-white shadow-lg shadow-violet-600/30">
              GP
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-extrabold tracking-tight text-white sm:text-lg">
                  GENY PRO
                </h1>
                <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-violet-300">
                  Command Center
                </span>
                {data?.settings && (
                  <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] font-medium text-emerald-300 md:inline-flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                    {data.settings.active_provider === "gemini"
                      ? data.settings.gemini_model
                      : data.settings.claude_model}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                INGRESARIOS · Cluster Supabase{" "}
                <code className="text-slate-300">geny-pro</code> (us-east-1)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/simulator"
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500"
            >
              <Terminal className="h-4 w-4" aria-hidden="true" />
              <span>Simulador WhatsApp / Telegram</span>
            </Link>
            <button
              type="button"
              onClick={() => void loadDashboard()}
              className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors duration-200 hover:border-white/20 hover:bg-white/[0.08]"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin text-violet-400" : ""}`}
                aria-hidden="true"
              />
              <span>Sincronizar</span>
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2 text-xs font-semibold text-slate-400 transition-colors duration-200 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Salir</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
        {/* Live Toast / Status Notification */}
        <div aria-live="polite" className="mb-3 min-h-6">
          {feedbackBanner && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-violet-500/40 bg-violet-500/15 px-4 py-3 text-sm font-medium text-violet-100 shadow-lg shadow-violet-950/50 backdrop-blur">
              <CheckCircle2
                className="h-4 w-4 shrink-0 text-violet-300"
                aria-hidden="true"
              />
              <span>{feedbackBanner}</span>
            </div>
          )}
        </div>

        {/* Banner si falta SUPABASE_SERVICE_ROLE_KEY en .env.local */}
        {data && !data.configured && (
          <section className="mb-8 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="mt-0.5 h-6 w-6 shrink-0 text-amber-400"
                aria-hidden="true"
              />
              <div>
                <h2 className="text-base font-semibold text-amber-200">
                  Último paso de conexión: agrega tu SUPABASE_SERVICE_ROLE_KEY
                </h2>
                <p className="mt-1 text-sm text-amber-100/80">
                  El proyecto exclusivo <strong>geny-pro</strong> (
                  <code>gejvutumbannwaltklez</code>) ya tiene todas las tablas
                  creadas en <code>us-east-1</code>. Copia la llave{" "}
                  <code>service_role</code> desde{" "}
                  <strong>
                    Supabase Dashboard → Project Settings → API Keys
                  </strong>{" "}
                  y pégala en tu archivo <code>.env.local</code>.
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Indicadores de Conexión + Bento KPIs */}
        {data && (
          <>
            <section
              aria-label="Estado de integraciones"
              className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3"
            >
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Activity
                  className="h-4 w-4 text-violet-400"
                  aria-hidden="true"
                />
                <span>Telemetría de Servicios:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  {
                    label: "Supabase pgvector",
                    ok: data.envStatus.supabaseServiceRole,
                  },
                  { label: "Gemini 3.8 API", ok: data.envStatus.geminiKey },
                  {
                    label: "Resend OTP",
                    ok: data.envStatus.resendKey,
                  },
                  { label: "Telegram Bot", ok: data.envStatus.telegramBot },
                  { label: "WhatsApp Cloud", ok: data.envStatus.whatsappCloud },
                  { label: "Claude 5.5", ok: data.envStatus.claudeKey },
                ].map((item) => (
                  <span
                    key={item.label}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-medium ${
                      item.ok
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-white/10 bg-white/[0.03] text-slate-400"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        item.ok
                          ? "bg-emerald-400 shadow-[0_0_6px_#34d399]"
                          : "bg-slate-600"
                      }`}
                    />
                    {item.label}
                  </span>
                ))}
              </div>
            </section>

            <section
              aria-label="Métricas principales"
              className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
            >
              <div className="glass-card-interactive relative overflow-hidden rounded-2xl border-t-2 border-t-emerald-500/60 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Miembros Activos
                  </p>
                  <Users
                    className="h-4 w-4 text-emerald-400"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-3 font-mono text-3xl font-extrabold tabular-nums text-white">
                  {data.stats.activeUsers}
                  <span className="ml-1.5 text-sm font-normal text-slate-400">
                    / {data.stats.totalUsers}
                  </span>
                </p>
                <p className="mt-1 text-[11px] text-emerald-300/80">
                  Con acceso verificado
                </p>
              </div>

              <div className="glass-card-interactive relative overflow-hidden rounded-2xl border-t-2 border-t-rose-500/60 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Suspendidos
                  </p>
                  <Ban className="h-4 w-4 text-rose-400" aria-hidden="true" />
                </div>
                <p className="mt-3 font-mono text-3xl font-extrabold tabular-nums text-rose-400">
                  {data.stats.suspendedUsers}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Bloqueados ($0 gasto IA)
                </p>
              </div>

              <div className="glass-card-interactive relative overflow-hidden rounded-2xl border-t-2 border-t-sky-500/60 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Interacciones Hoy
                  </p>
                  <Cpu className="h-4 w-4 text-sky-400" aria-hidden="true" />
                </div>
                <p className="mt-3 font-mono text-3xl font-extrabold tabular-nums text-white">
                  {data.stats.messagesToday}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Respuestas generadas hoy
                </p>
              </div>

              <div className="glass-card-interactive relative overflow-hidden rounded-2xl border-t-2 border-t-amber-500/60 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Auditoría Semanal
                  </p>
                  <ShieldAlert
                    className="h-4 w-4 text-amber-400"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-3 font-mono text-3xl font-extrabold tabular-nums text-amber-400">
                  {data.stats.pendingReviews}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Alertas GENY COMPLIANT
                </p>
              </div>

              <div className="glass-card-interactive relative overflow-hidden rounded-2xl border-t-2 border-t-violet-500/60 p-5">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Dataset Oro (.jsonl)
                  </p>
                  <Database
                    className="h-4 w-4 text-violet-400"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-3 font-mono text-3xl font-extrabold tabular-nums text-violet-300">
                  {data.stats.goldExamples}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  Curados para Fine-Tuning
                </p>
              </div>
            </section>

            {/* Panel Financiero de Consumo IA y Estimación de Facturación API (Gemini vs Claude) */}
            {data.usageAnalytics && (
              <section
                aria-label="Estimación de consumo y cobro API de inteligencia artificial"
                className="glass-panel mb-8 rounded-3xl border border-emerald-500/20 p-5 sm:p-6"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/35 bg-emerald-500/15 text-emerald-300">
                      <DollarSign className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-extrabold tracking-tight text-white sm:text-base">
                          Estimador de Consumo y Facturación API · GENY PRO
                        </h2>
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase text-emerald-300">
                          Motor Activo:{" "}
                          {data.settings?.active_provider === "claude"
                            ? `Claude (${data.settings.claude_model})`
                            : `Gemini (${data.settings?.gemini_model || "gemini-3.8-flash"})`}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-400">
                        Cálculo automático en tiempo real según tokens de
                        entrada/salida, notas de voz, gráficos y vectorización
                        RAG del motor que respondió cada mensaje.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setTab("settings");
                      if (!dangerZoneUnlocked) {
                        setTimeout(
                          () => dangerDialogRef.current?.showModal(),
                          20
                        );
                      }
                    }}
                    className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-white/12 bg-white/[0.04] px-3 py-1.5 font-mono text-[11px] font-semibold text-slate-200 transition-colors hover:border-violet-400/40 hover:bg-violet-500/15 hover:text-white"
                  >
                    <Settings
                      className="h-3.5 w-3.5 text-violet-300"
                      aria-hidden="true"
                    />
                    <span>Ajustar Tarifas USD/1M</span>
                  </button>
                </div>

                <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Tarjeta 1: Gasto Estimado Mes Actual */}
                  <div className="rounded-2xl border border-emerald-500/25 bg-[#07090F]/90 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                      Cobro Estimado Mes Actual (USD)
                    </p>
                    <p className="mt-2 font-mono text-2xl font-extrabold tabular-nums text-white">
                      {formatUsd(
                        data.usageAnalytics.summary.total_cost_month_usd
                      )}
                    </p>
                    <div className="mt-2 flex flex-col gap-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                      <span>
                        Chat Alumnos:{" "}
                        <strong className="text-slate-200">
                          {formatUsd(
                            data.usageAnalytics.summary.chat_cost_month_usd
                          )}
                        </strong>{" "}
                        ({data.usageAnalytics.summary.messages_month} msgs)
                      </span>
                      <span>
                        Libros / RAG:{" "}
                        <strong className="text-slate-200">
                          {formatUsd(
                            data.usageAnalytics.summary.rag_cost_month_usd
                          )}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Tarjeta 2: Hoy + Histórico */}
                  <div className="rounded-2xl border border-white/10 bg-[#07090F]/90 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Consumo Hoy y Acumulado Total
                    </p>
                    <p className="mt-2 font-mono text-2xl font-extrabold tabular-nums text-sky-300">
                      {formatUsd(
                        data.usageAnalytics.summary.total_cost_today_usd
                      )}
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        hoy
                      </span>
                    </p>
                    <div className="mt-2 flex flex-col gap-0.5 font-mono text-[11px] tabular-nums text-slate-400">
                      <span>
                        Histórico total:{" "}
                        <strong className="text-white">
                          {formatUsd(
                            data.usageAnalytics.summary.total_cost_all_time_usd
                          )}
                        </strong>
                      </span>
                      <span>
                        Volumen:{" "}
                        {formatTokensCompact(
                          data.usageAnalytics.summary.tokens_total
                        )}{" "}
                        tokens ({data.usageAnalytics.summary.messages_total}{" "}
                        msgs)
                      </span>
                    </div>
                  </div>

                  {/* Tarjeta 3: Desglose Google Gemini vs Anthropic Claude */}
                  <div className="rounded-2xl border border-white/10 bg-[#07090F]/90 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Desglose por Proveedor API (Mes)
                    </p>
                    <div className="mt-2.5 space-y-2 font-mono text-xs tabular-nums">
                      <div className="flex items-center justify-between rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-2.5 py-1.5">
                        <span className="font-semibold text-sky-200">
                          Google Gemini
                        </span>
                        <span className="font-bold text-white">
                          {formatUsd(
                            data.usageAnalytics.summary.gemini_month_usd +
                              data.usageAnalytics.summary.rag_cost_month_usd
                          )}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-violet-500/20 bg-violet-500/[0.06] px-2.5 py-1.5">
                        <span className="font-semibold text-violet-200">
                          Anthropic Claude
                        </span>
                        <span className="font-bold text-white">
                          {formatUsd(
                            data.usageAnalytics.summary.claude_month_usd
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Tarjeta 4: Costo Promedio por Alumno y Tarifas */}
                  <div className="rounded-2xl border border-white/10 bg-[#07090F]/90 p-4">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Promedio Mensual / Alumno Activo
                    </p>
                    <p className="mt-2 font-mono text-2xl font-extrabold tabular-nums text-violet-300">
                      {formatUsd(
                        data.usageAnalytics.summary.chat_cost_month_usd /
                          Math.max(1, data.stats.activeUsers)
                      )}
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        / mes
                      </span>
                    </p>
                    <div className="mt-2 flex flex-col gap-0.5 font-mono text-[10px] tabular-nums text-slate-400">
                      <span>
                        Gemini: $
                        {(
                          data.resolvedPricing?.gemini_input_per_1m ?? 0.3
                        ).toFixed(2)}{" "}
                        in · $
                        {(
                          data.resolvedPricing?.gemini_output_per_1m ?? 2.5
                        ).toFixed(2)}{" "}
                        out / 1M
                      </span>
                      <span>
                        Claude: $
                        {(
                          data.resolvedPricing?.claude_sonnet_input_per_1m ??
                          3.0
                        ).toFixed(2)}{" "}
                        in · $
                        {(
                          data.resolvedPricing?.claude_sonnet_output_per_1m ??
                          15.0
                        ).toFixed(2)}{" "}
                        out / 1M
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        {/* Accessible Single-Row Tablist (modern-web-guidance: tabs) */}
        <div
          role="tablist"
          aria-label="Secciones del Centro de Control de GENY PRO"
          className="mb-6 flex overflow-x-auto rounded-2xl border border-white/[0.08] bg-[#0B0E17]/90 p-1.5 backdrop-blur"
        >
          {[
            {
              id: "users",
              label: "Usuarios y Candado 90d",
              icon: Users,
              badge: data?.stats.totalUsers ?? 0,
            },
            {
              id: "knowledge",
              label: "Conocimiento RAG (768d)",
              icon: BookOpen,
              badge: data?.knowledgeDocs.length ?? 0,
            },
            {
              id: "reviews",
              label: "Auditoría & Dataset",
              icon: ShieldAlert,
              badge: data?.stats.pendingReviews ?? 0,
            },
            {
              id: "channels",
              label: "Canales & Webhooks",
              icon: Smartphone,
              badge: null,
            },
            {
              id: "settings",
              label: "Motor IA, APIs & Tokens",
              icon: Settings,
              badge: null,
            },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                id={`${uid}-tab-${item.id}`}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={(e) => {
                  setTab(item.id as typeof tab);
                  e.currentTarget.scrollIntoView({
                    block: "nearest",
                    inline: "nearest",
                  });
                  if (item.id === "settings" && !dangerZoneUnlocked) {
                    setTimeout(() => {
                      dangerDialogRef.current?.showModal();
                    }, 20);
                  }
                }}
                className={`flex min-h-11 flex-none cursor-pointer items-center gap-2.5 rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors duration-200 sm:text-sm ${
                  active
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${active ? "text-violet-400" : "text-slate-400"}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
                {item.badge !== null && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular-nums ${
                      active
                        ? "bg-violet-500/25 text-violet-200"
                        : "bg-white/[0.06] text-slate-400"
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ===================== TAB 1: USUARIOS ===================== */}
        {tab === "users" && (
          <section
            role="tabpanel"
            aria-labelledby={`${uid}-tab-users`}
            className="space-y-5"
          >
            {/* Panel de Filtros Inteligentes Combinables + Exportación CSV */}
            <div className="glass-panel space-y-4 rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Combinaciones rápidas:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setStatusFilter("active");
                      setExpirationFilter("expiring_7d");
                      setSortBy("expires_asc");
                    }}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      expirationFilter === "expiring_7d"
                        ? "border-amber-400/50 bg-amber-500/20 text-amber-200"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    Próximos a vencer (≤ 7d)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanFilter("mensual");
                      setStatusFilter("active");
                      setSortBy("expires_asc");
                    }}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      planFilter === "mensual" && statusFilter === "active"
                        ? "border-violet-400/50 bg-violet-500/20 text-violet-200"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    Solo Mensuales Activos
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlanFilter("reto");
                      setStatusFilter("active");
                      setSortBy("expires_asc");
                    }}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      planFilter === "reto" && statusFilter === "active"
                        ? "border-violet-400/50 bg-violet-500/20 text-violet-200"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    Solo Reto Activos
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExpirationFilter("expired");
                      setSortBy("expires_asc");
                    }}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      expirationFilter === "expired"
                        ? "border-rose-400/50 bg-rose-500/20 text-rose-200"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    Vencidos
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSortBy("cost_desc");
                    }}
                    className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                      sortBy === "cost_desc"
                        ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                        : "border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]"
                    }`}
                  >
                    Mayor Consumo IA
                  </button>
                  {hasActiveUserFilters && (
                    <button
                      type="button"
                      onClick={resetAllUserFilters}
                      className="cursor-pointer rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleExportFilteredCsv}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/15 px-3.5 py-2 text-xs font-bold text-emerald-200 transition-colors duration-200 hover:bg-emerald-500/25"
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    <span>
                      Exportar Filtrado ({filteredUsers.length}) CSV
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => csvDialogRef.current?.showModal()}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/12 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-100 transition-colors duration-200 hover:border-white/25 hover:bg-white/[0.08]"
                  >
                    <Upload
                      className="h-4 w-4 text-amber-400"
                      aria-hidden="true"
                    />
                    <span>Importar CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => createDialogRef.current?.showModal()}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>Alta Manual</span>
                  </button>
                </div>
              </div>

              <search className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <div className="sm:col-span-2">
                  <label
                    htmlFor={`${uid}-search-users`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Buscar (correo, nombre, teléfono, notas)
                  </label>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id={`${uid}-search-users`}
                      name="q"
                      type="search"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="ingresariostech@gmail.com o +57..."
                      className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] pl-10 pr-4 text-xs text-white placeholder:text-slate-500"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-filter-plan`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Plan / Nivel
                  </label>
                  <select
                    id={`${uid}-filter-plan`}
                    value={planFilter}
                    onChange={(e) =>
                      setPlanFilter(e.target.value as typeof planFilter)
                    }
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-xs text-white"
                  >
                    <option value="all">Todos los planes</option>
                    <option value="reto">Solo Reto</option>
                    <option value="mensual">Solo Mensual</option>
                    <option value="anual">Solo Anual</option>
                    <option value="vip">Solo VIP / Becado</option>
                    <option value="equipo">Solo Equipo INGRESARIOS</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-filter-status`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Estado Membresía
                  </label>
                  <select
                    id={`${uid}-filter-status`}
                    name="status"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as typeof statusFilter)
                    }
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-xs text-white"
                  >
                    <option value="all">Todos los estados</option>
                    <option value="active">Activos</option>
                    <option value="past_due">Pago pendiente</option>
                    <option value="canceled">Baja / Cancelados</option>
                    <option value="suspended">Suspendidos</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-filter-exp`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Vencimiento
                  </label>
                  <select
                    id={`${uid}-filter-exp`}
                    value={expirationFilter}
                    onChange={(e) =>
                      setExpirationFilter(
                        e.target.value as typeof expirationFilter
                      )
                    }
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-xs text-white"
                  >
                    <option value="all">Cualquier fecha</option>
                    <option value="expiring_7d">Próximos a vencer (≤ 7 días)</option>
                    <option value="expiring_15d">Próximos a vencer (≤ 15 días)</option>
                    <option value="expiring_30d">Próximos a vencer (≤ 30 días)</option>
                    <option value="expired">Ya vencidos</option>
                    <option value="permanent">Permanentes</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-filter-device`}
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Dispositivos / Orden
                  </label>
                  <select
                    id={`${uid}-filter-device`}
                    value={`${deviceFilter}|${sortBy}`}
                    onChange={(e) => {
                      const [dev, srt] = e.target.value.split("|");
                      setDeviceFilter(dev as typeof deviceFilter);
                      setSortBy(srt as typeof sortBy);
                    }}
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-xs text-white"
                  >
                    <option value="all|created_desc">Todos (Más recientes)</option>
                    <option value="all|cost_desc">
                      Todos (Mayor consumo / costo IA)
                    </option>
                    <option value="all|messages_desc">
                      Todos (Más mensajes enviados)
                    </option>
                    <option value="all|expires_asc">Todos (Vencen primero)</option>
                    <option value="all|name_asc">Todos (Orden A-Z)</option>
                    <option value="with_whatsapp|expires_asc">
                      Con WhatsApp activo
                    </option>
                    <option value="without_whatsapp|created_desc">
                      Sin WhatsApp vinculado
                    </option>
                    <option value="with_telegram|expires_asc">
                      Con Telegram activo
                    </option>
                    <option value="without_telegram|created_desc">
                      Sin Telegram vinculado
                    </option>
                    <option value="swap_locked|created_desc">
                      Con Candado 90d usado
                    </option>
                  </select>
                </div>
              </search>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  Mostrando{" "}
                  <strong className="font-mono text-white">
                    {filteredUsers.length}
                  </strong>{" "}
                  de{" "}
                  <strong className="font-mono text-slate-200">
                    {data?.users.length ?? 0}
                  </strong>{" "}
                  miembros registrados
                </span>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`${uid}-filter-source`}
                    className="text-[11px] text-slate-400"
                  >
                    Origen de alta:
                  </label>
                  <select
                    id={`${uid}-filter-source`}
                    value={sourceFilter}
                    onChange={(e) =>
                      setSourceFilter(e.target.value as typeof sourceFilter)
                    }
                    className="rounded-lg border border-white/10 bg-[#07090F] px-2.5 py-1 font-mono text-[11px] text-slate-200"
                  >
                    <option value="all">Todos (Whop / Stripe / Hotmart / Manual)</option>
                    <option value="whop">Solo Whop</option>
                    <option value="stripe">Solo Stripe</option>
                    <option value="hotmart">Solo Hotmart</option>
                    <option value="csv">Solo Importación CSV</option>
                    <option value="manual">Solo Alta Manual</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Tabla Responsiva Semántica (modern-web-guidance: responsive-table) */}
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="users-table-caption"
              className="table-wrapper"
            >
              <table className="geny-table text-sm">
                <caption id="users-table-caption" className="sr-only">
                  Directorio de alumnos, estado de membresía y dispositivos
                  vinculados en GENY PRO
                </caption>
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="px-5 py-4">Alumno / Correo</th>
                    <th className="px-4 py-4">Plan / Origen</th>
                    <th className="px-4 py-4">Estado</th>
                    <th className="px-4 py-4">Dispositivos (Candado 90d)</th>
                    <th className="px-4 py-4">Consumo IA / Costo</th>
                    <th className="px-4 py-4">Vencimiento</th>
                    <th className="px-5 py-4">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-5 py-12 text-center text-slate-400"
                      >
                        No hay usuarios que coincidan con el filtro actual.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const badge = STATUS_BADGE[u.membership_status];
                      const uUsage = usageByUserMap.get(u.id);
                      const dailyLimit =
                        u.daily_message_override ??
                        data?.settings?.daily_message_limit ??
                        40;
                      const totalTokens =
                        (uUsage?.tokens_in_total ?? 0) +
                        (uUsage?.tokens_out_total ?? 0);
                      return (
                        <tr
                          key={u.id}
                          className="transition-colors duration-150 hover:bg-white/[0.02]"
                        >
                          <th scope="row" className="px-5 py-4 font-medium">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/15 font-mono text-xs font-bold text-violet-200">
                                {getInitials(u.full_name, u.email)}
                              </div>
                              <div>
                                <div className="font-semibold text-white">
                                  {u.full_name || "Alumno INGRESARIOS"}
                                </div>
                                <div className="font-mono text-xs font-normal text-slate-400">
                                  {u.email}
                                </div>
                              </div>
                            </div>
                          </th>
                          <td className="px-4 py-4">
                            <span className="inline-flex items-center rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 font-mono text-xs font-semibold uppercase text-violet-300">
                              {u.plan_tier}
                            </span>
                            <span className="ml-2 font-mono text-xs text-slate-400">
                              · {u.billing_source}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${badge.classes}`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${badge.dot}`}
                              />
                              {badge.label}
                            </span>
                          </td>
                          <td className="px-4 py-4 font-mono text-xs">
                            <div className="flex flex-col gap-1">
                              <span
                                className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 ${
                                  u.whatsapp_phone
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                    : "border-white/10 bg-white/[0.02] text-slate-500"
                                }`}
                              >
                                <Lock
                                  className="h-3 w-3 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>
                                  WA: {u.whatsapp_phone || "Disponible"}
                                </span>
                              </span>
                              <span
                                className={`inline-flex w-fit items-center gap-1.5 rounded-md border px-2 py-0.5 ${
                                  u.telegram_id
                                    ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
                                    : "border-white/10 bg-white/[0.02] text-slate-500"
                                }`}
                              >
                                <Lock
                                  className="h-3 w-3 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>
                                  TG:{" "}
                                  {u.telegram_id
                                    ? u.telegram_username
                                      ? `@${u.telegram_username}`
                                      : u.telegram_id
                                    : "Disponible"}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 font-mono text-xs tabular-nums">
                            {uUsage && uUsage.messages_total > 0 ? (
                              <div className="flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-300">
                                    {formatUsd(uUsage.cost_month_usd)} mes
                                  </span>
                                  <span className="text-[11px] text-slate-400">
                                    ({formatUsd(uUsage.cost_total_usd)} tot)
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-200">
                                  Hoy:{" "}
                                  <strong className="text-white">
                                    {uUsage.messages_today}
                                  </strong>
                                  /{dailyLimit} · Mes: {uUsage.messages_month} ·
                                  Tot: {uUsage.messages_total}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Txt {uUsage.text_count} · Voz{" "}
                                  {uUsage.audio_count} · Img{" "}
                                  {uUsage.image_count} ·{" "}
                                  {formatTokensCompact(totalTokens)} tok
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-500">
                                Sin uso registrado ($0.00)
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-4 font-mono text-xs tabular-nums text-slate-300">
                            {u.expires_at ? (
                              <div className="flex flex-col gap-1">
                                <span>
                                  {new Date(u.expires_at).toLocaleDateString(
                                    "es-CO"
                                  )}
                                </span>
                                {(() => {
                                  const daysLeft = getDaysUntilExpiration(
                                    u.expires_at
                                  );
                                  if (daysLeft === null) return null;
                                  if (daysLeft <= 0) {
                                    return (
                                      <span className="w-fit rounded border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                                        Vencido ({Math.abs(daysLeft)}d)
                                      </span>
                                    );
                                  }
                                  if (daysLeft <= 7) {
                                    return (
                                      <span className="w-fit rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                                        Vence en {daysLeft}d
                                      </span>
                                    );
                                  }
                                  return (
                                    <span className="text-[10px] text-slate-400">
                                      En {daysLeft}d
                                    </span>
                                  );
                                })()}
                              </div>
                            ) : (
                              <span className="text-emerald-300">
                                Permanente
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => openManageUserDialog(u)}
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-violet-500/35 bg-violet-500/15 px-3 py-1.5 text-xs font-semibold text-violet-100 transition-colors duration-200 hover:border-violet-400 hover:bg-violet-500/25"
                              >
                                <Pencil
                                  className="h-3.5 w-3.5 text-violet-300"
                                  aria-hidden="true"
                                />
                                <span>Editar / Ficha</span>
                              </button>
                              {u.membership_status !== "suspended" ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleQuickStatusChange(
                                      u.id,
                                      "suspended"
                                    )
                                  }
                                  className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-semibold text-rose-300 transition-colors duration-200 hover:bg-rose-500/20"
                                >
                                  <Ban
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  <span>Suspender</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleQuickStatusChange(u.id, "active")
                                  }
                                  className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition-colors duration-200 hover:bg-emerald-500/20"
                                >
                                  <CheckCircle2
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  />
                                  <span>Reactivar</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ===================== TAB 2: CONOCIMIENTO RAG ===================== */}
        {tab === "knowledge" && (
          <section
            role="tabpanel"
            aria-labelledby={`${uid}-tab-knowledge`}
            className="grid gap-6 lg:grid-cols-12"
          >
            <div className="glass-panel space-y-5 rounded-3xl p-6 lg:col-span-7">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Indexar Conocimiento Oficial (RAG Vectorial 768-d)
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Extrae texto + interpreta imágenes/gráficos de tus PDFs con{" "}
                    <code>gemini-3.8-flash</code> y vectoriza con{" "}
                    <code>gemini-embedding-001</code>.
                  </p>
                </div>
                <span className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-sky-300">
                  Visión Multimodal + pgvector
                </span>
              </div>

              {/* Selector de modo de carga: Opción A (Archivos), Opción B (Google Drive), Manual/Editar */}
              <div
                role="group"
                aria-label="Método de ingesta de documentos"
                className="grid gap-2.5 sm:grid-cols-3"
              >
                <button
                  type="button"
                  onClick={() => setIngestMode("files")}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors duration-200 ${
                    ingestMode === "files"
                      ? "border-violet-500/50 bg-violet-500/15 text-white"
                      : "border-white/10 bg-[#07090F] text-slate-400 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  <Upload className="h-4 w-4 text-violet-400" aria-hidden="true" />
                  <span>Opción A: Subir PDFs / Docs</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIngestMode("drive")}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors duration-200 ${
                    ingestMode === "drive"
                      ? "border-violet-500/50 bg-violet-500/15 text-white"
                      : "border-white/10 bg-[#07090F] text-slate-400 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  <Globe className="h-4 w-4 text-amber-400" aria-hidden="true" />
                  <span>Opción B: URLs Web / Drive</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIngestMode("manual")}
                  className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors duration-200 ${
                    ingestMode === "manual"
                      ? "border-violet-500/50 bg-violet-500/15 text-white"
                      : "border-white/10 bg-[#07090F] text-slate-400 hover:border-white/20 hover:text-slate-200"
                  }`}
                >
                  <Pencil className="h-4 w-4 text-sky-400" aria-hidden="true" />
                  <span>
                    {editingDocId ? "Editando Documento" : "Texto / Markdown"}
                  </span>
                </button>
              </div>

              {/* Selector de Categoría compartido para los 3 modos */}
              <div>
                <label
                  htmlFor={`${uid}-doc-cat`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Categoría metodológica (aplica a la carga actual)
                </label>
                <select
                  id={`${uid}-doc-cat`}
                  name="category"
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value)}
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 text-sm text-white"
                >
                  <option value="__auto__">
                    Colocar en categoría automáticamente (IA analiza o crea una
                    nueva)
                  </option>
                  <option value="pedem">Método PEDEM y Bitácora</option>
                  <option value="la_rueda">Estrategia La Rueda</option>
                  <option value="indicadores">
                    Indicadores (Reditum Sniper / Geny Trend)
                  </option>
                  <option value="psicotrading">
                    Mentalidad y Psicotrading
                  </option>
                  <option value="faq">Preguntas Frecuentes (FAQ)</option>
                  <option value="general">General INGRESARIOS</option>
                  {Array.from(
                    new Set(
                      (data?.knowledgeDocs || [])
                        .map((d) => d.category)
                        .filter(
                          (c) =>
                            ![
                              "pedem",
                              "la_rueda",
                              "indicadores",
                              "psicotrading",
                              "faq",
                              "general",
                            ].includes(c)
                        )
                    )
                  ).map((customCat) => (
                    <option key={customCat} value={customCat}>
                      {customCat.replace(/_/g, " ").toUpperCase()}
                    </option>
                  ))}
                  <option value="__custom__">+ Crear otra categoría...</option>
                </select>

                {docCategory === "__custom__" && (
                  <div className="mt-2.5">
                    <label
                      htmlFor={`${uid}-doc-custom-cat`}
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-violet-300"
                    >
                      Nombre de la nueva categoría *
                    </label>
                    <input
                      id={`${uid}-doc-custom-cat`}
                      name="customCategory"
                      type="text"
                      required
                      autoFocus
                      value={customCategory}
                      onChange={(e) => setCustomCategory(e.target.value)}
                      placeholder="Ej. Opciones Avanzadas, Smart Money..."
                      className="min-h-11 w-full rounded-xl border border-violet-500/40 bg-[#07090F] px-3.5 text-sm text-white placeholder:text-slate-500"
                    />
                  </div>
                )}
              </div>

              {ingestStatusText && (
                <div className="flex items-center gap-3 rounded-2xl border border-violet-500/40 bg-violet-500/15 p-4 text-xs font-medium text-violet-100">
                  <RefreshCw
                    className="h-4 w-4 shrink-0 animate-spin text-violet-300"
                    aria-hidden="true"
                  />
                  <span>{ingestStatusText}</span>
                </div>
              )}

              {/* ==================== MODO OPCIÓN A: SUBIDA MASIVA DE ARCHIVOS ==================== */}
              {ingestMode === "files" && (
                <form
                  method="POST"
                  action="/api/admin/knowledge/ingest"
                  onSubmit={handleBulkFilesIngest}
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor={`${uid}-file-drop`}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingFiles(true);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isDraggingFiles) setIsDraggingFiles(true);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.currentTarget.contains(e.relatedTarget as Node)) {
                          return;
                        }
                        setIsDraggingFiles(false);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDraggingFiles(false);
                        if (e.dataTransfer?.files?.length) {
                          appendIncomingFiles(Array.from(e.dataTransfer.files));
                        }
                      }}
                      className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-200 ${
                        isDraggingFiles
                          ? "border-emerald-400 bg-emerald-500/10 ring-2 ring-emerald-400/30"
                          : "border-violet-500/35 bg-[#07090F]/90 hover:border-violet-400 hover:bg-violet-500/[0.06]"
                      }`}
                    >
                      <Upload
                        className={`h-8 w-8 ${
                          isDraggingFiles ? "text-emerald-300" : "text-violet-400"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="mt-3 text-sm font-bold text-white">
                        {isDraggingFiles
                          ? "¡Suelta aquí tus archivos para agregarlos a la cola!"
                          : "Arrastra y suelta aquí tus PDFs, Word (.docx), Imágenes o haz clic para explorar"}
                      </span>
                      <span className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                        Soporta libros PDF pesados (hasta 100 MB) y múltiples
                        archivos simultáneos en segundo plano.{" "}
                        <strong className="text-slate-200">
                          Gemini 3.8 Multimodal
                        </strong>{" "}
                        leerá texto, tablas e imágenes.
                      </span>
                      <input
                        id={`${uid}-file-drop`}
                        name="files"
                        type="file"
                        multiple
                        accept=".pdf,.docx,.png,.jpg,.jpeg,.webp,.txt,.md,.csv"
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            appendIncomingFiles(Array.from(e.target.files));
                            e.target.value = "";
                          }
                        }}
                        className="sr-only"
                      />
                    </label>
                  </div>

                  {selectedFiles.length === 1 && (
                    <div>
                      <label
                        htmlFor={`${uid}-single-file-title`}
                        className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                      >
                        Título personalizado (opcional, por defecto usa el
                        nombre del archivo)
                      </label>
                      <input
                        id={`${uid}-single-file-title`}
                        name="customTitle"
                        type="text"
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder={selectedFiles[0].name.replace(
                          /\.[a-zA-Z0-9]+$/,
                          ""
                        )}
                        className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 text-sm text-white"
                      />
                    </div>
                  )}

                  {selectedFiles.length > 0 && (
                    <div className="rounded-2xl border border-white/10 bg-[#07090F] p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-violet-300">
                          Archivos listos para vectorizar ({selectedFiles.length}
                          )
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedFiles([])}
                          className="cursor-pointer text-xs text-slate-400 hover:text-rose-300"
                        >
                          Limpiar lista
                        </button>
                      </div>
                      <ul className="mt-2.5 max-h-40 space-y-1.5 overflow-y-auto font-mono text-xs text-slate-200">
                        {selectedFiles.map((f, idx) => (
                          <li
                            key={`${f.name}-${idx}`}
                            className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5"
                          >
                            <span className="truncate">{f.name}</span>
                            <span className="ml-2 shrink-0 text-slate-400">
                              {f.size >= 1024 * 1024
                                ? `${(f.size / (1024 * 1024)).toFixed(2)} MB`
                                : `${(f.size / 1024).toFixed(0)} KB`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500"
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {selectedFiles.length > 0
                        ? `Subir y Procesar ${selectedFiles.length} Archivo(s) en Segundo Plano`
                        : "Subir y Procesar Archivo(s) en Segundo Plano"}
                    </span>
                  </button>
                </form>
              )}

              {/* ==================== MODO OPCIÓN B: URLS WEB + GOOGLE DRIVE ==================== */}
              {ingestMode === "drive" && (
                <form
                  method="POST"
                  action="/api/admin/knowledge/ingest"
                  onSubmit={handleDriveLinksIngest}
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor={`${uid}-drive-urls`}
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      URLs Web, Documentos de Drive o Carpetas Completas de
                      Google Drive *
                    </label>
                    <textarea
                      id={`${uid}-drive-urls`}
                      name="driveUrls"
                      rows={5}
                      required
                      aria-describedby={`${uid}-drive-urls-help`}
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={driveUrlsText}
                      onChange={(e) => setDriveUrlsText(e.target.value)}
                      placeholder={
                        "Pega una o varias URLs públicas (una por línea):\nhttps://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view\nhttps://drive.google.com/drive/folders/1CarpetaCon20Documentos...\nhttps://docs.google.com/document/d/1LMN.../edit\nhttps://ingresarios.com/..."
                      }
                      className="w-full rounded-2xl border border-white/10 bg-[#07090F] p-4 font-mono text-xs leading-relaxed text-white"
                    />
                    <p
                      id={`${uid}-drive-urls-help`}
                      className="mt-1.5 text-xs text-slate-400"
                    >
                      Soporta tanto la{" "}
                      <strong className="text-slate-200">
                        URL directa de un documento de Google Drive / Docs
                      </strong>{" "}
                      como la{" "}
                      <strong className="text-slate-200">
                        URL de una carpeta pública completa de Google Drive
                      </strong>{" "}
                      (ej. con 20 o más PDFs/Word), además de páginas web.{" "}
                      <code>GENY PRO</code> lista todos los archivos de la
                      carpeta y los procesa uno por uno en segundo plano.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={indexingDoc}
                    className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
                  >
                    <Globe className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {indexingDoc
                        ? "Inspeccionando carpeta/enlaces..."
                        : "Leer Enlaces / Carpeta en Segundo Plano"}
                    </span>
                  </button>
                </form>
              )}

              {/* ==================== MODO MANUAL / EDICIÓN DE DOCUMENTO ==================== */}
              {ingestMode === "manual" && (
                <form
                  method="POST"
                  action="/api/admin/knowledge"
                  onSubmit={handleIndexDocument}
                  className="space-y-4"
                >
                  {editingDocId && (
                    <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200">
                      <span>
                        Modo edición activo: al guardar se regenerarán los
                        vectores de este documento.
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDocId(null);
                          setDocTitle("");
                          setDocContent("");
                        }}
                        className="cursor-pointer font-semibold underline"
                      >
                        Cancelar edición
                      </button>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor={`${uid}-doc-title`}
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      Título del documento
                    </label>
                    <input
                      id={`${uid}-doc-title`}
                      name="title"
                      type="text"
                      required
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      placeholder="Ej. Manual Oficial Método PEDEM v2"
                      className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 text-sm text-white"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor={`${uid}-doc-content`}
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      Contenido técnico / Reglas de mentoría (Markdown)
                    </label>
                    <textarea
                      id={`${uid}-doc-content`}
                      name="rawContent"
                      rows={10}
                      required
                      value={docContent}
                      onChange={(e) => setDocContent(e.target.value)}
                      placeholder="Pega aquí las reglas, definiciones y ejemplos prácticos de INGRESARIOS..."
                      className="w-full rounded-2xl border border-white/10 bg-[#07090F] p-4 text-sm leading-relaxed text-white"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={indexingDoc}
                    className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
                  >
                    <Database className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {indexingDoc
                        ? "Vectorizando en Supabase..."
                        : editingDocId
                          ? "Actualizar Documento y Re-Vectorizar"
                          : "Vectorizar y Guardar en Base de Conocimiento"}
                    </span>
                  </button>
                </form>
              )}
            </div>

            <div className="glass-panel rounded-3xl p-6 lg:col-span-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-4">
                <h2 className="text-lg font-bold text-white">
                  Documentos Indexados ({data?.knowledgeDocs.length ?? 0})
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-emerald-300">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-emerald-400"
                    aria-hidden="true"
                  />
                  Cerebro IA Conectado 768 dims
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {(data?.knowledgeDocs || []).length === 0 ? (
                  <p className="text-sm text-slate-400">
                    Aún no has cargado documentos en la base de conocimiento.
                  </p>
                ) : (
                  data!.knowledgeDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="glass-card-interactive flex items-center justify-between gap-3 rounded-2xl p-4"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md border border-violet-500/30 bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-violet-300">
                            {doc.category}
                          </span>
                          <span className="font-mono text-[11px] text-slate-400">
                            {doc.chunks_count} chunk(s)
                          </span>
                          {doc.source_url && (
                            <a
                              href={doc.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 truncate font-mono text-[11px] text-amber-300/90 hover:underline"
                              title={doc.source_url}
                            >
                              <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span className="max-w-36 truncate">
                                {(() => {
                                  try {
                                    return new URL(doc.source_url).hostname.replace(
                                      /^www\./,
                                      ""
                                    );
                                  } catch {
                                    return "URL";
                                  }
                                })()}
                              </span>
                            </a>
                          )}
                        </div>
                        <p className="mt-1.5 truncate text-sm font-semibold text-white">
                          {doc.title}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {doc.source_url && (
                          <button
                            type="button"
                            disabled={indexingDoc}
                            aria-label={`Re-leer URL de ${doc.title}`}
                            title="Volver a leer esta URL y actualizar vectores"
                            onClick={() => void handleResyncDocUrl(doc)}
                            className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-xl border border-amber-500/25 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-200 transition-colors duration-200 hover:border-amber-400/50 hover:bg-amber-500/20 disabled:opacity-50"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Re-leer</span>
                          </button>
                        )}
                        <button
                          type="button"
                          aria-label={`Ver o editar ${doc.title}`}
                          onClick={() => void handleLoadDocForEdit(doc.id)}
                          className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 text-xs font-semibold text-slate-300 transition-colors duration-200 hover:border-violet-500/40 hover:bg-violet-500/15 hover:text-white"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Ver / Editar</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Eliminar ${doc.title}`}
                          onClick={() => void handleDeleteDoc(doc.id)}
                          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-slate-400 transition-colors duration-200 hover:border-rose-500/40 hover:bg-rose-500/15 hover:text-rose-300"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* ===================== TAB 3: AUDITORÍA Y DATASET ===================== */}
        {tab === "reviews" && (
          <section
            role="tabpanel"
            aria-labelledby={`${uid}-tab-reviews`}
            className="space-y-5"
          >
            <div className="glass-panel flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6">
              <div>
                <h2 className="text-lg font-bold text-white">
                  Auditoría Semanal GENY COMPLIANT + Dataset Propio (.jsonl)
                </h2>
                <p className="mt-1 text-xs text-slate-400 sm:text-sm">
                  Revisa alertas automáticas (solicitud de señales, riesgo
                  emocional o muestreo del 5%) y construye el dataset de
                  entrenamiento de GENY PRO.
                </p>
              </div>
              <a
                href="/api/admin/reviews?export=jsonl"
                className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 px-4 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-amber-500/20 transition-colors duration-200 hover:from-amber-400 hover:to-amber-300"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span>Exportar Dataset Oro (.jsonl)</span>
              </a>
            </div>

            <div className="space-y-4">
              {(data?.reviewMessages || []).length === 0 ? (
                <div className="glass-panel rounded-3xl p-10 text-center text-sm text-slate-400">
                  Aún no hay conversaciones marcadas para revisión o dataset.
                </div>
              ) : (
                data!.reviewMessages.map((m) => (
                  <div key={m.id} className="glass-panel rounded-3xl p-6">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                      <span className="font-mono">
                        Alumno:{" "}
                        <strong className="text-white">
                          {m.geny_users?.full_name ||
                            m.geny_users?.email ||
                            m.user_id}
                        </strong>{" "}
                        · Canal:{" "}
                        <strong className="uppercase text-violet-300">
                          {m.channel}
                        </strong>{" "}
                        · Modelo: {m.model_used}
                        {(m.tokens_in > 0 || m.tokens_out > 0) && (
                          <span className="text-emerald-300">
                            {" "}
                            · {formatTokensCompact(m.tokens_in + m.tokens_out)}{" "}
                            tok ({formatUsd(m.estimated_cost_usd)})
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2">
                        {m.review_reason && (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 font-mono text-[11px] text-amber-300">
                            {m.review_reason}
                          </span>
                        )}
                        {m.reviewed_at && (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[11px] text-emerald-300">
                            Revisado
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-[#07090F] p-4 text-sm text-slate-200">
                        <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase text-slate-400">
                          Mensaje del alumno ({m.input_type})
                        </p>
                        <p className="whitespace-pre-wrap">{m.user_message}</p>
                      </div>
                      <div className="rounded-2xl border border-violet-500/25 bg-violet-950/20 p-4 text-sm text-slate-100">
                        <p className="mb-1.5 font-mono text-[11px] font-semibold uppercase text-violet-300">
                          Respuesta de GENY PRO
                        </p>
                        <p className="whitespace-pre-wrap">
                          {m.assistant_response}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {!m.reviewed_at && (
                        <button
                          type="button"
                          onClick={() =>
                            void handleReviewAction(m.id, {
                              markReviewed: true,
                            })
                          }
                          className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors duration-200 hover:bg-emerald-500"
                        >
                          Aprobar Revisión Semanal
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void handleReviewAction(m.id, {
                            is_gold_dataset: !m.is_gold_dataset,
                          })
                        }
                        className={`cursor-pointer rounded-xl border px-4 py-2 text-xs font-semibold transition-colors duration-200 ${
                          m.is_gold_dataset
                            ? "border-amber-400/50 bg-amber-500/20 text-amber-200"
                            : "border-white/12 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                        }`}
                      >
                        {m.is_gold_dataset
                          ? "★ En Dataset Oro (Quitar)"
                          : "☆ Guardar en Dataset Oro"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* ===================== TAB 4: CANALES & WEBHOOKS ===================== */}
        {tab === "channels" && channelsInfo && (
          <section
            role="tabpanel"
            aria-labelledby={`${uid}-tab-channels`}
            className="space-y-6"
          >
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Tarjeta 1: Telegram Bot (@BotFather) */}
              <div className="glass-panel space-y-5 rounded-3xl p-6">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      1. Telegram Bot (@BotFather)
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Lanzamiento oficial: 20 de noviembre de 2026 (Beta: 16 de
                      noviembre)
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 font-mono text-xs font-semibold ${
                      channelsInfo.telegramBotInfo.ok
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                        : "border-amber-500/30 bg-amber-500/15 text-amber-300"
                    }`}
                  >
                    {channelsInfo.telegramBotInfo.ok
                      ? `@${channelsInfo.telegramBotInfo.username}`
                      : "Pendiente Token"}
                  </span>
                </div>

                <div className="space-y-2 rounded-2xl border border-white/10 bg-[#07090F] p-4 font-mono text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">TELEGRAM_BOT_TOKEN:</span>
                    <span
                      className={
                        channelsInfo.secretsConfigured.telegramToken
                          ? "text-emerald-400"
                          : "text-amber-400"
                      }
                    >
                      {channelsInfo.secretsConfigured.telegramToken
                        ? "Activo (Vercel / Supabase)"
                        : "Falta configurar token"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-400">Webhook actual:</span>
                    <span className="truncate text-slate-200">
                      {channelsInfo.telegramBotInfo.webhookUrl ||
                        "Sin registrar todavía"}
                    </span>
                  </div>
                  {channelsInfo.telegramBotInfo.lastErrorMessage && (
                    <div className="pt-1 text-rose-300">
                      Último aviso Telegram:{" "}
                      {channelsInfo.telegramBotInfo.lastErrorMessage}
                    </div>
                  )}
                </div>

                {(() => {
                  const botUsername =
                    channelsInfo.telegramBotInfo.username ||
                    "GenyProIngresariosBot";
                  const botDirectUrl = `https://t.me/${botUsername}`;

                  return (
                    <div className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.07] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-violet-200">
                            URL Directa del Bot en Telegram
                          </p>
                          <code className="mt-1 block truncate font-mono text-xs text-white select-all">
                            {botDirectUrl}
                          </code>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyText(
                                "URL del Bot de Telegram",
                                botDirectUrl
                              )
                            }
                            className="inline-flex min-h-10 cursor-pointer items-center rounded-xl border border-white/12 bg-white/[0.05] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors duration-200 hover:bg-white/10"
                          >
                            Copiar enlace del Bot
                          </button>

                          <a
                            href={botDirectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-emerald-950/50 transition-colors duration-200 hover:bg-emerald-500"
                          >
                            <span>Abrir Bot en Telegram</span>
                            <ExternalLink
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                            />
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                <form
                  method="POST"
                  action="/api/admin/channels"
                  onSubmit={handleConnectTelegramWebhook}
                  className="space-y-3"
                >
                  <div>
                    <label
                      htmlFor={`${uid}-tg-domain`}
                      className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                    >
                      Dominio Público HTTPS (Vercel / Producción)
                    </label>
                    <input
                      id={`${uid}-tg-domain`}
                      type="url"
                      required
                      autoCorrect="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="https://genypro.ingresarios.ai"
                      value={publicDomainUrl}
                      onChange={(e) => setPublicDomainUrl(e.target.value)}
                      className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-xs text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={connectingTelegram}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-violet-600/25 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
                  >
                    <span>
                      {connectingTelegram
                        ? "Conectando con Telegram..."
                        : "Registrar Webhook en Telegram (1 Clic)"}
                    </span>
                  </button>
                </form>
              </div>

              {/* Tarjeta 2: WhatsApp Cloud API (Meta) */}
              <div className="glass-panel space-y-5 rounded-3xl p-6">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-white">
                      2. WhatsApp Cloud API (Meta)
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Piloto oficial: 30 de noviembre de 2026 · Cumplimiento
                      Meta 2026
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-3 py-1 font-mono text-xs font-semibold ${
                      data?.envStatus.whatsappCloud
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                        : "border-white/15 bg-white/[0.04] text-slate-300"
                    }`}
                  >
                    {data?.envStatus.whatsappCloud
                      ? "Conectado"
                      : "Listo para Meta App"}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-[#07090F] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-400">
                        Callback URL (Meta Developers → WhatsApp → Configuration)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyText(
                            "Callback URL de WhatsApp",
                            `${publicDomainUrl.replace(/\/+$/, "")}/api/webhooks/whatsapp`
                          )
                        }
                        className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-violet-300 hover:bg-white/10"
                      >
                        Copiar URL
                      </button>
                    </div>
                    <p className="mt-1.5 truncate font-mono text-xs text-slate-200">
                      {publicDomainUrl.replace(/\/+$/, "")}
                      /api/webhooks/whatsapp
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#07090F] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-400">
                        Verify Token (WHATSAPP_VERIFY_TOKEN)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyText(
                            "Verify Token de WhatsApp",
                            channelsInfo.secretsConfigured
                              .whatsappVerifyToken ||
                              "ingresarios_geny_verify_2026"
                          )
                        }
                        className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-violet-300 hover:bg-white/10"
                      >
                        Copiar Token
                      </button>
                    </div>
                    <p className="mt-1.5 font-mono text-xs text-emerald-300">
                      {channelsInfo.secretsConfigured.whatsappVerifyToken ||
                        "ingresarios_geny_verify_2026"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Tarjeta 3: Pasarelas de Pago (Whop, Stripe, Hotmart) */}
            <div className="glass-panel rounded-3xl p-6">
              <div className="border-b border-white/10 pb-4">
                <h2 className="text-lg font-bold text-white">
                  3. Webhooks de Pasarelas de Pago (Alta y Suspensión Automática)
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Pega estos endpoints en tus pasarelas para activar o suspender
                  miembros automáticamente en tiempo real.
                </p>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {[
                  {
                    name: "Whop",
                    path: "/api/webhooks/whop",
                    envName: "WHOP_WEBHOOK_SECRET",
                    ok: channelsInfo.secretsConfigured.whopSecret,
                  },
                  {
                    name: "Stripe",
                    path: "/api/webhooks/stripe",
                    envName: "STRIPE_WEBHOOK_SECRET",
                    ok: channelsInfo.secretsConfigured.stripeSecret,
                  },
                  {
                    name: "Hotmart",
                    path: "/api/webhooks/hotmart",
                    envName: "HOTMART_HOTTOK",
                    ok: channelsInfo.secretsConfigured.hotmartHottok,
                  },
                ].map((gw) => {
                  const fullUrl = `${publicDomainUrl.replace(/\/+$/, "")}${gw.path}`;
                  return (
                    <div
                      key={gw.name}
                      className="rounded-2xl border border-white/10 bg-[#07090F] p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-white">
                          {gw.name}
                        </span>
                        <span
                          className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                            gw.ok
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                              : "border-white/10 bg-white/[0.03] text-slate-400"
                          }`}
                        >
                          {gw.envName}
                        </span>
                      </div>
                      <p className="mt-2 truncate font-mono text-xs text-slate-300">
                        {fullUrl}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyText(`Webhook ${gw.name}`, fullUrl)
                        }
                        className="mt-3 w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.04] py-2 text-xs font-semibold text-violet-300 hover:bg-white/[0.08]"
                      >
                        Copiar URL de {gw.name}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ===================== TAB 5: MOTOR IA, APIS Y REGLAS (ZONA DE PELIGRO) ===================== */}
        {tab === "settings" && settingsForm && (
          <form
            role="tabpanel"
            aria-labelledby={`${uid}-tab-settings`}
            method="POST"
            action="/api/admin/settings"
            onSubmit={handleSaveSettings}
            className="space-y-6"
          >
            {/* Banner Permanente de Zona de Peligro + Botón de Restauración 1-Clic */}
            <div className="rounded-3xl border border-rose-500/40 bg-gradient-to-r from-rose-950/50 via-[#0E121D] to-amber-950/30 p-6 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/15 text-rose-300">
                    <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-extrabold uppercase tracking-wide text-rose-200">
                        Zona de Peligro · Configuración Crítica y Llaves API
                      </h2>
                      <span
                        className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase ${
                          dangerZoneUnlocked
                            ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                            : "border-rose-500/40 bg-rose-500/20 text-rose-200"
                        }`}
                      >
                        {dangerZoneUnlocked
                          ? "Edición Desbloqueada"
                          : "Protegido (Solo Lectura)"}
                      </span>
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-300">
                      Alterar las llaves de API, tokens de bots o parámetros del
                      motor puede afectar de inmediato el funcionamiento de{" "}
                      <strong>GENY PRO</strong>. Antes de aplicar cualquier
                      cambio, el sistema guarda automáticamente un respaldo en
                      Supabase para restaurar la última versión funcional en 1
                      clic.
                    </p>
                    <p className="mt-1.5 font-mono text-[11px] text-emerald-300">
                      Última versión funcional respaldada:{" "}
                      {settingsForm.last_snapshot_at
                        ? new Date(
                            settingsForm.last_snapshot_at
                          ).toLocaleString("es-CO")
                        : "Configuración base verificada (.env / Supabase)"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {!dangerZoneUnlocked && (
                    <button
                      type="button"
                      onClick={() => dangerDialogRef.current?.showModal()}
                      className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-xs font-bold text-amber-200 transition-colors duration-200 hover:bg-amber-500/25"
                    >
                      <Unlock className="h-4 w-4" aria-hidden="true" />
                      <span>Desbloquear Edición</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={restoringSnapshot}
                    onClick={() => void handleRestoreLastWorking()}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-xs font-bold text-emerald-200 shadow-lg shadow-emerald-950/40 transition-colors duration-200 hover:bg-emerald-500/25 disabled:opacity-60"
                  >
                    <RotateCcw
                      className={`h-4 w-4 ${restoringSnapshot ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    <span>
                      {restoringSnapshot
                        ? "Restaurando versión funcional..."
                        : "Restaurar a la Última Versión Funcional"}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <fieldset
              disabled={!dangerZoneUnlocked}
              className={`space-y-6 ${!dangerZoneUnlocked ? "opacity-75" : ""}`}
            >
              {/* BÓVEDA DE LLAVES API, TOKENS Y SECRETOS EN SUPABASE */}
              <div className="glass-panel space-y-6 rounded-3xl p-6 sm:p-8">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Bóveda de Llaves API, Tokens y Secretos (Tiempo Real en
                      Supabase)
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Cualquier llave que ingreses aquí se guarda en Supabase y
                      se activa al instante sin tocar el código ni reiniciar el
                      servidor. Si dejas un campo vacío, se conserva su valor
                      actual.
                    </p>
                  </div>
                  <span className="rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1 font-mono text-xs font-semibold text-violet-300">
                    Hot-Reload Activo
                  </span>
                </div>

                {[
                  {
                    groupTitle: "1. Motores de Inteligencia Artificial y Voz",
                    items: [
                      {
                        key: "GOOGLE_GENERATIVE_AI_API_KEY" as ManagedSecretKey,
                        label: "Google Cloud Gemini API Key",
                        hint: "Motor principal gemini-3.8-flash + Embeddings 768d",
                      },
                      {
                        key: "ANTHROPIC_API_KEY" as ManagedSecretKey,
                        label: "Anthropic Claude API Key",
                        hint: "Motor secundario claude-sonnet-5-5",
                      },
                      {
                        key: "GROQ_API_KEY" as ManagedSecretKey,
                        label: "Groq API Key (Whisper Audio)",
                        hint: "Transcripción ultrarrápida de notas de voz",
                      },
                      {
                        key: "OPENAI_API_KEY" as ManagedSecretKey,
                        label: "OpenAI API Key (Whisper Respaldo)",
                        hint: "Respaldo de transcripción de voz",
                      },
                    ],
                  },
                  {
                    groupTitle:
                      "2. Correo Transaccional OTP (Resend / mail.ingresarios.net)",
                    items: [
                      {
                        key: "RESEND_API_KEY" as ManagedSecretKey,
                        label: "Resend API Key (re_...)",
                        hint: "Envío de códigos OTP de 6 dígitos",
                      },
                      {
                        key: "EMAIL_FROM" as ManagedSecretKey,
                        label: "Remitente Oficial (EMAIL_FROM)",
                        hint: "Ej. GENY PRO - INGRESARIOS <genypro@mail.ingresarios.net>",
                        isPlainText: true,
                      },
                    ],
                  },
                  {
                    groupTitle:
                      "3. Canales de Mensajería (Telegram Bot & WhatsApp Cloud API)",
                    items: [
                      {
                        key: "TELEGRAM_BOT_TOKEN" as ManagedSecretKey,
                        label: "Telegram Bot Token (@BotFather)",
                        hint: "Ej. 789123456:AAH...",
                      },
                      {
                        key: "TELEGRAM_WEBHOOK_SECRET" as ManagedSecretKey,
                        label: "Telegram Webhook Secret",
                        hint: "Token secreto para validar llamadas de Telegram",
                      },
                      {
                        key: "WHATSAPP_PHONE_NUMBER_ID" as ManagedSecretKey,
                        label: "WhatsApp Phone Number ID (Meta)",
                        hint: "Identificador numérico del teléfono en Meta Developers",
                        isPlainText: true,
                      },
                      {
                        key: "WHATSAPP_ACCESS_TOKEN" as ManagedSecretKey,
                        label: "WhatsApp Permanent Access Token",
                        hint: "Token de usuario de sistema en Meta Business (EAAG...)",
                      },
                      {
                        key: "WHATSAPP_VERIFY_TOKEN" as ManagedSecretKey,
                        label: "WhatsApp Webhook Verify Token",
                        hint: "Token de verificación en Meta Callback URL",
                        isPlainText: true,
                      },
                    ],
                  },
                  {
                    groupTitle:
                      "4. Pasarelas de Pago (Whop, Stripe y Hotmart)",
                    items: [
                      {
                        key: "WHOP_WEBHOOK_SECRET" as ManagedSecretKey,
                        label: "Whop Webhook Secret",
                        hint: "Firma de validación de membresías Whop",
                      },
                      {
                        key: "STRIPE_WEBHOOK_SECRET" as ManagedSecretKey,
                        label: "Stripe Signing Secret (whsec_...)",
                        hint: "Firma de validación de suscripciones Stripe",
                      },
                      {
                        key: "HOTMART_HOTTOK" as ManagedSecretKey,
                        label: "Hotmart Hottok",
                        hint: "Token de seguridad de webhooks de Hotmart",
                      },
                    ],
                  },
                ].map((group) => (
                  <div key={group.groupTitle} className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-violet-300">
                      {group.groupTitle}
                    </h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {group.items.map((item) => {
                        const meta = data?.secretsMeta?.[item.key];
                        const isVisible =
                          Boolean(item.isPlainText) ||
                          Boolean(visibleSecrets[item.key]);
                        const draftVal = secretsDraft[item.key] ?? "";

                        return (
                          <div
                            key={item.key}
                            className="rounded-2xl border border-white/10 bg-[#07090F] p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label
                                htmlFor={`${uid}-secret-${item.key}`}
                                className="text-xs font-bold text-white"
                              >
                                {item.label}
                              </label>
                              <span
                                className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                                  meta?.source === "supabase"
                                    ? "border-violet-500/40 bg-violet-500/15 text-violet-200"
                                    : meta?.source === "env"
                                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                      : "border-white/10 bg-white/[0.03] text-slate-400"
                                }`}
                              >
                                {meta?.source === "supabase"
                                  ? "Activo (Supabase)"
                                  : meta?.source === "env"
                                    ? "Activo (.env)"
                                    : "Sin configurar"}
                              </span>
                            </div>

                            <p className="mt-1 text-[11px] text-slate-400">
                              {item.hint}
                            </p>

                            <p className="mt-1.5 font-mono text-[11px] text-slate-300">
                              Actual:{" "}
                              <code className="text-emerald-300">
                                {meta?.maskedPreview || "No configurado"}
                              </code>
                            </p>

                            <div className="relative mt-2.5 flex items-center gap-2">
                              <input
                                id={`${uid}-secret-${item.key}`}
                                type={isVisible ? "text" : "password"}
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                value={draftVal}
                                onChange={(e) =>
                                  setSecretsDraft((prev) => ({
                                    ...prev,
                                    [item.key]: e.target.value,
                                  }))
                                }
                                placeholder={
                                  meta?.hasValue
                                    ? "Pegar nuevo valor para reemplazar el actual..."
                                    : "Pegar llave o token aquí..."
                                }
                                className="min-h-10 w-full rounded-xl border border-white/10 bg-[#0B0E17] pl-3 pr-9 font-mono text-xs text-white placeholder:text-slate-500"
                              />
                              {!item.isPlainText && (
                                <button
                                  type="button"
                                  aria-label={`Mostrar u ocultar ${item.label}`}
                                  onClick={() =>
                                    setVisibleSecrets((prev) => ({
                                      ...prev,
                                      [item.key]: !prev[item.key],
                                    }))
                                  }
                                  className="absolute right-2.5 text-slate-400 hover:text-white"
                                >
                                  {isVisible ? (
                                    <EyeOff
                                      className="h-4 w-4"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <Eye
                                      className="h-4 w-4"
                                      aria-hidden="true"
                                    />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="glass-panel space-y-6 rounded-3xl p-6 sm:p-8">
                {/* Radio group para menos de 6 opciones exclusivas (modern-web-guidance: forms) */}
                <fieldset className="space-y-3">
                  <legend className="text-base font-bold text-white">
                    Proveedor Activo del Cerebro de GENY PRO
                  </legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label
                  className={`flex cursor-pointer items-start gap-3.5 rounded-2xl border p-4 transition-colors duration-200 ${
                    settingsForm.active_provider === "gemini"
                      ? "border-violet-500/50 bg-violet-500/10"
                      : "border-white/10 bg-[#07090F] hover:border-white/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="active_provider"
                    value="gemini"
                    checked={settingsForm.active_provider === "gemini"}
                    onChange={() =>
                      setSettingsForm({
                        ...settingsForm,
                        active_provider: "gemini",
                      })
                    }
                    className="mt-1 h-4 w-4 accent-violet-500"
                  />
                  <div>
                    <span className="block text-sm font-bold text-white">
                      Google Gemini 3.8 Flash (Activo c/ Failover)
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                      Multimodal nativo (texto, voz e imágenes de gráficos) con
                      cascada automática a <code>gemini-3.5-flash</code> y{" "}
                      <code>gemini-3.5-flash-lite</code>.
                    </span>
                  </div>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3.5 rounded-2xl border p-4 transition-colors duration-200 ${
                    settingsForm.active_provider === "claude"
                      ? "border-violet-500/50 bg-violet-500/10"
                      : "border-white/10 bg-[#07090F] hover:border-white/20"
                  }`}
                >
                  <input
                    type="radio"
                    name="active_provider"
                    value="claude"
                    checked={settingsForm.active_provider === "claude"}
                    onChange={() =>
                      setSettingsForm({
                        ...settingsForm,
                        active_provider: "claude",
                      })
                    }
                    className="mt-1 h-4 w-4 accent-violet-500"
                  />
                  <div>
                    <span className="block text-sm font-bold text-white">
                      Anthropic Claude 5.5 + Whisper
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-slate-400">
                      Usa Prompt Caching efímero en Claude + transcripción de
                      notas de voz con Groq/OpenAI Whisper.
                    </span>
                  </div>
                </label>
              </div>
            </fieldset>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label
                  htmlFor={`${uid}-gemini-model`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Modelo Gemini
                </label>
                <input
                  id={`${uid}-gemini-model`}
                  type="text"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={settingsForm.gemini_model}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      gemini_model: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-sm text-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`${uid}-claude-model`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Modelo Claude
                </label>
                <input
                  id={`${uid}-claude-model`}
                  type="text"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={settingsForm.claude_model}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      claude_model: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-sm text-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`${uid}-daily-limit`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Mensajes diarios máx. / alumno
                </label>
                <input
                  id={`${uid}-daily-limit`}
                  type="number"
                  min={1}
                  max={1000}
                  value={settingsForm.daily_message_limit}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      daily_message_limit: Number(e.target.value),
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-sm text-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`${uid}-swap-days`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Candado cambio dispositivo (días)
                </label>
                <input
                  id={`${uid}-swap-days`}
                  type="number"
                  min={0}
                  max={365}
                  value={settingsForm.device_swap_cooldown_days}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      device_swap_cooldown_days: Number(e.target.value),
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-sm text-white"
                />
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <div>
                <label
                  htmlFor={`${uid}-checkout-url`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Link de Inscripción / Renovación
                </label>
                <input
                  id={`${uid}-checkout-url`}
                  type="url"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={settingsForm.payment_checkout_url}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      payment_checkout_url: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-xs text-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`${uid}-support-url`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Link de Soporte Humano (Meta Handoff)
                </label>
                <input
                  id={`${uid}-support-url`}
                  type="url"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={settingsForm.human_support_url}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      human_support_url: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-xs text-white"
                />
              </div>

              <div>
                <label
                  htmlFor={`${uid}-whop-group`}
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                >
                  Chat ID Grupo Reto Telegram (Opcional)
                </label>
                <input
                  id={`${uid}-whop-group`}
                  type="text"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="-1001234567890"
                  value={settingsForm.whop_telegram_group_id || ""}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      whop_telegram_group_id: e.target.value,
                    })
                  }
                  className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-xs text-white"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor={`${uid}-compliant-prompt`}
                className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Protocolo Maestro Fijo: GENY COMPLIANT (System Prompt)
              </label>
              <textarea
                id={`${uid}-compliant-prompt`}
                rows={12}
                value={settingsForm.system_prompt_compliant}
                onChange={(e) =>
                  setSettingsForm({
                    ...settingsForm,
                    system_prompt_compliant: e.target.value,
                  })
                }
                className="w-full rounded-2xl border border-white/10 bg-[#07090F] p-4 font-mono text-xs leading-relaxed text-slate-100"
              />
            </div>

            {/* Tarifas Editables USD por 1M de Tokens para Estimación Financiera */}
            <div className="rounded-2xl border border-emerald-500/25 bg-[#07090F]/90 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div>
                  <h4 className="text-sm font-bold text-white">
                    Tarifas de Referencia API para Estimación de Costos (USD /
                    1M Tokens)
                  </h4>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Ajusta estos valores si Google Cloud o Anthropic actualizan
                    sus precios oficiales. Se usan para calcular el costo de
                    cada interacción en tiempo real.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPricingDraft({ ...DEFAULT_AI_PRICING })}
                  className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-[11px] font-semibold text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  Restablecer tarifas oficiales
                </button>
              </div>

              <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-5">
                {(
                  [
                    {
                      key: "gemini_input_per_1m",
                      label: "Gemini Entrada / 1M",
                      step: "0.01",
                    },
                    {
                      key: "gemini_audio_input_per_1m",
                      label: "Gemini Audio / 1M",
                      step: "0.01",
                    },
                    {
                      key: "gemini_output_per_1m",
                      label: "Gemini Salida / 1M",
                      step: "0.05",
                    },
                    {
                      key: "gemini_embedding_per_1m",
                      label: "Embedding 768d / 1M",
                      step: "0.01",
                    },
                    {
                      key: "whisper_note_flat_usd",
                      label: "Nota Voz Whisper (USD)",
                      step: "0.0005",
                    },
                    {
                      key: "claude_sonnet_input_per_1m",
                      label: "Claude Sonnet In / 1M",
                      step: "0.10",
                    },
                    {
                      key: "claude_sonnet_cached_per_1m",
                      label: "Claude Caché (-90%) / 1M",
                      step: "0.05",
                    },
                    {
                      key: "claude_sonnet_output_per_1m",
                      label: "Claude Sonnet Out / 1M",
                      step: "0.50",
                    },
                    {
                      key: "claude_haiku_input_per_1m",
                      label: "Claude Haiku In / 1M",
                      step: "0.05",
                    },
                    {
                      key: "claude_haiku_output_per_1m",
                      label: "Claude Haiku Out / 1M",
                      step: "0.10",
                    },
                  ] as Array<{
                    key: keyof AiPricingConfig;
                    label: string;
                    step: string;
                  }>
                ).map((field) => (
                  <div key={field.key}>
                    <label
                      htmlFor={`${uid}-price-${field.key}`}
                      className="mb-1 block text-[11px] font-semibold text-slate-300"
                    >
                      {field.label}
                    </label>
                    <input
                      id={`${uid}-price-${field.key}`}
                      type="number"
                      min={0}
                      step={field.step}
                      value={pricingDraft[field.key]}
                      onChange={(e) =>
                        setPricingDraft((prev) => ({
                          ...prev,
                          [field.key]: Number(e.target.value),
                        }))
                      }
                      className="min-h-10 w-full rounded-xl border border-white/10 bg-[#0B0E17] px-3 font-mono text-xs tabular-nums text-emerald-300"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4">
              <button
                type="submit"
                disabled={savingSettings}
                className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition-colors duration-200 hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
              >
                <span>
                  {savingSettings
                    ? "Respaldando versión anterior y guardando..."
                    : "Guardar APIs, Tokens y Configuración del Motor"}
                </span>
              </button>

              <button
                type="button"
                disabled={restoringSnapshot}
                onClick={() => void handleRestoreLastWorking()}
                className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-xs font-bold text-emerald-200 transition-colors duration-200 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                <span>Restaurar a la Última Versión Funcional</span>
              </button>
            </div>
              </div>
            </fieldset>
          </form>
        )}
      </main>

      {/* ============== DIALOG 0: ALERTA DE ZONA DE PELIGRO (APIS & MOTOR) ============== */}
      <dialog
        ref={dangerDialogRef}
        aria-labelledby={`${uid}-danger-dialog-title`}
        className="glass-panel m-auto w-full max-w-lg rounded-3xl border border-rose-500/50 p-6 text-slate-100 shadow-2xl shadow-rose-950/70"
      >
        <div className="flex items-start gap-3.5 border-b border-white/10 pb-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-rose-500/40 bg-rose-500/20 text-rose-300">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <h2
              id={`${uid}-danger-dialog-title`}
              className="text-lg font-extrabold text-rose-200"
            >
              ⚠️ Cuidado: Zona de Peligro
            </h2>
            <p className="mt-0.5 font-mono text-xs text-rose-300/90">
              Llaves API, Tokens de Bots y Configuración Crítica
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-200">
          <p>
            Estás entrando a la sección donde se controlan las{" "}
            <strong className="text-white">
              llaves de API (Gemini, Claude, Resend), tokens de Telegram y
              WhatsApp, secretos de pasarelas de pago
            </strong>{" "}
            y el protocolo central de <strong>GENY PRO</strong>.
          </p>
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-100">
            <strong>Importante:</strong> Alterar estos valores con llaves
            incorrectas puede interrumpir el funcionamiento del sistema en vivo.
            Si necesitas revertir un cambio, utiliza el botón{" "}
            <strong className="text-emerald-300">
              &ldquo;Restaurar a la Última Versión Funcional&rdquo;
            </strong>{" "}
            que encontrarás en la parte superior.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => {
              dangerDialogRef.current?.close();
              setTab("users");
            }}
            className="min-h-11 cursor-pointer rounded-xl border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10"
          >
            Salir a Zona Segura
          </button>
          <button
            type="button"
            onClick={() => {
              setDangerZoneUnlocked(true);
              dangerDialogRef.current?.close();
            }}
            className="min-h-11 cursor-pointer rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-rose-600/30 hover:from-rose-500 hover:to-amber-500"
          >
            Entiendo el riesgo, desbloquear edición
          </button>
        </div>
      </dialog>

      {/* ============== DIALOG 1: ALTA MANUAL (native <dialog>) ============== */}
      <dialog
        ref={createDialogRef}
        aria-labelledby={`${uid}-create-dialog-title`}
        className="glass-panel m-auto w-full max-w-lg rounded-3xl p-6 text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h2 id={`${uid}-create-dialog-title`} className="text-lg font-bold">
            Alta Manual de Alumno / Miembro
          </h2>
          <button
            type="button"
            aria-label="Cerrar ventana"
            onClick={() => createDialogRef.current?.close()}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form
          method="POST"
          action="/api/admin/users"
          onSubmit={handleCreateUser}
          className="mt-5 space-y-4"
        >
          <div>
            <label
              htmlFor={`${uid}-new-email`}
              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
            >
              Correo electrónico (obligatorio)
            </label>
            <input
              id={`${uid}-new-email`}
              type="email"
              required
              autoFocus
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 text-sm text-white"
            />
          </div>

          <div>
            <label
              htmlFor={`${uid}-new-name`}
              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
            >
              Nombre completo
            </label>
            <input
              id={`${uid}-new-name`}
              type="text"
              autoComplete="name"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 text-sm text-white"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor={`${uid}-new-phone`}
                className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                WhatsApp (Opcional, ej. +57300...)
              </label>
              <input
                id={`${uid}-new-phone`}
                type="tel"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                value={newUserPhone}
                onChange={(e) => setNewUserPhone(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 font-mono text-sm text-white"
              />
            </div>

            <div>
              <label
                htmlFor={`${uid}-new-plan`}
                className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                Plan / Nivel
              </label>
              <select
                id={`${uid}-new-plan`}
                value={newUserPlan}
                onChange={(e) => {
                  const nextPlan = e.target.value as PlanTier;
                  setNewUserPlan(nextPlan);
                  if (nextPlan === "mensual") {
                    setNewUserExpires(getOneMonthFromTodayDateStr());
                  } else if (nextPlan === "anual") {
                    setNewUserExpires(getOneYearFromTodayDateStr());
                  } else if (nextPlan === "equipo") {
                    setNewUserExpires("");
                  }
                }}
                className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 text-sm text-white"
              >
                <option value="reto">Reto</option>
                <option value="mensual">Mensual</option>
                <option value="anual">Anual</option>
                <option value="vip">VIP / Becado</option>
                <option value="equipo">Equipo INGRESARIOS</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor={`${uid}-new-exp`}
              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
            >
              {newUserPlan === "equipo"
                ? "Fecha de vencimiento (Permanente)"
                : newUserPlan === "mensual"
                  ? "Fecha de vencimiento (Automático: +1 mes desde hoy)"
                  : "Fecha de vencimiento (definida por Admin) *"}
            </label>
            {newUserPlan === "equipo" ? (
              <input
                id={`${uid}-new-exp`}
                type="text"
                disabled
                value="Permanente (Equipo INGRESARIOS)"
                className="min-h-11 w-full cursor-not-allowed rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 font-mono text-sm font-semibold text-emerald-300"
              />
            ) : (
              <input
                id={`${uid}-new-exp`}
                type="date"
                required={newUserPlan === "reto" || newUserPlan === "vip"}
                readOnly={newUserPlan === "mensual"}
                value={
                  newUserPlan === "mensual"
                    ? getOneMonthFromTodayDateStr()
                    : newUserExpires
                }
                onChange={(e) => setNewUserExpires(e.target.value)}
                className={`min-h-11 w-full rounded-xl border px-3.5 text-sm text-white ${
                  newUserPlan === "mensual"
                    ? "cursor-not-allowed border-violet-500/40 bg-violet-500/10 font-mono text-violet-200"
                    : "border-white/10 bg-[#07090F]"
                }`}
              />
            )}
          </div>

          <div>
            <label
              htmlFor={`${uid}-new-notes`}
              className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
            >
              Notas internas
            </label>
            <input
              id={`${uid}-new-notes`}
              type="text"
              value={newUserNotes}
              onChange={(e) => setNewUserNotes(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3.5 text-sm text-white"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => createDialogRef.current?.close()}
              className="min-h-11 cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingUser}
              className="min-h-11 cursor-pointer rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
            >
              {savingUser ? "Guardando..." : "Crear / Actualizar Miembro"}
            </button>
          </div>
        </form>
      </dialog>

      {/* ============== DIALOG 2: IMPORTACIÓN CSV (native <dialog>) ============== */}
      <dialog
        ref={csvDialogRef}
        aria-labelledby={`${uid}-csv-dialog-title`}
        className="glass-panel m-auto w-full max-w-xl rounded-3xl p-6 text-slate-100"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-4">
          <h2 id={`${uid}-csv-dialog-title`} className="text-lg font-bold">
            Importación Masiva CSV (Alumnos del Reto / Membresías)
          </h2>
          <button
            type="button"
            aria-label="Cerrar ventana"
            onClick={() => csvDialogRef.current?.close()}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Formato por línea:{" "}
          <code className="text-violet-300">
            email,nombre,telefono_opcional,plan_opcional,yyyy-mm-dd
          </code>
        </p>
        <form
          method="POST"
          action="/api/admin/users"
          onSubmit={handleCsvImport}
          className="mt-4 space-y-4"
        >
          <div>
            <label
              htmlFor={`${uid}-csv-area`}
              className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-300"
            >
              Pega aquí las filas CSV
            </label>
            <textarea
              id={`${uid}-csv-area`}
              rows={8}
              required
              autoFocus
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={
                "carlos@gmail.com,Carlos Ruiz,+573001234567,reto,2026-12-31\nana@hotmail.com,Ana Gómez,,mensual,"
              }
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-[#07090F] p-3.5 font-mono text-xs text-white"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => csvDialogRef.current?.close()}
              className="min-h-11 cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={importingCsv}
              className="min-h-11 cursor-pointer rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
            >
              {importingCsv ? "Importando..." : "Importar Lista"}
            </button>
          </div>
        </form>
      </dialog>

      {/* ============== DIALOG 3: GESTIONAR FICHA + HISTORIAL DISPOSITIVOS ============== */}
      <dialog
        ref={manageDialogRef}
        aria-labelledby={`${uid}-manage-dialog-title`}
        className="glass-panel m-auto w-full max-w-2xl rounded-3xl p-6 text-slate-100"
      >
        {selectedUser && (
          <div>
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2
                  id={`${uid}-manage-dialog-title`}
                  className="text-lg font-bold text-white"
                >
                  Editar Miembro: {selectedUser.full_name || selectedUser.email}
                </h2>
                <p className="font-mono text-xs text-slate-400">
                  ID: {selectedUser.id} · Origen: {selectedUser.billing_source}
                </p>
              </div>
              <button
                type="button"
                aria-label="Cerrar ventana"
                onClick={() => manageDialogRef.current?.close()}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form
              method="POST"
              action="/api/admin/users"
              onSubmit={handleSaveSelectedUser}
              className="mt-5 space-y-4"
            >
              {/* Datos personales y de contacto editables */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${uid}-edit-name`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Nombre completo
                  </label>
                  <input
                    id={`${uid}-edit-name`}
                    type="text"
                    autoComplete="name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Nombre del alumno"
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-sm text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-edit-email`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Correo electrónico *
                  </label>
                  <input
                    id={`${uid}-edit-email`}
                    type="email"
                    required
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 font-mono text-sm text-white"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor={`${uid}-edit-phone`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    WhatsApp (E.164)
                  </label>
                  <input
                    id={`${uid}-edit-phone`}
                    type="tel"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="+57300..."
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 font-mono text-sm text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-edit-tg-id`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Telegram ID
                  </label>
                  <input
                    id={`${uid}-edit-tg-id`}
                    type="text"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={editTelegramId}
                    onChange={(e) => setEditTelegramId(e.target.value)}
                    placeholder="Ej. 987654321"
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 font-mono text-sm text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-edit-tg-user`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Usuario Telegram
                  </label>
                  <input
                    id={`${uid}-edit-tg-user`}
                    type="text"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={editTelegramUsername}
                    onChange={(e) => setEditTelegramUsername(e.target.value)}
                    placeholder="@usuario"
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 font-mono text-sm text-white"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label
                    htmlFor={`${uid}-edit-status`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Estado de membresía
                  </label>
                  <select
                    id={`${uid}-edit-status`}
                    value={editStatus}
                    onChange={(e) =>
                      setEditStatus(e.target.value as MembershipStatus)
                    }
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-sm text-white"
                  >
                    <option value="active">Activo</option>
                    <option value="past_due">Pago pendiente</option>
                    <option value="canceled">Baja / Cancelado</option>
                    <option value="suspended">Suspendido</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-edit-plan`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Plan / Nivel
                  </label>
                  <select
                    id={`${uid}-edit-plan`}
                    value={editPlan}
                    onChange={(e) => {
                      const nextPlan = e.target.value as PlanTier;
                      setEditPlan(nextPlan);
                      if (nextPlan === "mensual") {
                        setEditExpires(getOneMonthFromTodayDateStr());
                      } else if (nextPlan === "anual") {
                        setEditExpires(getOneYearFromTodayDateStr());
                      } else if (nextPlan === "equipo") {
                        setEditExpires("");
                      }
                    }}
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-sm text-white"
                  >
                    <option value="reto">Reto</option>
                    <option value="mensual">Mensual</option>
                    <option value="anual">Anual</option>
                    <option value="vip">VIP / Becado</option>
                    <option value="equipo">Equipo INGRESARIOS</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-edit-exp`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    {editPlan === "equipo"
                      ? "Vencimiento (Permanente)"
                      : editPlan === "mensual"
                        ? "Vencimiento (+1 mes)"
                        : "Vencimiento (Admin) *"}
                  </label>
                  {editPlan === "equipo" ? (
                    <input
                      id={`${uid}-edit-exp`}
                      type="text"
                      disabled
                      value="Permanente"
                      className="min-h-11 w-full cursor-not-allowed rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 font-mono text-xs font-semibold text-emerald-300"
                    />
                  ) : (
                    <input
                      id={`${uid}-edit-exp`}
                      type="date"
                      required={editPlan === "reto" || editPlan === "vip"}
                      readOnly={editPlan === "mensual"}
                      value={
                        editPlan === "mensual"
                          ? getOneMonthFromTodayDateStr()
                          : editExpires
                      }
                      onChange={(e) => setEditExpires(e.target.value)}
                      className={`min-h-11 w-full rounded-xl border px-3 text-sm text-white ${
                        editPlan === "mensual"
                          ? "cursor-not-allowed border-violet-500/40 bg-violet-500/10 font-mono text-violet-200"
                          : "border-white/10 bg-[#07090F]"
                      }`}
                    />
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${uid}-edit-suspend-reason`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Motivo de suspensión (si aplica)
                  </label>
                  <input
                    id={`${uid}-edit-suspend-reason`}
                    type="text"
                    value={editSuspendReason}
                    onChange={(e) => setEditSuspendReason(e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-sm text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${uid}-edit-notes`}
                    className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-300"
                  >
                    Notas de seguimiento
                  </label>
                  <input
                    id={`${uid}-edit-notes`}
                    type="text"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-white/10 bg-[#07090F] px-3 text-sm text-white"
                  />
                </div>
              </div>

              {/* Telemetría Individual de Consumo IA y Costo API del Alumno */}
              <div className="rounded-2xl border border-emerald-500/25 bg-[#07090F] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-300">
                    <DollarSign className="h-4 w-4" aria-hidden="true" />
                    <span>
                      Consumo IA y Costo Estimado del Alumno (GENY PRO)
                    </span>
                  </p>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    Última consulta:{" "}
                    {selectedUserUsage?.last_interaction_at
                      ? new Date(
                          selectedUserUsage.last_interaction_at
                        ).toLocaleString("es-CO")
                      : "Sin mensajes aún"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2.5 sm:grid-cols-4 font-mono text-xs tabular-nums">
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <p className="text-[10px] uppercase text-slate-400">
                      Costo Mes / Total
                    </p>
                    <p className="mt-1 font-bold text-emerald-300">
                      {formatUsd(selectedUserUsage?.cost_month_usd)}
                      <span className="ml-1 font-normal text-slate-400">
                        / {formatUsd(selectedUserUsage?.cost_total_usd)}
                      </span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <p className="text-[10px] uppercase text-slate-400">
                      Mensajes (Hoy / Mes / Tot)
                    </p>
                    <p className="mt-1 font-bold text-white">
                      {selectedUserUsage?.messages_today ?? 0} /{" "}
                      {selectedUserUsage?.messages_month ?? 0} /{" "}
                      {selectedUserUsage?.messages_total ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <p className="text-[10px] uppercase text-slate-400">
                      Modalidades Usadas
                    </p>
                    <p className="mt-1 text-slate-200">
                      Txt {selectedUserUsage?.text_count ?? 0} · Voz{" "}
                      {selectedUserUsage?.audio_count ?? 0} · Img{" "}
                      {selectedUserUsage?.image_count ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                    <p className="text-[10px] uppercase text-slate-400">
                      Gemini vs Claude
                    </p>
                    <p className="mt-1 text-slate-200">
                      G: {formatUsd(selectedUserUsage?.gemini_cost_usd)} · C:{" "}
                      {formatUsd(selectedUserUsage?.claude_cost_usd)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Acciones de Candado Anti-Piratería (90 días) */}
              <div className="rounded-2xl border border-white/10 bg-[#07090F] p-4">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-300">
                  <Smartphone className="h-4 w-4" aria-hidden="true" />
                  <span>Control de Dispositivos y Candado de 90 días</span>
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDeviceAction("unlink_whatsapp")}
                    className="cursor-pointer rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
                  >
                    Desvincular WhatsApp ({selectedUser.whatsapp_phone || "—"})
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeviceAction("unlink_telegram")}
                    className="cursor-pointer rounded-xl border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
                  >
                    Desvincular Telegram ({selectedUser.telegram_id || "—"})
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleDeviceAction("reset_swap_cooldown")
                    }
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
                  >
                    <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Liberar Candado de 90 días</span>
                  </button>
                </div>

                {/* Historial de teléfonos/dispositivos anteriores respaldados y bloqueados */}
                <div className="mt-4 border-t border-white/10 pt-3">
                  <p className="text-xs font-semibold text-slate-400">
                    Historial de Dispositivos Respaldados (
                    {selectedUserHistory.length}):
                  </p>
                  {selectedUserHistory.length === 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Sin cambios de dispositivo registrados todavía.
                    </p>
                  ) : (
                    <ul className="mt-2 max-h-36 space-y-1.5 overflow-y-auto font-mono text-xs text-slate-300">
                      {selectedUserHistory.map((h) => (
                        <li
                          key={h.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5"
                        >
                          <span>
                            <strong className="uppercase text-violet-300">
                              {h.channel}
                            </strong>
                            : {h.previous_identifier || "Ninguno"} →{" "}
                            <strong className="text-white">
                              {h.new_identifier || "Desvinculado"}
                            </strong>{" "}
                            ({h.action_type})
                          </span>
                          <span className="text-rose-300">
                            Anterior: {h.previous_status} ·{" "}
                            {new Date(h.created_at).toLocaleDateString("es-CO")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void handleDeleteSelectedUser()}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Eliminar miembro</span>
                </button>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => manageDialogRef.current?.close()}
                    className="min-h-11 cursor-pointer rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/10"
                  >
                    Cerrar
                  </button>
                  <button
                    type="submit"
                    disabled={updatingSelected}
                    className="min-h-11 cursor-pointer rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
                  >
                    {updatingSelected ? "Guardando..." : "Guardar Cambios"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </dialog>

      {/* Monitor persistente de carga y vectorización RAG en segundo plano (visible al cambiar de pestaña) */}
      {ingestJobs.length > 0 &&
        (() => {
          const doneCount = ingestJobs.filter((j) => j.stage === "done").length;
          const errorCount = ingestJobs.filter(
            (j) => j.stage === "error"
          ).length;
          const finishedCount = doneCount + errorCount;
          const totalCount = ingestJobs.length;

          return (
            <aside
              aria-label="Monitor de carga y vectorización de conocimiento"
              className="fixed right-4 bottom-4 z-40 w-[min(450px,calc(100vw-2rem))] rounded-2xl border border-violet-500/35 bg-[#0A0D16]/95 p-4 shadow-2xl shadow-black/80 backdrop-blur-xl"
            >
              <p role="status" aria-live="polite" className="sr-only">
                {hasActiveIngestJobs
                  ? `Procesando documentos en segundo plano: ${finishedCount} de ${totalCount} finalizados.`
                  : `Procesamiento en segundo plano finalizado: ${doneCount} completados y ${errorCount} con error.`}
              </p>

              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {hasActiveIngestJobs ? (
                    <RefreshCw
                      className="h-4 w-4 shrink-0 animate-spin text-violet-300"
                      aria-hidden="true"
                    />
                  ) : errorCount > 0 && doneCount === 0 ? (
                    <AlertTriangle
                      className="h-4 w-4 shrink-0 text-rose-400"
                      aria-hidden="true"
                    />
                  ) : (
                    <CheckCircle2
                      className="h-4 w-4 shrink-0 text-emerald-400"
                      aria-hidden="true"
                    />
                  )}
                  <div>
                    <p className="text-xs font-extrabold tracking-tight text-white">
                      {hasActiveIngestJobs
                        ? `GENY PRO · Procesando (${finishedCount}/${totalCount})`
                        : `GENY PRO · Carga Finalizada (${doneCount}/${totalCount})`}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {hasActiveIngestJobs
                        ? "Sigue activo en 2.º plano aunque cambies de pestaña"
                        : errorCount > 0
                          ? `${doneCount} indexado(s) · ${errorCount} con alerta`
                          : "Todos los documentos quedaron vectorizados en Supabase (768d)"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-expanded={!ingestDrawerMinimized}
                    aria-controls={`${uid}-ingest-drawer-body`}
                    onClick={() => setIngestDrawerMinimized((prev) => !prev)}
                    className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/10"
                  >
                    {ingestDrawerMinimized ? "Ver detalle" : "Minimizar"}
                  </button>
                  {!hasActiveIngestJobs && (
                    <button
                      type="button"
                      onClick={() => setIngestJobs([])}
                      aria-label="Cerrar monitor de procesamiento"
                      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3">
                <progress
                  className="geny-progress"
                  value={finishedCount}
                  max={totalCount}
                  aria-label="Progreso total de la cola de documentos"
                />
              </div>

              <div
                id={`${uid}-ingest-drawer-body`}
                hidden={ingestDrawerMinimized}
                className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1"
              >
                {ingestJobs.map((job) => (
                  <div
                    key={job.id}
                    className="rounded-xl border border-white/[0.08] bg-[#06080E]/90 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="truncate text-xs font-semibold text-white"
                        title={job.name}
                      >
                        {job.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${
                          job.stage === "done"
                            ? "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                            : job.stage === "error"
                              ? "border border-rose-500/30 bg-rose-500/15 text-rose-300"
                              : job.stage === "uploading"
                                ? "border border-sky-500/30 bg-sky-500/15 text-sky-300"
                                : job.stage === "analyzing"
                                  ? "border border-violet-500/30 bg-violet-500/15 text-violet-300"
                                  : "border border-white/10 bg-white/[0.05] text-slate-400"
                        }`}
                      >
                        {job.stage === "queued" && "En cola"}
                        {job.stage === "uploading" &&
                          `Subiendo ${job.uploadPercent ?? 0}%`}
                        {job.stage === "analyzing" &&
                          (typeof job.analyzePercent === "number"
                            ? `Analizando ${job.analyzePercent}%`
                            : "Analizando IA")}
                        {job.stage === "done" && "Completado"}
                        {job.stage === "error" && "Error"}
                      </span>
                    </div>

                    {(job.stage === "uploading" ||
                      job.stage === "analyzing") && (
                      <div className="mt-2">
                        {job.stage === "uploading" ? (
                          <progress
                            className="geny-progress"
                            value={job.uploadPercent ?? 0}
                            max={100}
                            aria-label={`Subiendo ${job.name}`}
                          />
                        ) : typeof job.analyzePercent === "number" ? (
                          <progress
                            className="geny-progress"
                            value={job.analyzePercent}
                            max={100}
                            aria-label={`Analizando ${job.name}`}
                          />
                        ) : (
                          <progress
                            className="geny-progress"
                            max={100}
                            aria-label={`Analizando y vectorizando ${job.name}`}
                          />
                        )}
                      </div>
                    )}

                    <p
                      className={`mt-1.5 text-[11px] leading-snug ${
                        job.stage === "error"
                          ? "text-rose-300"
                          : job.stage === "done"
                            ? "text-emerald-200/90"
                            : "text-slate-400"
                      }`}
                    >
                      {job.detailText}
                    </p>
                  </div>
                ))}
              </div>
            </aside>
          );
        })()}
    </div>
  );
}
