import { NonRetryableJobError } from '../../utils/errors';
import type { JobExecutionContext, JobHandler } from '../handler.types';

type Row = Record<string, unknown>;

interface FilterOperation {
  type: 'filter';
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'lt' | 'contains';
  value: unknown;
}
interface MapOperation {
  type: 'map';
  field: string;
  transform: 'uppercase' | 'lowercase' | 'trim' | 'toNumber' | 'toString';
}
interface SortOperation {
  type: 'sort';
  field: string;
  direction?: 'asc' | 'desc';
}
type Operation = FilterOperation | MapOperation | SortOperation;

interface DataTransformationPayload {
  input: Row[];
  operations: Operation[];
}

function applyFilter(rows: Row[], op: FilterOperation): Row[] {
  return rows.filter((row) => {
    const cell = row[op.field];
    switch (op.operator) {
      case 'eq':
        return cell === op.value;
      case 'neq':
        return cell !== op.value;
      case 'gt':
        return typeof cell === 'number' && typeof op.value === 'number' && cell > op.value;
      case 'lt':
        return typeof cell === 'number' && typeof op.value === 'number' && cell < op.value;
      case 'contains':
        return typeof cell === 'string' && typeof op.value === 'string' && cell.includes(op.value);
    }
  });
}

function applyMap(rows: Row[], op: MapOperation): Row[] {
  return rows.map((row) => {
    const cell = row[op.field];
    let transformed: unknown = cell;
    switch (op.transform) {
      case 'uppercase':
        transformed = typeof cell === 'string' ? cell.toUpperCase() : cell;
        break;
      case 'lowercase':
        transformed = typeof cell === 'string' ? cell.toLowerCase() : cell;
        break;
      case 'trim':
        transformed = typeof cell === 'string' ? cell.trim() : cell;
        break;
      case 'toNumber':
        transformed = Number(cell);
        break;
      case 'toString':
        transformed = String(cell);
        break;
    }
    return { ...row, [op.field]: transformed };
  });
}

function applySort(rows: Row[], op: SortOperation): Row[] {
  const direction = op.direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[op.field] as string | number | undefined;
    const bv = b[op.field] as string | number | undefined;
    if (av === bv) return 0;
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return av > bv ? direction : -direction;
  });
}

/**
 * A small, pure in-memory pipeline — filter, map (per-field string/number
 * transforms), sort — applied in the order given. No file, no network, no
 * database: which is exactly why this is the easiest handler to unit
 * test in complete isolation
 * (tests/data-transformation.handler.test.ts runs with zero external
 * dependencies, no mocking required at all).
 */
export const dataTransformationHandler: JobHandler = {
  async execute(ctx: JobExecutionContext) {
    const payload = ctx.payload as unknown as DataTransformationPayload;

    if (!Array.isArray(payload?.input)) {
      throw new NonRetryableJobError('DATA_TRANSFORMATION payload requires an "input" array');
    }
    if (!Array.isArray(payload?.operations)) {
      throw new NonRetryableJobError('DATA_TRANSFORMATION payload requires an "operations" array');
    }

    let rows = payload.input;
    const total = payload.operations.length;

    for (let i = 0; i < payload.operations.length; i += 1) {
      const op = payload.operations[i];
      switch (op.type) {
        case 'filter':
          rows = applyFilter(rows, op);
          break;
        case 'map':
          rows = applyMap(rows, op);
          break;
        case 'sort':
          rows = applySort(rows, op);
          break;
        default:
          throw new NonRetryableJobError(
            `Unknown operation type "${(op as Operation).type}"`,
          );
      }
      await ctx.updateProgress(Math.round(((i + 1) / Math.max(total, 1)) * 100));
    }

    return {
      inputCount: payload.input.length,
      outputCount: rows.length,
      output: rows,
    };
  },
};
