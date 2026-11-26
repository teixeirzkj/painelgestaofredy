-- Várias formas de pagamento (cartão + pontos, cartão + pix...) quando o cliente paga direto ao fornecedor.
ALTER TABLE "SaleItem" ADD COLUMN     "clientPaymentsJson" TEXT NOT NULL DEFAULT '[]';

-- Aproveita o que tiver sido preenchido no formato anterior (uma forma só).
UPDATE "SaleItem"
SET "clientPaymentsJson" = json_build_array(json_build_object('method', "clientPayMethod", 'amountCents', 0, 'installments', "clientPayInstallments"))::text
WHERE "clientPayMethod" IS NOT NULL;

-- As colunas antigas (clientPayMethod, clientPayInstallments) ficam no banco por enquanto, sem uso,
-- para a versão anterior continuar funcionando durante a troca de deploy. Podem ser removidas depois.
