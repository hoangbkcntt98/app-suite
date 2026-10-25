import { Pool, type QueryResultRow } from "pg";

export type CrowdworksJobRow = QueryResultRow & {
  id: number | string;
  crowdworks_job_id: string | null;
  canonical_url: string;
  title: string;
  client_name: string | null;
  posted_date: string | Date | null;
  application_deadline: string | Date | null;
  budget_text: string | null;
  priority: number | null;
  automation_level: string | null;
  automation_reason: string | null;
  tool_idea: string | null;
  poc_scope: string | null;
  estimated_manual_workload: string | null;
  estimated_automation_percentage: string | null;
  suggested_project_price: string | null;
  japanese_proposal: string | null;
  first_seen_at: string | Date | null;
  last_seen_at: string | Date | null;
  status: string;
  source: string;
  total_count: string;
};

type GlobalWithCrowdworksPool = typeof globalThis & {
  crowdworksPool?: Pool;
};

function getConnectionString() {
  const connectionString = process.env.LIFEQUEST_CROWDWORKS_DATABASE_URL ?? process.env.LIFEQUEST_DATABASE_URL;

  if (!connectionString) {
    throw new Error("LIFEQUEST_CROWDWORKS_DATABASE_URL is not configured.");
  }

  return connectionString;
}

export function getCrowdworksPool() {
  const globalWithPool = globalThis as GlobalWithCrowdworksPool;

  if (!globalWithPool.crowdworksPool) {
    const schema = process.env.LIFEQUEST_CROWDWORKS_SCHEMA?.trim() || "public";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw new Error("LIFEQUEST_CROWDWORKS_SCHEMA is invalid.");
    }
    globalWithPool.crowdworksPool = new Pool({
      connectionString: getConnectionString(),
      options: `-c search_path=${schema}`,
      max: 5,
    });
  }

  return globalWithPool.crowdworksPool;
}

export function serializeCrowdworksJob(row: CrowdworksJobRow) {
  const serializeDate = (value: string | Date | null | undefined) => {
    if (!value) return null;

    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  };

  return {
    id: String(row.id),
    crowdworksJobId: row.crowdworks_job_id,
    canonicalUrl: row.canonical_url,
    title: row.title,
    clientName: row.client_name,
    postedDate: serializeDate(row.posted_date),
    applicationDeadline: serializeDate(row.application_deadline),
    budgetText: row.budget_text,
    priority: row.priority,
    automationLevel: row.automation_level,
    automationReason: row.automation_reason,
    toolIdea: row.tool_idea,
    pocScope: row.poc_scope,
    estimatedManualWorkload: row.estimated_manual_workload,
    estimatedAutomationPercentage: row.estimated_automation_percentage,
    suggestedProjectPrice: row.suggested_project_price,
    japaneseProposal: row.japanese_proposal,
    firstSeenAt: serializeDate(row.first_seen_at),
    lastSeenAt: serializeDate(row.last_seen_at),
    status: row.status,
    source: row.source,
  };
}
