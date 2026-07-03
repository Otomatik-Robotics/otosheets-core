import { defineConfig } from 'drizzle-kit';

// Used for `drizzle-kit generate` diffing in later phases; migrations are
// applied by src/pg/migrate.ts (see that file), not `drizzle-kit migrate`.
export default defineConfig({
    dialect: 'postgresql',
    schema: './src/pg/schema/index.ts',
    out: './drizzle',
});
