import { isAdminAuthenticated } from "@/lib/auth/admin-session";
import AdminLoginClient from "@/components/admin/AdminLoginClient";
import SimulatorClient from "@/components/admin/SimulatorClient";

export const dynamic = "force-dynamic";

export default async function SimulatorPage() {
  const authenticated = await isAdminAuthenticated();
  if (!authenticated) {
    return <AdminLoginClient />;
  }
  return <SimulatorClient />;
}

