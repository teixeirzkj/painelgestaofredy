// Design system Frédy Gestão — componentes de interface reutilizáveis (server-safe).
import * as React from "react";
import Link from "next/link";
import { Loader2, Inbox, ChevronLeft, ChevronRight, AlertTriangle, Info, CircleAlert, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

// ------------------------------ Botões ------------------------------
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm shadow-brand-600/25 hover:bg-brand-700 active:bg-brand-800",
  secondary: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  outline: "border border-line bg-white text-ink shadow-[0_1px_1px_rgba(16,42,86,0.04)] hover:border-line-strong hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-ink",
  danger: "bg-danger text-white shadow-sm hover:bg-red-700",
};
const sizes = { sm: "h-8 px-3 text-xs", md: "h-9 px-3.5 text-sm", lg: "h-11 px-5 text-sm", icon: "h-9 w-9" };
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; loading?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button ref={ref} disabled={disabled || loading} className={cn(btnBase, variants[variant], sizes[size], className)} {...props}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: { href: string; variant?: Variant; size?: keyof typeof sizes; className?: string; children: React.ReactNode } & Omit<React.ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={cn(btnBase, variants[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}

// ------------------------------ Campos ------------------------------
const fieldBase =
  "w-full rounded-xl border border-line bg-white px-3 text-sm text-ink shadow-[0_1px_1px_rgba(16,42,86,0.03)] transition-colors placeholder:text-subtle hover:border-line-strong focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(fieldBase, "h-9", className)} {...p} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...p} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        fieldBase,
        "h-9 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 20 20%22 fill=%22%2394a3b8%22><path d=%22M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z%22/></svg>')] bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8",
        className,
      )}
      {...p}
    >
      {children}
    </select>
  );
});

