/** Safety checks shared by the demo seed and reset scripts. */
export function assertDemoSeedAllowed(opts: { destructive: boolean }): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production') {
    throw new Error('Refusing to run demo seed tooling with NODE_ENV=production.');
  }
  const uri = process.env.MONGODB_URI ?? '';
  const isLocal = /^mongodb:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(uri);
  if (opts.destructive && !isLocal && process.env.DEMO_ALLOW_REMOTE_RESET !== '1') {
    throw new Error(
      'Refusing to reset demo data: MONGODB_URI is not a local database. ' +
        'Set DEMO_ALLOW_REMOTE_RESET=1 only if you are certain it is a throwaway database.',
    );
  }
  if (!isLocal && process.env.DEMO_ALLOW_REMOTE_SEED !== '1') {
    throw new Error(
      'Refusing to seed demo data into a non-local database. Set DEMO_ALLOW_REMOTE_SEED=1 to override for a dev/staging database.',
    );
  }
}
