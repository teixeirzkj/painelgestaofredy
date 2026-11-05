import { ListTodo, Plane, Cake } from "lucide-react";
import { requirePageContext } from "@/server/auth";
import { workMonth } from "@/server/month";
import { personalCalendar } from "@/server/services/team";
import { KpiCard, PageHeader } from "@/components/ui";
import { addDays, startOfWeek } from "@/lib/dates";
import { CalendarGrid } from "./calendar-grid";

export const metadata = { title: "Meu calendário" };

export default async function MyCalendarPage() {
  const ctx = await requirePageContext();
  const wm = await workMonth(ctx.timezone);
  const events = await personalCalendar(ctx, wm.month);
  const weekStart = startOfWeek(wm.today);
  const weekEnd = addDays(weekStart, 6);
  const tasksWeek = events.filter((e) => e.kind === "Tarefa" && !e.done && e.date >= weekStart && e.date <= weekEnd).length;
  const departures = events.filter((e) => e.kind === "Embarque" && e.date >= wm.today).length;
  const birthdays = events.filter((e) => e.kind === "Aniversário").length;

  return (
    <>
      <PageHeader title="Meu calendário" description="Agenda pessoal: tarefas, embarques, aniversários e créditos que vencem." />
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Tarefas nesta semana" value={String(tasksWeek)} icon={ListTodo} tone="violet" hint={wm.isCurrent ? undefined : "semana atual"} />
        <KpiCard label="Embarques próximos" value={String(departures)} icon={Plane} hint="no mês selecionado" />
        <KpiCard label="Aniversariantes do mês" value={String(birthdays)} icon={Cake} tone="amber" />
      </section>
      <CalendarGrid month={wm.month} label={wm.label} today={wm.today} events={events} />
    </>
  );
}
