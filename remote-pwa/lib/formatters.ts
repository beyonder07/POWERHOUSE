export function currency(value: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value || 0);
}

export function formatDate(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value?: string | null) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function buildCalendar(month: string, entries: Array<{ date: string; status: 'present' | 'absent' }>) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const firstDay = new Date(Date.UTC(year, monthIndex, 1));
  const totalDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const statusMap = new Map(entries.map((entry) => [entry.date, entry.status]));

  const cells: Array<{ key: string; label: string; status: 'present' | 'absent' | 'empty'; outsideMonth: boolean }> = [];
  const startOffset = firstDay.getUTCDay();

  for (let index = 0; index < startOffset; index += 1) {
    cells.push({ key: `pad-${index}`, label: '', status: 'empty', outsideMonth: true });
  }

  for (let day = 1; day <= totalDays; day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    const status = statusMap.get(date) || 'empty';
    cells.push({ key: date, label: String(day), status, outsideMonth: false });
  }

  return cells;
}
