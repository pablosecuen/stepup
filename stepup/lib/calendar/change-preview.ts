import { createHash } from 'node:crypto';

/** A confirmation belongs to the exact scheduling/financial result that was shown. */
export function activityPreviewFingerprint(input: {
  source: string; start: string; end: string; kind: string; scope: string;
  fee: number; amount: number; effective: string; criterion: string;
  rule?: string; version?: string; endIds: string[]; participants: string[]; title: string | null;
}): string {
  return createHash('sha256').update(JSON.stringify({
    ...input, endIds: [...input.endIds].sort(), participants: [...input.participants].sort(),
  })).digest('hex');
}

export function replacementPreviewKey(items: {id: string; start: string; end: string; participantIds: string[]}[]): string {
  return createHash('sha256').update(JSON.stringify(items.map(item=>({
    id:item.id,start:item.start,end:item.end,students:[...item.participantIds].sort(),
  })).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex');
}
