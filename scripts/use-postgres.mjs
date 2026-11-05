// Ajusta o schema do Prisma para PostgreSQL no build de produção (Vercel).
// O desenvolvimento local continua em SQLite; o schema versionado no repositório é o de desenvolvimento.
// Uso: node scripts/use-postgres.mjs [caminho-de-saída]
import fs from "node:fs";

const src = "prisma/schema.prisma";
const out = process.argv[2] ?? src;
let s = fs.readFileSync(src, "utf8");
if (!/provider\s*=\s*"sqlite"/.test(s) && !/provider\s*=\s*"postgresql"/.test(s)) throw new Error("datasource não encontrado no schema");
s = s.replace(/provider\s*=\s*"sqlite"/, 'provider  = "postgresql"');
if (!/directUrl/.test(s)) s = s.replace(/url\s*=\s*env\("DATABASE_URL"\)/, 'url       = env("DATABASE_URL")\n  directUrl = env("DATABASE_URL_UNPOOLED")');
fs.writeFileSync(out, s);
console.log(`schema PostgreSQL gravado em ${out}`);
