/**
 * Housekeeping that has to happen without a page being open.
 *
 * Deliberately narrow: tombstones expire so a long-offline device cannot
 * resurrect deletions, and nothing else is ever removed automatically. The trash
 * is emptied by the user, not by a timer — deleting someone's records because a
 * date passed is not a behaviour a tab manager should have.
 */
import { pruneTombstones } from "../data/repo";

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface SweepResult {
  prunedTombstones: number;
}

export async function sweep(): Promise<SweepResult> {
  const pruned = await pruneTombstones(TOMBSTONE_TTL_MS);
  return { prunedTombstones: pruned };
}
