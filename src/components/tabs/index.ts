/*
 * tabs/index.ts - the six views inside Step 3, one file each.
 *
 * They share one idea: D1 already answered the hard questions (which labels disappeared,
 * which department they belonged to), so these views FORMAT answers rather than compute
 * them. They used to be one 665-line file; a change to the history tab can no longer touch
 * the summary, and this barrel keeps every call site unchanged.
 */
export { SummaryTab } from './SummaryTab';
export { HistoryTab } from './HistoryTab';
export { MergedTab } from './MergedTab';
export { DupesTab } from './DupesTab';
export { ConflictsTab } from './ConflictsTab';
export { SourcesTab } from './SourcesTab';
