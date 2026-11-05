"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from "recharts";
import { formatBRL, formatBRLCompact, formatPercentBps } from "@/lib/money";
import { monthLabel } from "@/lib/dates";

const S1 = "var(--color-series-1)";
const S2 = "var(--color-series-2)";
const GRID = "#e9edf3";
const AXIS = { fontSize: 11, fill: "#64748b" };

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-slate-600">
          {r.color && <span className="inline-block h-2 w-2 rounded-sm" style={{ background: r.color }} />}
          <span>{r.label}:</span>
          <span className="ml-auto font-medium tabular text-ink">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Faturamento mensal (série única). */
export function SalesEvolutionChart({ data }: { data: { month: string; grossCents: number; count: number; profitCents: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => formatBRLCompact(v)} tick={AXIS} axisLine={false} tickLine={false} width={64} />
        <Tooltip
          cursor={{ fill: "rgba(21,94,239,0.06)" }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={monthLabel(String(payload[0].payload.month))}
                rows={[
                  { label: "Faturamento", value: formatBRL(payload[0].payload.grossCents), color: S1 },
                  { label: "Vendas", value: String(payload[0].payload.count) },
                  ...(payload[0].payload.profitCents !== null ? [{ label: "Lucro bruto", value: formatBRL(payload[0].payload.profitCents) }] : []),
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="grossCents" name="Faturamento" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Margem de lucro por mês (linha, eixo único em %). */
export function MarginChart({ data }: { data: { month: string; marginBps: number | null; count: number }[] }) {
  const rows = data.map((d) => ({ ...d, margin: d.count ? (d.marginBps ?? 0) / 100 : null }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => `${v}%`} tick={AXIS} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={monthLabel(String(payload[0].payload.month))}
                rows={[{ label: "Margem", value: payload[0].payload.margin === null ? "sem vendas" : formatPercentBps(payload[0].payload.marginBps ?? 0), color: S1 }]}
              />
            ) : null
          }
        />
        <Line type="monotone" dataKey="margin" stroke={S1} strokeWidth={2} dot={{ r: 4, fill: S1, stroke: "#fff", strokeWidth: 2 }} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Recebimentos × pagamentos realizados por mês (duas séries, legenda). */
export function CashChart({ data }: { data: { month: string; receivedCents: number; paidCents: number; toReceiveCents: number; toPayCents: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={monthLabel} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => formatBRLCompact(v)} tick={AXIS} axisLine={false} tickLine={false} width={64} />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "#475569" }} />
        <Tooltip
          cursor={{ fill: "rgba(21,94,239,0.06)" }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <TooltipBox
                title={monthLabel(String(payload[0].payload.month))}
                rows={[
                  { label: "Recebido", value: formatBRL(payload[0].payload.receivedCents), color: S1 },
                  { label: "Pago", value: formatBRL(payload[0].payload.paidCents), color: S2 },
                  { label: "A receber (aberto)", value: formatBRL(payload[0].payload.toReceiveCents) },
                  { label: "A pagar (aberto)", value: formatBRL(payload[0].payload.toPayCents) },
                ]}
              />
            ) : null
          }
        />
        <Bar dataKey="receivedCents" name="Recebido" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={22} />
        <Bar dataKey="paidCents" name="Pago" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Lista de barras horizontais com rótulos diretos (ranking). */
export function BarList({ items, format = "money", empty = "Sem dados no período." }: { items: { label: string; valueCents: number; sub?: string }[]; format?: "money" | "int"; empty?: string }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-muted">{empty}</p>;
  const max = Math.max(...items.map((i) => i.valueCents), 1);
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label} title={`${i.label}: ${format === "money" ? formatBRL(i.valueCents) : i.valueCents}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{i.label}</span>
            <span className="shrink-0 font-medium tabular text-ink">
              {format === "money" ? formatBRL(i.valueCents) : i.valueCents}
              {i.sub && <span className="ml-1 text-xs font-normal text-muted">{i.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.max(2, (i.valueCents / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
