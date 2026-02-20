/**
 * Calcule la date valid_until selon la période choisie.
 */
export type ValidityPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'permanent';

export function computeValidUntil(
  period: ValidityPeriod,
  dayOfWeek: number = 3 // 0=Sun … 3=Wed
): string {
  const now = new Date();

  switch (period) {
    case 'daily': {
      const d = new Date(now);
      d.setUTCHours(23, 59, 59, 0);
      return d.toISOString();
    }
    case 'weekly': {
      const current = now.getUTCDay();
      const daysUntil = ((dayOfWeek - current + 7) % 7) || 7;
      const d = new Date(now);
      d.setUTCDate(now.getUTCDate() + daysUntil);
      d.setUTCHours(23, 59, 59, 0);
      return d.toISOString();
    }
    case 'monthly': {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
      return d.toISOString();
    }
    case 'yearly': {
      const d = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59));
      return d.toISOString();
    }
    case 'permanent':
      return '2100-01-01T00:00:00.000Z';
    default:
      return computeValidUntil('weekly', 3);
  }
}

export const PERIOD_LABELS: Record<ValidityPeriod, string> = {
  daily: 'Quotidienne',
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  yearly: 'Annuelle',
  permanent: 'Permanente',
};

export const DAY_LABELS = [
  'Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi',
];

export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'CNY', 'JPY'];
