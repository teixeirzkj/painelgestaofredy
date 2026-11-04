import { requirePageContext } from "@/server/auth";
import { can, today } from "@/server/context";
import { listAccounts, listTransfers } from "@/server/services/finance";
import { Card, CardHeader, Table, Td, Th, Badge } from "@/components/ui";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { ACCOUNT_TYPES } from "@/lib/constants";
import { AccountButton, AccountToggle, ReverseTransferButton, TransferButton } from "./account-forms";

export const metadata = { title: "Contas financeiras" };

export default async function AccountsPage() {
  const ctx = await requirePageContext("finance.view");
  const [accounts, transfers] = await Promise.all([listAccounts(ctx, { includeInactive: true }), listTransfers(ctx)]);
  const canManage = can(ctx, "finance.manage");
  const active = accounts.filter((a) => a.active);
  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardHeader title="Contas financeiras" description="Bancos, caixa físico e contas de recebíveis. O saldo considera apenas baixas efetivas e transferências." action={canManage && <AccountButton />} />
        <Table>
          <thead>
            <tr>
              <Th>Conta</Th>
              <Th>Tipo</Th>
              <Th align="right">Saldo inicial</Th>
              <Th align="right">Saldo atual</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={a.active ? "" : "opacity-50"}>
                <Td>
                  <p className="font-medium">{a.name}</p>
                  {a.bankName && <p className="text-xs text-muted">{a.bankName}</p>}
                </Td>
                <Td>
                  <Badge>{ACCOUNT_TYPES.label(a.type)}</Badge> {!a.active && <Badge tone="gray">Inativa</Badge>}
                </Td>
                <Td align="right">{formatBRL(a.initialBalanceCents)}</Td>
                <Td align="right" className={a.balanceCents < 0 ? "font-semibold text-danger" : "font-semibold"}>
                  {formatBRL(a.balanceCents)}
                </Td>
                <Td align="right">
                  {canManage && (
                    <span className="flex justify-end gap-1">
                      <AccountButton account={{ id: a.id, name: a.name, type: a.type, bankName: a.bankName, initialBalanceCents: a.initialBalanceCents }} />
                      <AccountToggle id={a.id} active={a.active} />
                    </span>
                  )}
                </Td>
              </tr>
            ))}
            <tr className="bg-slate-50">
              <Td className="font-semibold">Total</Td>
              <Td />
              <Td />
              <Td align="right" className="font-semibold">
                {formatBRL(accounts.reduce((s, a) => s + a.balanceCents, 0))}
              </Td>
              <Td />
            </tr>
          </tbody>
        </Table>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader title="Transferências internas" description="Movem saldo entre contas sem gerar receita ou despesa." action={canManage && active.length > 1 && <TransferButton accounts={active.map((a) => ({ id: a.id, name: a.name }))} todayStr={today(ctx)} />} />
        {transfers.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma transferência registrada.</p>
        ) : (
          <ul className="divide-y divide-line">
            {transfers.map((t) => (
              <li key={t.id} className={`flex items-center justify-between gap-3 px-5 py-3 text-sm ${t.reversedAt ? "opacity-50" : ""}`}>
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {t.fromAccount.name} → {t.toAccount.name}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDate(t.date)}
                    {t.description && ` · ${t.description}`}
                    {t.reversedAt && " · estornada"}
                  </p>
                </div>
                <span className={`tabular font-medium ${t.reversedAt ? "line-through" : ""}`}>{formatBRL(t.amountCents)}</span>
                {canManage && !t.reversedAt && <ReverseTransferButton id={t.id} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
