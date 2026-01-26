export function normalizeVehicleType(value?: string | null): string | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('moto')) return 'MOTO';
  if (raw.includes('fiorino')) return 'FIORINO';
  if (raw.includes('passeio')) return 'PASSEIO';
  return raw.toUpperCase();
}
