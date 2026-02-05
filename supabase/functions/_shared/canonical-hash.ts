/**
 * Phase 13 — Canonical JSON stringify + SHA-256 hash
 * 
 * Garantit un hash stable indépendant de:
 * - L'ordre des clés JSON
 * - Les types Date vs string
 * - Les valeurs undefined/null
 * - Les strings JSON imbriquées
 */

/**
 * Normalise une valeur avant sérialisation canonique
 * - Parse les strings JSON imbriquées
 * - Convertit Date en ISO string
 * - Convertit undefined en null
 */
function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  
  // Garde-fou #3: si c'est une string qui ressemble à du JSON, parser
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return normalizeValue(JSON.parse(trimmed));
      } catch {
        return value; // Pas du JSON valide, garder comme string
      }
    }
    return value;
  }
  
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  
  if (typeof value === 'object' && value !== null) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      normalized[key] = normalizeValue((value as Record<string, unknown>)[key]);
    }
    return normalized;
  }
  
  // Gérer NaN et Infinity
  if (typeof value === 'number') {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return null;
    }
  }
  
  return value;
}

/**
 * Stringify JSON de manière canonique (clés triées récursivement)
 */
export function canonicalStringify(obj: unknown): string {
  const normalized = normalizeValue(obj);
  
  if (normalized === null) {
    return 'null';
  }
  
  if (typeof normalized !== 'object') {
    return JSON.stringify(normalized);
  }
  
  if (Array.isArray(normalized)) {
    const items = normalized.map(item => canonicalStringify(item));
    return '[' + items.join(',') + ']';
  }
  
  // Object: trier les clés récursivement
  const sortedKeys = Object.keys(normalized).sort();
  const pairs = sortedKeys.map(key => {
    const value = (normalized as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + canonicalStringify(value);
  });
  
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute SHA-256 hash of canonical JSON
 */
export async function computeCanonicalHash(data: unknown): Promise<string> {
  const canonical = canonicalStringify(data);
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
