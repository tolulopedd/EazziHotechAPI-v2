import dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  DATABASE_URL: requireEnv("DATABASE_URL"),
};
