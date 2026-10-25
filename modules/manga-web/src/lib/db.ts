import { Pool as PostgresPool, type QueryResult, type QueryResultRow } from "pg";
import mysql, {
  type Pool as MySqlPool,
  type ResultSetHeader,
} from "mysql2/promise";

export type DatabaseDialect = "postgres" | "mysql";

export const databaseDialect: DatabaseDialect =
  process.env.MANGA_DB_DIALECT?.toLowerCase() === "mysql" ? "mysql" : "postgres";

const config = {
  host: process.env.MANGA_DB_HOST,
  port: Number(process.env.MANGA_DB_PORT || (databaseDialect === "mysql" ? 3306 : 5432)),
  database: process.env.MANGA_DB_NAME,
  user: process.env.MANGA_DB_USER,
  password: process.env.MANGA_DB_PASSWORD,
};

const postgresSchema = process.env.MANGA_DB_SCHEMA?.trim() || "public";
if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(postgresSchema)) {
  throw new Error("MANGA_DB_SCHEMA is invalid.");
}
const postgresPool =
  databaseDialect === "postgres"
    ? new PostgresPool({ ...config, options: `-c search_path=${postgresSchema}` })
    : null;
const mysqlPool: MySqlPool | null =
  databaseDialect === "mysql"
    ? mysql.createPool({
        ...config,
        waitForConnections: true,
        connectionLimit: 10,
        maxIdle: 2,
        idleTimeout: 60_000,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10_000,
        decimalNumbers: true,
      })
    : null;

function mysqlSql(sourceSql: string) {
  let sql = sourceSql
    .replace(/\s+RETURNING\s+[\s\S]+$/i, "")
    .replace(
      /::(?:integer|interval|boolean|bigint|jsonb|text|int)(?:\[\])?\b/gi,
      ""
    )
    .replace(/\bBIGSERIAL\s+PRIMARY\s+KEY\b/gi, "BIGINT AUTO_INCREMENT PRIMARY KEY")
    .replace(/\bTIMESTAMPTZ\b/gi, "DATETIME")
    .replace(/\bJSONB\b/gi, "JSON")
    .replace(
      /\bJSON\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'/gi,
      "JSON NOT NULL DEFAULT (JSON_ARRAY())"
    )
    .replace(
      /\bTEXT(\s+NOT\s+NULL)?\s+DEFAULT\s+('[^']*')/gi,
      "VARCHAR(255)$1 DEFAULT $2"
    )
    .replace(/\b(TEXT)\s+NOT\s+NULL\s+UNIQUE\b/gi, "VARCHAR(255) NOT NULL UNIQUE")
    .replace(
      /\bCREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/gi,
      "CREATE $1INDEX"
    )
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/\bNOW\(\) \+ \(\? \|\| ' seconds'\)(?:::interval)?/gi, "DATE_ADD(NOW(), INTERVAL ? SECOND)")
    .replace(/\s+NULLS\s+(?:FIRST|LAST)\b/gi, "")
    .replace(/FOR\s+UPDATE\s+OF\s+[a-z_][a-z0-9_]*/gi, "FOR UPDATE");

  if (/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i.test(sql)) {
    sql = sql
      .replace(/^\s*INSERT\s+INTO/i, "INSERT IGNORE INTO")
      .replace(/\s+ON\s+CONFLICT\b[\s\S]*?\bDO\s+NOTHING\b/i, "");
  } else if (/\bON\s+CONFLICT\b/i.test(sql)) {
    sql = sql
      .replace(
        /\s+ON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\s+SET\s+/i,
        " ON DUPLICATE KEY UPDATE "
      )
      .replace(/\bEXCLUDED\.([a-z_][a-z0-9_]*)/gi, "VALUES($1)")
      .replace(
        /\s+WHERE\s+[a-z_][a-z0-9_.]*\s+IS\s+DISTINCT\s+FROM\s+(?:'[^']*'|[a-z0-9_]+)\s*$/i,
        ""
      );
  }

  return sql.replace(
    /([a-z_][a-z0-9_.]*)\s+IS\s+DISTINCT\s+FROM\s+('[^']*'|[a-z0-9_]+)/gi,
    "NOT ($1 <=> $2)"
  );
}

function mysqlPlaceholders(sql: string, values: unknown[]) {
  const orderedValues: unknown[] = [];
  const translated = sql.replace(
    /=\s*ANY\(\$(\d+)(?:::[a-z]+(?:\[\])?)?\)|\$(\d+)(?:::[a-z]+(?:\[\])?)?/gi,
    (_match, anyIndex: string | undefined, valueIndex: string | undefined) => {
      const index = Number(anyIndex || valueIndex) - 1;
      const value = values[index];
      if (anyIndex) {
        const array = Array.isArray(value) ? value : [];
        if (!array.length) return "IN (NULL)";
        orderedValues.push(...array);
        return `IN (${array.map(() => "?").join(", ")})`;
      }
      orderedValues.push(value);
      return "?";
    }
  );
  return { sql: translated, values: orderedValues };
}

async function queryMysql<T extends QueryResultRow>(executor: MySqlPool | Awaited<ReturnType<MySqlPool["getConnection"]>>, sql: string, values: unknown[] = []) {
  const prepared = mysqlPlaceholders(sql, values);
  try {
    const [result] = await executor.query(
      mysqlSql(prepared.sql),
      prepared.values
    );
    const rows = Array.isArray(result) ? (result as T[]) : [];
    const rowCount = Array.isArray(result)
      ? result.length
      : (result as ResultSetHeader).affectedRows;
    return { rows, rowCount };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ER_DUP_KEYNAME" || error.code === "ER_DUP_FIELDNAME")
    ) {
      return { rows: [] as T[], rowCount: 0 };
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ER_DUP_ENTRY"
    ) {
      Object.assign(error, { code: "23505" });
    }
    throw error;
  }
}

type DatabaseClient = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
};

type DatabasePool = DatabaseClient & {
  connect(): Promise<DatabaseClient & { release(): void }>;
  end(): Promise<void>;
};

export const pool: DatabasePool = {
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<QueryResult<T>> {
    if (postgresPool) return postgresPool.query<T>(sql, values);
    return (await queryMysql<T>(mysqlPool!, sql, values)) as QueryResult<T>;
  },
  async connect() {
    if (postgresPool) return postgresPool.connect();
    const connection = await mysqlPool!.getConnection();
    return {
      query: <T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) =>
        queryMysql<T>(connection, sql, values) as Promise<QueryResult<T>>,
      release: () => connection.release(),
    };
  },
  async end() {
    if (postgresPool) return postgresPool.end();
    return mysqlPool!.end();
  },
};
