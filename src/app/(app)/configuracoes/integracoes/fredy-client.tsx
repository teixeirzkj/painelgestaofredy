"use client";
import { useState } from "react";
import Link from "next/link";
import { Plug, RefreshCw, Unplug, KeyRound, Workflow, History, CheckCircle2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field, Notice, Select, Table, Td, Th } from "@/components/ui";
import { ConfirmDialog, PasswordInput } from "@/components/ui/client";
import { useAction, issuesToMap } from "@/components/use-action";
import { formatDateTime } from "@/lib/dates";
import {
  connectFredyAction,
  disconnectFredyAction,
  getFredyPanelSetupAction,
  registerFredyWebhookAction,
  saveFredyMappingAction,
  testFredyAction,
} from "@/app/actions";

type Ev = { id: string; eventType: string; status: string; message: string | null; saleId: string | null; createdAt: string };
type Integ =
  | { connected: false; events: Ev[]; publicUrl: string | null }
  | {
      connected: true;
      events: Ev[];
      publicUrl: string | null;
      tokenLast4: string;
      status: string;
      lastError: string | null;
      salesPanelId: string | null;
      salesPanelTitle: string | null;
      quoteStepId: string | null;
      wonStepId: string | null;
      lostStepId: string | null;
      fieldMap: Record<string, string>;
      defaultSellerId: string | null;
      defaultProductType: string;
      autoCreateSale: boolean;
      syncBack: boolean;
      webhookSubscriptionId: string | null;
      connectedAt: string;
      lastEventAt: string | null;
    };
type Setup = { id: string; title: string; steps: { id: string; title: string; isFinal: boolean }[]; fields: { key: string; name: string; type: string }[] };

export function FredyIntegrationPanel({
  integ,
  panels,
  setup,
  loadError,
  users,
  productTypes,
  fieldTargets,
}: {
  integ: Integ;
  panels: { id: string; title: string; type: string; steps: number }[];
  setup: Setup | null;
  loadError: string | null;
  users: { id: string; name: string }[];
  productTypes: { value: string; label: string }[];
  fieldTargets: { key: string; label: string }[];
}) {
  return (
    <div className="space-y-5">
      <HowItWorks />
      {!integ.connected ? (
        <ConnectCard />
      ) : (
        <>
          <StatusCard integ={integ} />
          {loadError ? (
            <Notice tone="red" title="Não foi possível ler o CRM">
              {loadError}
            </Notice>
          ) : (
            <MappingCard integ={integ} panels={panels} initialSetup={setup} users={users} productTypes={productTypes} fieldTargets={fieldTargets} />
          )}
        </>
      )}
      <EventsCard events={integ.events} />
    </div>
  );
}

