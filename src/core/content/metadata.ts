export const contentId = /^[a-z0-9][a-z0-9-]{2,79}$/;

export function publicText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 &&
    Array.from(value).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && Array.from(value).length <= max;
}

export function admissionTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) && date.toISOString() === value.replace('Z', '.000Z');
}

