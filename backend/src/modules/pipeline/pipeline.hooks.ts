/**
 * Best-effort bridges called by the estimate, proposal, project and invoice modules after their own change succeeded.
 * A pipeline failure is logged and never undoes or blocks the original action; the next sync (or a backfill) repairs it.
 */
import { createLogger, type Logger } from '../../utils/logger.js';
import { syncFromEstimate, syncFromInvoice, syncFromProject, type SyncActor } from './pipeline.service.js';

let log: Logger | undefined;
const getLog = (): Logger => (log ??= createLogger());

async function safe(kind: string, id: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    getLog().error({ err, kind, id }, 'Pipeline sync failed (best-effort)');
  }
}

export const syncPipelineFromEstimate = (id: string, a: SyncActor): Promise<void> => safe('estimate', id, () => syncFromEstimate(id, a));
export const syncPipelineFromProject = (id: string, a: SyncActor): Promise<void> => safe('project', id, () => syncFromProject(id, a));
export const syncPipelineFromInvoice = (id: string, a: SyncActor): Promise<void> => safe('invoice', id, () => syncFromInvoice(id, a));