function HowItWorks() {
  const steps = [
    "O vendedor marca o card como ganho no painel de vendas do Frédy.",
    "A venda entra aqui como rascunho, com o cliente vinculado ao contato do CRM, o valor e os dados do card.",
    "O vendedor confere a forma de pagamento e confirma: o financeiro e o contrato são gerados.",
    "O card no Frédy recebe o valor final e uma nota com o código da venda.",
  ];
  return (
    <Card>
      <CardHeader icon={Workflow} title="Como funciona" description="Fluxo entre o CRM Frédy e a gestão" />
      <ol className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 rounded-xl bg-surface p-3.5 text-sm text-slate-700">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ConnectCard({ replacing, onDone }: { replacing?: boolean; onDone?: () => void }) {
  const { run, busy } = useAction();
  const [token, setToken] = useState("");
  return (
    <Card>
      <CardHeader icon={KeyRound} title={replacing ? "Trocar token do Frédy" : "Conectar ao Frédy CRM"} description="Cole o token da API da conta Frédy da agência" />
      <form
        className="space-y-4 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() => connectFredyAction(token));
          if (r.ok) {
            setToken("");
            onDone?.();
          }
        }}
      >
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            No Frédy, abra <strong>Ajustes → Integrações → Integração via API</strong> e clique em <strong>Novo</strong>.
          </li>
          <li>
            Copie o token gerado (começa com <code className="rounded bg-slate-100 px-1">pn_</code>) e cole abaixo.
          </li>
        </ol>
        <Field label="Token da API" hint="Fica guardado criptografado e nunca aparece de novo na tela." required>
          <PasswordInput value={token} onChange={(e) => setToken(e.target.value)} placeholder="pn_..." autoComplete="off" />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={token.trim().length < 10}>
            <Plug className="h-4 w-4" /> {replacing ? "Salvar novo token" : "Conectar"}
          </Button>
          {replacing && (
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function StatusCard({ integ }: { integ: Extract<Integ, { connected: true }> }) {
  const { run, busy } = useAction();
  const [replacing, setReplacing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (replacing) return <ConnectCard replacing onDone={() => setReplacing(false)} />;
  const ok = integ.status === "CONECTADA";
  return (
    <Card>
      <CardHeader
        icon={Plug}
        title="Frédy CRM"
        description={`Token terminado em ${integ.tokenLast4}`}
        action={
          ok ? (
            <Badge tone="green" dot>
              Conectado
            </Badge>
          ) : (
            <Badge tone="red" dot>
              Com erro
            </Badge>
          )
        }
      />
      <div className="space-y-4 p-5">
        {integ.lastError && (
          <Notice tone={ok ? "amber" : "red"} title="Atenção">
            {integ.lastError}
          </Notice>
        )}
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Conectado em" value={formatDateTime(integ.connectedAt)} />
          <Info label="Painel de vendas" value={integ.salesPanelTitle ?? "Não escolhido"} />
          <Info label="Webhook no Frédy" value={integ.webhookSubscriptionId ? "Registrado" : "Não registrado"} />
          <Info label="Último evento recebido" value={integ.lastEventAt ? formatDateTime(integ.lastEventAt) : "Nenhum ainda"} />
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={busy} onClick={() => run(() => testFredyAction(), { success: "Conexão com o Frédy funcionando." })}>
            <RefreshCw className="h-4 w-4" /> Testar conexão
          </Button>
          {integ.salesPanelId && (
            <Button variant="outline" loading={busy} onClick={() => run(() => registerFredyWebhookAction(), { success: "Webhook registrado no Frédy." })}>
              <Workflow className="h-4 w-4" /> Registrar webhook de novo
            </Button>
          )}
          <Button variant="outline" onClick={() => setReplacing(true)}>
            <KeyRound className="h-4 w-4" /> Trocar token
          </Button>
          <Button variant="ghost" className="text-danger hover:bg-red-50 hover:text-danger" onClick={() => setConfirm(true)}>
            <Unplug className="h-4 w-4" /> Desconectar
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Desconectar o Frédy?"
        description="O webhook é removido do Frédy e o token é apagado daqui. Vendas já importadas continuam na gestão."
        confirmLabel="Desconectar"
        onConfirm={async () => {
          await run(() => disconnectFredyAction());
          setConfirm(false);
        }}
      />
    </Card>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{value}</dd>
    </div>
  );
}

function MappingCard({
  integ,
  panels,
  initialSetup,
  users,
  productTypes,
  fieldTargets,
}: {
  integ: Extract<Integ, { connected: true }>;
  panels: { id: string; title: string; type: string; steps: number }[];
  initialSetup: Setup | null;
  users: { id: string; name: string }[];
  productTypes: { value: string; label: string }[];
  fieldTargets: { key: string; label: string }[];
}) {
  const { run, busy } = useAction();
  const loader = useAction();
  const [setup, setSetup] = useState<Setup | null>(initialSetup);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [f, setF] = useState({
    salesPanelId: integ.salesPanelId ?? "",
    quoteStepId: integ.quoteStepId ?? "",
    wonStepId: integ.wonStepId ?? "",
    lostStepId: integ.lostStepId ?? "",
    fieldMap: integ.fieldMap as Record<string, string>,
    defaultSellerId: integ.defaultSellerId ?? "",
    defaultProductType: integ.defaultProductType,
    autoCreateSale: integ.autoCreateSale,
    syncBack: integ.syncBack,
  });

  async function choosePanel(id: string) {
    setF((v) => ({ ...v, salesPanelId: id, quoteStepId: "", wonStepId: "", lostStepId: "", fieldMap: {} }));
    setSetup(null);
    if (!id) return;
    await loader.run(() => getFredyPanelSetupAction(id), { success: false, refresh: false, onSuccess: (d) => setSetup(d) });
  }

  const steps = setup?.steps ?? [];
  const fields = setup?.fields ?? [];
  return (
    <Card>
      <CardHeader icon={Workflow} title="Painel de vendas e etapas" description="Escolha o painel do CRM e diga o que cada etapa significa" />
      <form
        className="space-y-6 p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setErrors({});
          const r = await run(() => saveFredyMappingAction(f), { success: false });
          if (!r.ok) return setErrors(issuesToMap(r.issues));
          const d = r.data as { webhook: boolean; reason?: string };
          if (d.webhook) (await import("sonner")).toast.success("Configuração salva e webhook registrado no Frédy.");
          else (await import("sonner")).toast.warning(`Configuração salva. ${d.reason ?? ""}`);
        }}
      >
        {panels.length === 0 ? (
          <Notice tone="amber">Nenhum painel encontrado nesta conta do Frédy. Crie o painel de vendas no CRM e volte aqui.</Notice>
        ) : (
          <Field label="Painel de vendas" error={errors.salesPanelId} required hint="Os cards ganhos deste painel viram vendas na gestão.">
            <Select value={f.salesPanelId} onChange={(e) => choosePanel(e.target.value)}>
              <option value="">Selecione</option>
              {panels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.type === "SALES" ? " (vendas)" : ""} · {p.steps} etapas
                </option>
              ))}
            </Select>
          </Field>
        )}

        {loader.busy && <p className="text-sm text-muted">Carregando etapas e campos do painel…</p>}

        {setup && (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <StepSelect label="Etapa de orçamento" hint="Opcional: onde ficam os orçamentos." value={f.quoteStepId} steps={steps} error={errors.quoteStepId} onChange={(v) => setF({ ...f, quoteStepId: v })} />
              <StepSelect
                label="Etapa de ganho"
                hint="Opcional: além do botão “ganho” do card, chegar nesta etapa também cria a venda."
                value={f.wonStepId}
                steps={steps}
                error={errors.wonStepId}
                onChange={(v) => setF({ ...f, wonStepId: v })}
              />
              <StepSelect label="Etapa de perdido" hint="Opcional." value={f.lostStepId} steps={steps} error={errors.lostStepId} onChange={(v) => setF({ ...f, lostStepId: v })} />
            </div>

            <div>
              <h4 className="text-sm font-semibold text-ink">Campos do card</h4>
              <p className="mb-3 text-xs text-muted">
                {fields.length === 0 ? "Este painel não tem campos personalizados: a venda entra com o título e o valor do card." : "Indique qual campo personalizado do card preenche cada dado da venda."}
              </p>
              {fields.length > 0 && (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {fieldTargets.map((t) => (
                    <Field key={t.key} label={t.label}>
                      <Select value={f.fieldMap[t.key] ?? ""} onChange={(e) => setF({ ...f, fieldMap: { ...f.fieldMap, [t.key]: e.target.value } })}>
                        <option value="">Não usar</option>
                        {fields.map((c) => (
                          <option key={c.key} value={c.key}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Vendedor padrão" hint="Usado quando o responsável do card não tem login na gestão com o mesmo e-mail.">
                <Select value={f.defaultSellerId} onChange={(e) => setF({ ...f, defaultSellerId: e.target.value })}>
                  <option value="">Primeiro administrador</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tipo de produto da venda">
                <Select value={f.defaultProductType} onChange={(e) => setF({ ...f, defaultProductType: e.target.value })}>
                  {productTypes.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="space-y-2">
              <Toggle checked={f.autoCreateSale} onChange={(v) => setF({ ...f, autoCreateSale: v })} label="Card ganho cria a venda na gestão (como rascunho)" />
              <Toggle checked={f.syncBack} onChange={(v) => setF({ ...f, syncBack: v })} label="Venda confirmada atualiza o card no Frédy (ganho, valor e nota)" />
            </div>
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="submit" loading={busy} disabled={!setup}>
            <CheckCircle2 className="h-4 w-4" /> Salvar e registrar webhook
          </Button>
          {!integ.publicUrl && <span className="text-xs text-warning">Neste ambiente local o webhook não é registrado; na versão publicada ele é criado automaticamente.</span>}
        </div>
      </form>
    </Card>
  );
}

function StepSelect({ label, hint, value, steps, error, onChange }: { label: string; hint: string; value: string; steps: Setup["steps"]; error?: string; onChange: (v: string) => void }) {
  return (
    <Field label={label} hint={hint} error={error}>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Não usar</option>
        {steps.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
      <input type="checkbox" className="h-4 w-4 rounded border-line-strong accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const EVENT_LABEL: Record<string, string> = {
  PANEL_CARD_UPDATE: "Card atualizado",
  PANEL_CARD_STEP_CHANGE: "Card mudou de etapa",
  PANEL_CARD_NEW: "Card criado",
  CONTACT_UPDATE: "Contato atualizado",
};

function EventsCard({ events }: { events: Ev[] }) {
  return (
    <Card>
      <CardHeader icon={History} title="Eventos recebidos do Frédy" description="Últimos 20 eventos que geraram alguma ação ou erro" />
      {events.length === 0 ? (
        <p className="p-5 text-sm text-muted">Nenhum evento ainda. Quando um card do painel de vendas for marcado como ganho, ele aparece aqui.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Quando</Th>
              <Th>Evento</Th>
              <Th>Resultado</Th>
              <Th>Detalhe</Th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-slate-600">{formatDateTime(e.createdAt)}</Td>
                <Td>{EVENT_LABEL[e.eventType] ?? e.eventType}</Td>
                <Td>
                  {e.status === "PROCESSADO" ? <Badge tone="green">Processado</Badge> : e.status === "ERRO" ? <Badge tone="red">Erro</Badge> : <Badge>Ignorado</Badge>}
                </Td>
                <Td className="text-slate-600">
                  {e.message}
                  {e.saleId && (
                    <Link href={`/vendas/${e.saleId}`} className="ml-2 font-medium text-brand-600 hover:underline">
                      Abrir venda
                    </Link>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
