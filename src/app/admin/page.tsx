import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import AdminLoginClient from "@/components/admin/AdminLoginClient";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const authenticated = await isAdminAuthenticated();

  if (!authenticated) {
    return <AdminLoginClient />;
  }

  return <AdminDashboardClient />;
}

