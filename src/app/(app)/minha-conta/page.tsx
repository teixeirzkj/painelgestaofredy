import { UserRound, KeyRound } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { getMe } from "@/server/services/admin";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { ROLES } from "@/lib/constants";
import { formatDateTime } from "@/lib/dates";
import { PasswordForm, ProfileForm } from "./account-client";

export const metadata = { title: "Minha conta" };

export default async function MyAccountPage() {
  const ctx = await requirePageContext();
  const me = await getMe(ctx);
  const initials = me.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <>
      <PageHeader title="Minha conta" description={ctx.companyName.replace(/\s*\(DEMONSTRAÇÃO\)\s*/i, "")} />
      <Card className="mb-6 flex flex-wrap items-center gap-5 p-6">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 font-display text-xl font-bold text-brand-700 ring-4 ring-brand-50">{initials}</span>
        <div>
          <p className="font-display text-lg font-bold text-ink">{me.name}</p>
          <p className="text-sm text-muted">
            {ROLES.label(me.role)} · {me.email}
          </p>
          {me.lastLoginAt && <p className="text-xs text-subtle">Último acesso em {formatDateTime(me.lastLoginAt, ctx.timezone)}</p>}
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Dados pessoais" icon={UserRound} />
          <div className="p-5">
            <ProfileForm initial={{ name: me.name, email: me.email, phone: me.phone ?? "", birthDate: me.birthDate ?? "" }} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Alterar senha" icon={KeyRound} description="Se recebeu uma senha provisória, troque aqui no primeiro acesso." />
          <div className="p-5">
            <PasswordForm />
          </div>
        </Card>
      </div>
    </>
  );
}
