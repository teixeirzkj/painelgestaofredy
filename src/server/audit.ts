import type { Tx } from "./db";
import type { Ctx } from "./context";

export async function audit(
  tx: Tx,
  ctx: Ctx,
  action: string,
  entityType: string,
  entityId: string | null,
  data?: unknown,
) {
  await tx.auditLog.create({
    data: {
      companyId: ctx.companyId,
      userId: ctx.userId,
      action,
      entityType,
      entityId,
      dataJson: data === undefined ? null : JSON.stringify(data),
    },
  });
}
