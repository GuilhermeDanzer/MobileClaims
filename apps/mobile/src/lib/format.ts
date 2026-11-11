const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Formats an ISO timestamp or a YYYY-MM-DD date as "Nov 5, 2026". */
export function formatDate(value: string): string {
  // Date-only strings parse as UTC midnight; keep them in the same day.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const year = Number(dateOnly[1]);
    return `${MONTHS[month - 1] ?? ''} ${day}, ${year}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${MONTHS[date.getMonth()] ?? ''} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Masks free-typed digits into "MM/DD/YYYY" so the customer never has to type
 * the slashes. Non-digits are dropped and input is capped at eight digits.
 */
export function maskDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  let masked = digits.slice(0, 2);
  if (digits.length > 2) masked += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) masked += `/${digits.slice(4, 8)}`;
  return masked;
}

/** Formats an ISO timestamp with a time, for the status timeline. */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const meridiem = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${formatDate(value)}, ${hours}:${minutes} ${meridiem}`;
}

/** Displays a stored ISO date in the date field, preserving incomplete input. */
export function formatDateInput(value: string): string {
  return value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1');
}

/** Keeps complete input compatible with the API and existing saved drafts. */
export function dateInputToIso(value: string): string {
  return value.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2');
}

/** Checks actual calendar dates, including leap years, without timezone conversion. */
export function isValidDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
}
