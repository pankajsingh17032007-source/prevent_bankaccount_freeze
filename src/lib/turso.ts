import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;

if (!url) {
  throw new Error("TURSO_DATABASE_URL must be set to use the Turso client.");
}

export const turso = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN,
});