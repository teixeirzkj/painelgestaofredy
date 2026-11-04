import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/** Recria o banco descartável de testes (prisma/test.db) a cada execução. */
export default function setup() {
  for (const f of ["test.db", "test.db-journal"]) rmSync(path.join(__dirname, "..", "prisma", f), { force: true });
  execSync("npx prisma db push --skip-generate", {
    env: { ...process.env, DATABASE_URL: "file:./test.db", PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "ignore",
  });
}
