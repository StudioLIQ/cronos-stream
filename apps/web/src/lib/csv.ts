// CSV generation and download utilities

export function escapeCsvField(field: string | number | null | undefined): string {
  if (field === null || field === undefined) return '';
  const str = String(field);
  // Escape double quotes and wrap in quotes if contains comma, newline, or quote
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsv<T extends Record<string, unknown>>(
  data: T[],
  columns: { key: keyof T; header: string }[]
): string {
  const headerRow = columns.map((col) => escapeCsvField(col.header)).join(',');
  const dataRows = data.map((row) =>
    columns.map((col) => escapeCsvField(row[col.key] as string | number | null)).join(',')
  );
  return [headerRow, ...dataRows].join('\n');
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function formatTimestamp(ts: number | null | undefined): string {
  if (!ts) return '';
  return new Date(ts * 1000).toISOString();
}

export function formatDatetime(dt: string | null | undefined): string {
  if (!dt) return '';
  return new Date(dt).toISOString();
}
