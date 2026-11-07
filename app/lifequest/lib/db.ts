import { Pool, type QueryResultRow } from "pg";

type GlobalWithLifeQuestPool = typeof globalThis & {
  lifeQuestPool?: Pool;
};

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");

  const databaseUrl = new URL(connectionString);
  const schema = databaseUrl.searchParams.get("schema") || "public";
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(schema)) {
    throw new Error("DATABASE_URL schema is invalid.");
  }
  databaseUrl.searchParams.delete("schema");

  return new Pool({
    connectionString: databaseUrl.toString(),
    options: `-c search_path="${schema}"`,
  });
}

const globalWithPool = globalThis as GlobalWithLifeQuestPool;

export const pool = globalWithPool.lifeQuestPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalWithPool.lifeQuestPool = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
) {
  return pool.query<T>(text, values);
}

export async function withTransaction<T>(
  action: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
