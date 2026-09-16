export interface StatusCount {
  status: string;
  count: number;
}

/**
 * Deliberately its own module with zero imports from '@taskflow/shared'
 * (which pulls in a live PrismaClient the moment it's imported). Keeping
 * this pure formatting logic separate from report-generation.handler.ts
 * (which does the Prisma aggregation) means it can be unit tested with no
 * database, no generated Prisma Client, nothing but plain data in and a
 * string out — see tests/report-generation.format.test.ts.
 */
export function formatJobSummaryCsv(rows: StatusCount[]): string {
  const header = 'status,count';
  const lines = rows.map((r) => `${r.status},${r.count}`);
  return [header, ...lines].join('\n');
}
