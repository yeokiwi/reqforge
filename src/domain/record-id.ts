/**
 * Record ids: `SPACE/KEY/current` for a live requirement, `SPACE/KEY/<n>` for its snapshot
 * in baseline n. spec: 05-baselines-and-diff.md §4 (addressing); 08 §7 (webhook payloads
 * carry it so a consumer can address the requirement back). Pure.
 */
export type RecordId = { spaceKey: string; key: string; baseline: number | 'current' };

export function formatRecordId(spaceKey: string, key: string, baselineNumber: number | null): string {
  return `${spaceKey}/${key}/${baselineNumber === null ? 'current' : String(baselineNumber)}`;
}

export function parseRecordId(raw: string): RecordId | null {
  const match = /^([A-Z][A-Z0-9]{1,15})\/([A-Za-z0-9._-]{2,64})\/(current|\d+)$/.exec(raw.trim());
  if (!match) return null;
  return {
    spaceKey: match[1]!,
    key: match[2]!,
    baseline: match[3] === 'current' ? 'current' : Number.parseInt(match[3]!, 10),
  };
}
