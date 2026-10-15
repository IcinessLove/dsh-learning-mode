/**
 * Learning Mode — activation log.
 *
 * The Host half runs inside the Desktop process, where a failed activation is
 * otherwise invisible from the workspace. Every step of `apply()` appends one
 * JSON line here, so the plugin can be diagnosed by reading a file:
 *
 *   <DSH_HOME>/learning-mode.log
 *
 * No shipped-package imports: this module only touches node builtins so it can
 * never be the reason a bundle fails to load.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export function logPath() {
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.length > 0) return join(home, 'learning-mode.log');
  /* The Desktop-launched Host process does not export DSH_HOME; fall back to the
   * default Harness home (what resolveDshHome() would resolve) so diagnostics
   * always land in a findable place instead of a per-process temp dir. */
  const standard = join(homedir(), '.dsh');
  return standard.length > 0 ? join(standard, 'learning-mode.log') : join(tmpdir(), 'learning-mode.log');
}

/** Append one diagnostic line; never throws, never blocks activation. */
export async function logEvent(event, payload = {}) {
  const line = `${JSON.stringify({ at: new Date().toISOString(), event, ...payload })}\n`;
  const target = logPath();
  try {
    await appendFile(target, line, 'utf8');
  } catch (error) {
    try {
      await mkdir(dirname(target), { recursive: true });
      await appendFile(target, line, 'utf8');
    } catch (nested) {
      /* diagnostics are best-effort by design */
    }
  }
}
