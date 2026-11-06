export const metadata = { title: "Venda rápida" };

/** Tela do atendente para abrir em popup: só o atendimento (cliente, venda e contrato), sem a gestão. */
export default function BalcaoLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
