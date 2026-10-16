/** Serializable sync status passed from loaders to the SyncStatus banner. */
export interface SyncInfo {
  syncing: boolean;
  stage: string | null;
  error: string | null;
  fetchedAt: string | null;
  hasData: boolean;
}
