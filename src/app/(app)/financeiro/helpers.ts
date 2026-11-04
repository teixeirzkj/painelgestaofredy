export { formatBRL } from "@/lib/money";
import { settlementPrincipal } from "@/lib/finance";

export function settlementPrincipalSafe(amount: number, interest: number, discount: number) {
  return settlementPrincipal(amount || 0, interest || 0, discount || 0);
}
