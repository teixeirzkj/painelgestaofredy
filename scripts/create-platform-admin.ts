/**
 * Cria (ou reativa) um usuário do painel da plataforma.
 * Uso: npm run platform:admin -- "Nome" email@empresa.com "senha-forte"
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db";

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password || password.length < 10) {
    console.error('Uso: npm run platform:admin -- "Nome" email@empresa.com "senha com 10+ caracteres"');
    process.exit(1);
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const u = await prisma.platformUser.upsert({
    where: { email: email.toLowerCase() },
    create: { name, email: email.toLowerCase(), passwordHash },
    update: { name, passwordHash, active: true },
  });
  console.log(`Usuário da plataforma pronto: ${u.email}. Acesse /plataforma/login.`);
}

main().finally(() => prisma.$disconnect());
