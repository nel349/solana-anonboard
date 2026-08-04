import type { DBMigrations } from "@effectstream/runtime";
import initSql from "./migrations/000-init.sql" with { type: "text" };
import anonboardSql from "./migrations/001-anonboard.sql" with { type: "text" };

export const migrationTable: DBMigrations[] = [
  { name: "000-init.sql", sql: initSql },
  { name: "001-anonboard.sql", sql: anonboardSql },
];
