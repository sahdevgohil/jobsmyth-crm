/**
 * In-process scheduler for storm data. No Redis or job queue: a timer in the API process calls the same import
 * code an administrator triggers by hand. A database lock keeps two server instances from importing at once.
 * Disable with STORM_SYNC_ENABLED=false; tune with STORM_SYNC_INTERVAL_MINUTES (default 60).
 */
import { createLogger, type Logger } from '../../utils/logger.js';
import { ensureDefaultCompany } from '../companies/company.service.js';
import { UserModel } from '../users/user.model.js';
import { evaluateEvents } from './storm.alerts.js';
import { detectFlags } from './storm.followups.js';
import { createRun, defaultDeps, executeRun, type IngestDeps } from './storm.ingest.js';

let log: Logger | undefined;
const getLog = (): Logger => (log ??= createLogger());
let timer: NodeJS.Timeout | null = null;

export async function runScheduledSync(deps: IngestDeps = defaultDeps()): Promise<{ started: boolean; reason?: string }> {
  let run;
  try {
    run = await createRun({ source: 'all', kind: 'daily' }, deps);
  } catch (err) {
    return { started: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const done = await executeRun(run._id.toString(), { source: 'all', kind: 'daily' }, deps, (ids) => evaluateEvents(ids).then(() => undefined));
  // New reports may concern completed jobs: look for past customers worth a follow-up.
  try {
    const company = await ensureDefaultCompany();
    const admin = await UserModel.findOne({ role: 'admin', isActive: true }).select('_id').lean();
    if (admin) await detectFlags({ userId: admin._id.toString(), role: 'admin', companyId: company._id.toString() });
  } catch (err) {
    getLog().warn({ err }, 'Follow-up scan after storm sync failed');
  }
  getLog().info({ status: done.status, counts: done.counts }, 'Scheduled storm sync finished');
  return { started: true };
}

export function startStormScheduler(): void {
  if (timer || process.env.STORM_SYNC_ENABLED === 'false' || process.env.NODE_ENV === 'test') return;
  const minutes = Math.max(15, Number(process.env.STORM_SYNC_INTERVAL_MINUTES ?? 60));
  const tick = (): void => { void runScheduledSync().catch((err) => getLog().error({ err }, 'Scheduled storm sync crashed')); };
  timer = setInterval(tick, minutes * 60_000);
  timer.unref();
  setTimeout(tick, 30_000).unref(); // first run shortly after start-up
  getLog().info({ everyMinutes: minutes }, 'Storm data scheduler started');
}

export function stopStormScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
