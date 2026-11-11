# Estado Actual y Memoria del Proyecto — GENY PRO (INGRESARIOS)

**Última actualización:** 11 de noviembre de 2026  
**Directorio del proyecto:** `/Users/josuegarcia/Antigravity/GENY MODELO`  
**Dominio en Producción (Vercel `iad1`):** `https://genypro.ingresarios.ai/`  
**Repositorio GitHub:** `https://github.com/ingresarios-ai/geny-pro-wt` (`main`)  
**Proyecto Supabase conectado:** `geny-pro` (`gejvutumbannwaltklez`, región `us-east-1`)  

---

## 1. Resumen de Todo lo Construido y Conectado en Supabase

### A. Base de Datos y Seguridad en Supabase (`gejvutumbannwaltklez`)
Todas las tablas están creadas en producción con **Row Level Security (RLS)** activado (0 alertas de seguridad):
1. `public.geny_users`: Miembros, planes (`reto`, `mensual`, `vip`, `equipo`), estado (`active`, `expired`, `suspended`), dispositivos vinculados y fechas del candado de 90 días.
2. `public.geny_device_history`: Historial inmutable de teléfonos WhatsApp y cuentas de Telegram revocadas al cambiar de dispositivo o editar ficha.
3. `public.geny_otp_codes`: Códigos OTP de 6 dígitos con expiración de 15 minutos para validar titularidad por correo.
4. `public.geny_sessions` y `public.geny_messages`: Memoria conversacional por alumno (ventana de 10 mensajes) y auditoría semanal **`GENY COMPLIANT`** + curación de **Dataset Oro (`.jsonl`)**.
5. `public.geny_knowledge_documents` y `public.geny_knowledge_chunks`: Base de conocimiento vectorial a **768 dimensiones** (`pgvector` + búsqueda semántica híbrida `search_geny_knowledge`) con soporte para categorías personalizadas.
6. `public.geny_settings` y `public.geny_settings_snapshots`: Configuración en vivo del motor IA, prompts, bóveda de secretos (`runtime_secrets`) y respaldos automáticos para restauración en 1 clic (`previous_working_snapshot`).
7. `public.geny_payment_events`: Registro de webhooks de Whop, Stripe y Hotmart.

### B. Panel Administrativo (`/admin`) — `src/components/admin/AdminDashboardClient.tsx`
- **Branding `GENY PRO`:** Monograma geométrico `GP` (sin estrellitas genéricas) y nombre `GENY PRO` unificado en toda la plataforma.
- **Gestión Completa de Usuarios y Candado 90d:**
  - Creación manual con reglas de vencimiento por plan (`mensual` = +1 mes automático, `equipo` = permanente, `reto` y `vip` = fecha manual obligatoria).
  - Modal **`Editar / Ficha`** para modificar nombre, correo, teléfono WhatsApp (E.164), Telegram ID/`@username`, plan, estado, fecha de vencimiento, desvinculación de dispositivos y reseteo del candado de 90 días.
  - **Filtros Inteligentes Combinables:** Por Plan, Vencimiento (`Por vencer ≤ 7d / 15d / 30d`, `Vencidos`, `Permanentes`), Estado, Dispositivos / Candado 90d, Origen y Ordenamiento inteligente.
  - **Exportación CSV Dinámica:** Botón **`Exportar Filtrado (X) CSV`** que descarga en Excel exactamente la combinación de filtros activa.
- **Conocimiento RAG (`Cerebro IA Conectado 768 dims`):**
  - Selector con **Categorización Automática IA por defecto** (`Colocar en categoría automáticamente (IA analiza o crea una nueva)`), categorías existentes y `+ Crear otra categoría...`.
  - **Opción A (Drag & Drop + Libros Pesados hasta 100 MB):** Subida directa firmada a Supabase Storage (`geny-knowledge-temp`) con progreso real (`0–100%`) + Gemini File API (`maxDuration = 300`) para PDFs grandes, Word `.docx` e imágenes.
  - **Opción B (URLs Web + Google Drive):** Soporta páginas web públicas, enlaces individuales de documentos y carpetas públicas completas de Google Drive (20+ documentos en cola individual) + botón `Re-leer`.
  - **Monitor Flotante en 2.º Plano:** Seguimiento en vivo (`En cola` → `Subiendo %` → `Analizando IA` → `Completado` / `Error`) visible aunque se cambie de pestaña en `/admin`, más botón **`Ver / Editar`**.
- **Bóveda de Llaves API + Zona de Peligro + Rollback 1-Clic:**
  - Modal de advertencia **`⚠️ Cuidado: Zona de Peligro`** al desbloquear la edición en la pestaña **Motor IA, APIs y Reglas**.
  - Edición en vivo de las 14 llaves y tokens (`GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `WHOP_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `HOTMART_HOTTOK`).
  - Botón **`Restaurar a la Última Versión Funcional`** que revierte cualquier cambio problemático al último snapshot funcional guardado en Supabase.

---

## 2. Dónde Nos Quedamos (Siguiente Paso Inmediato)

El usuario seleccionó continuar con:
> **1. Configurar el Bot de Telegram (`@BotFather`) y preparar el despliegue en Vercel para pruebas reales.**

### Avance del despliegue en vivo:
1. ✅ **Bot de Telegram creado y conectado (`@GenyProIngresariosBot`):** Token guardado en `.env.local` y en `geny_settings.runtime_secrets` de Supabase; textos oficiales, banner `640x360` y menú `/start` listos.
2. ✅ **Producción desplegada en `https://genypro.ingresarios.ai/`** (Vercel región `iad1`, conectada a GitHub `ingresarios-ai/geny-pro-wt`).
3. ✅ **Webhook de Telegram activo en vivo:** `https://genypro.ingresarios.ai/api/webhooks/telegram`.
4. ⏳ **Siguientes hitos inmediatos:**
   - Probar en vivo la subida de `libro método Ingresarios.pdf` / carpetas de Google Drive en **Conocimiento RAG** y la conversación real con `@GenyProIngresariosBot` (validación OTP por correo).
   - Evaluar si se desea la **Opción C** con Google Service Account para carpetas privadas de Drive.
   - Importar la base de alumnos activos por CSV y conectar WhatsApp Cloud API + pasarelas de pago (Whop / Stripe / Hotmart).

