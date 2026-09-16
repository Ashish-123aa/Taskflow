export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, 'day');
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatDurationFromDates(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  return formatDuration(new Date(end).getTime() - new Date(start).getTime());
}