export function Field({
  label,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-slate-700">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

// ------------------------------ Estrutura ------------------------------
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-[14px] border border-line bg-white shadow-[var(--shadow-card)]", className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
  icon: Icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  icon?: React.ElementType;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  meta?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 rounded-md text-xs font-medium text-muted transition-colors hover:text-brand-600">
            <ChevronLeft className="h-3.5 w-3.5" /> {back.label}
          </Link>
        )}
        <h1 className="font-display text-[22px] font-bold leading-tight text-ink sm:text-[26px]">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted">{description}</div>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const badgeTones = {
  gray: "bg-slate-100 text-slate-700",
  blue: "bg-brand-50 text-brand-700",
  green: "bg-green-50 text-green-700",
  red: "bg-red-50 text-red-700",
  amber: "bg-amber-50 text-amber-800",
  violet: "bg-violet-50 text-violet-700",
};
const dotTones = { gray: "bg-slate-400", blue: "bg-brand-500", green: "bg-green-500", red: "bg-red-500", amber: "bg-amber-500", violet: "bg-violet-500" };
export type Tone = keyof typeof badgeTones;
export function Badge({ tone = "gray", children, className, dot = false }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", badgeTones[tone], className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} />}
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-200/70", className)} />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: React.ElementType; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 ring-8 ring-brand-25">
        <Icon className="h-6 w-6" />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "blue", title, children, className }: { tone?: "blue" | "amber" | "red"; title?: string; children: React.ReactNode; className?: string }) {
  const c = {
    blue: "border-brand-100 bg-brand-25 text-brand-900",
    amber: "border-amber-200 bg-amber-50/70 text-amber-900",
    red: "border-red-200 bg-red-50/70 text-red-900",
  }[tone];
  const Icon = tone === "blue" ? Info : tone === "red" ? CircleAlert : AlertTriangle;
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", c, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-[13px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

// ------------------------------ Tabela ------------------------------
export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full min-w-[640px] border-collapse text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-brand-25/60">{children}</table>
    </div>
  );
}
export function Th({ children, className, align = "left" }: { children?: React.ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-line bg-brand-25 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted",
        { left: "text-left", right: "text-right", center: "text-center" }[align],
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({ children, className, align = "left", ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right" | "center" }) {
  return (
    <td className={cn("border-b border-line/70 px-4 py-3 align-middle", align === "right" && "text-right tabular", align === "center" && "text-center", className)} {...p}>
      {children}
    </td>
  );
}

export function Pagination({ page, pages, total, hrefFor }: { page: number; pages: number; total: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return <div className="px-4 py-3 text-xs text-muted">{total} registro(s)</div>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted">
      <span>
        {total} registro(s) · página {page} de {pages}
      </span>
      <div className="flex gap-1">
        <LinkButton href={hrefFor(Math.max(1, page - 1))} variant="outline" size="sm" aria-disabled={page <= 1} className={page <= 1 ? "pointer-events-none opacity-40" : ""}>
          <ChevronLeft className="h-4 w-4" /> Anterior
        </LinkButton>
        <LinkButton href={hrefFor(Math.min(pages, page + 1))} variant="outline" size="sm" aria-disabled={page >= pages} className={page >= pages ? "pointer-events-none opacity-40" : ""}>
          Próxima <ChevronRight className="h-4 w-4" />
        </LinkButton>
      </div>
    </div>
  );
}

export function Tabs({ items, active }: { items: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-line bg-white p-1 shadow-[var(--shadow-card)]">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            active === i.key ? "bg-brand-500 text-white shadow-sm" : "text-muted hover:bg-brand-25 hover:text-ink",
          )}
        >
          {i.label}
          {i.count ? <span className={cn("rounded-full px-1.5 text-[11px]", active === i.key ? "bg-white/20" : "bg-slate-100 text-slate-600")}>{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "success" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn("mt-1 truncate font-display text-lg font-semibold tabular text-ink", tone === "danger" && "text-danger", tone === "success" && "text-success")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** Cartão de indicador com ícone, variação e rodapé opcional. */
export function KpiCard({
  label,
  value,
  icon: Icon,
  delta,
  hint,
  tone = "blue",
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ElementType;
  delta?: { bps: number | null; label?: string; inverse?: boolean } | null;
  hint?: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "red" | "violet" | "slate";
  href?: string;
}) {
  const toneCls = {
    blue: "bg-brand-50 text-brand-600",
    green: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    red: "bg-red-50 text-red-600",
    violet: "bg-violet-50 text-violet-600",
    slate: "bg-slate-100 text-slate-600",
  }[tone];
  const up = delta?.bps != null && delta.bps >= 0;
  const good = delta?.inverse ? !up : up;
  const body = (
    <Card className={cn("h-full p-5 transition-shadow", href && "hover:shadow-[var(--shadow-pop)]")}>
      <div className="flex items-start justify-between gap-3">
        {Icon ? (
          <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneCls)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        ) : (
          <span />
        )}
        {delta && delta.bps != null && (
          <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium", good ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700")}>
            {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta.bps / 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </span>
        )}
      </div>
      <p className="mt-4 truncate font-display text-[24px] font-bold leading-tight tabular text-ink">{value}</p>
      <p className="mt-1 text-[13px] text-muted">{label}</p>
      {(hint || delta?.label) && <p className="mt-1 text-xs text-subtle">{hint ?? delta?.label}</p>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Lista de pares rótulo/valor. */
export function DataList({ items, columns = 2, className }: { items: { label: string; value: React.ReactNode; full?: boolean }[]; columns?: 1 | 2 | 3; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4 text-sm", { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-3" }[columns], className)}>
      {items.map((i, idx) => (
        <div key={idx} className={cn("min-w-0", i.full && "sm:col-span-full")}>
          <dt className="text-xs font-medium text-muted">{i.label}</dt>
          <dd className="mt-0.5 break-words text-ink">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ProgressBar({ value, max, tone = "blue", className }: { value: number; max: number; tone?: "blue" | "green" | "amber" | "red"; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const c = { blue: "bg-brand-600", green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" }[tone];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-slate-100", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", c)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between first:mt-0">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">{children}</h2>
      {action}
    </div>
  );
}
