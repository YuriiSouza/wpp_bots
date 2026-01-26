// prisma.config.ts
import { defineConfig } from "prisma/config";

export default defineConfig({
  datasource: {
    url: "env(DATABASE_URL)",
    shadowDatabaseUrl: "env(DIRECT_URL)",
  },
});