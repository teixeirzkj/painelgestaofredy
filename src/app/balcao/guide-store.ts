"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

/**
 * Confirmações manuais do passo a passo da venda rápida ("já fechei o card", "conferi os dados"...).
 * Ficam no navegador do atendente, por atendimento: antes da venda existir a chave é o card do Frédy
 * (ou "novo"); depois, a própria venda, que herda o que já foi marcado.
 */
type Checks = Record<string, boolean>;
const PREFIX = "balcao-guia:";
const EVT = "balcao-guia";
const TTL = 12 * 60 * 60 * 1000;
const mem = new Map<string, string>();

function readRaw(key: string): string {
  try {
    const v = localStorage.getItem(PREFIX + key);
    if (v != null) return v;
  } catch {}
  return mem.get(key) ?? "";
}
function writeRaw(key: string, value: string | null) {
  if (value == null) mem.delete(key);
  else mem.set(key, value);
  try {
    if (value == null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {}
  window.dispatchEvent(new Event(EVT));
}
function parse(raw: string): Checks {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as { t: number; c: Checks };
    return Date.now() - v.t > TTL ? {} : (v.c ?? {});
  } catch {
    return {};
  }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function useGuide(key: string, inheritKey?: string) {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => "");
  useEffect(() => {
    if (!inheritKey || readRaw(key)) return;
    const from = readRaw(inheritKey);
    if (!from) return;
    writeRaw(key, from);
    if (inheritKey === "novo") writeRaw("novo", null); // o próximo atendimento começa do zero
  }, [key, inheritKey]);
  const checks = useMemo(() => parse(raw), [raw]);
  const set = useCallback((id: string, v: boolean) => writeRaw(key, JSON.stringify({ t: Date.now(), c: { ...parse(readRaw(key)), [id]: v } })), [key]);
  return [checks, set] as const;
}
