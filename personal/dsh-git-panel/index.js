/**
 * Host half of dsh-git-panel.
 *
 * Publishes one authenticated read-only route that reports the Git state of the
 * calling Session's working directory. The browser half is discovered from
 * package.json `dsh.client` and `exports["./client"]`; this module never
 * imports it.
 */
import { computeLanes } from './lanes.js'
import { parseLog, parseStatus } from './parse.js'

export const name = 'git-panel'
export const inject = ['connection', 'sessions', 'subprocess']

/** Absolute route path; Connection authenticates every request it dispatches. */
const PANEL_PATH = '/api/git.panel'
/** Collected-output cap for one git command, per stream. */
const OUTPUT_CAP_BYTES = 4 * 1024 * 1024
/** Termination grace handed to the subprocess provider. */
const GRACE_MS = 10_000
/** Cap on reported uncommitted files. */
const MAX_FILES = 500
/** Commits returned when the request names no limit. */
const DEFAULT_COMMITS = 200
/** Largest commit page a request may ask for. */
const MAX_COMMITS = 500
/** One log record: hash, parents, author, author time, ref decorations, subject. */
const LOG_FORMAT = '%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e'

/**
 * Read one collected stream without throwing on a cap overrun.
 * @param reader - the collected stream reader, absent when the provider did not collect it.
 * @returns the captured text and whether the cap truncated it.
 */
function readCollected(reader) {
  if (reader === undefined) return { text: '', lossy: false }
  const read = reader.readFrom(0)
  return { text: read.text, lossy: read.lossy }
}

/**
 * Run one git command through the subprocess service.
 *
 * The arguments are passed as fixed argv; no shell parses them, so no path or
 * branch name can become a command.
 * @param ctx - host context carrying the subprocess service.
 * @param cwd - directory the command runs in.
 * @param args - git arguments without the leading executable name.
 * @param signal - request cancellation, forwarded to the child process.
 * @returns the exit code, both streams, and whether either was truncated.
 */
async function runGit(ctx, cwd, args, signal) {
  const handle = ctx.subprocess.spawn({
    argv: ['git', ...args],
    cwd,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: OUTPUT_CAP_BYTES },
      stderr: { maxBytes: OUTPUT_CAP_BYTES },
    },
    graceMs: GRACE_MS,
    signal,
  })
  const outcome = await handle.done
  const stdout = readCollected(handle.collected.stdout)
  const stderr = readCollected(handle.collected.stderr)
  return {
    exitCode: outcome.exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    lossy: stdout.lossy || stderr.lossy,
  }
}

/**
 * Build a JSON response.
 * @param body - the envelope to serialize.
 * @param status - the HTTP status.
 * @returns the response.
 */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Resolve the requested page size.
 * @param raw - the raw `limit` query value, absent when the request omitted it.
 * @returns a whole number of commits between 1 and {@link MAX_COMMITS}.
 */
function pageSize(raw) {
  if (raw === null) return DEFAULT_COMMITS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_COMMITS
  return Math.min(Math.floor(parsed), MAX_COMMITS)
}

/**
 * Read the commit window, newest first.
 *
 * `--branches --tags --remotes HEAD` walks every ref plus the current checkout.
 * Without `HEAD` a commit made on a detached checkout belongs to no ref and
 * would vanish; with it, a repository whose branches were all deleted still
 * shows its history. An unborn HEAD contributes no revision list, so the caller
 * skips this command entirely in that state. Git deduplicates a commit reached
 * through several refs.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param limit - commits to return; one extra is fetched to detect more.
 * @param signal - request cancellation.
 * @returns the page of commits, whether older commits exist, and whether the capture was cut short.
 */
async function readCommits(ctx, cwd, limit, signal) {
  const log = await runGit(ctx, cwd, [
    'log',
    '--branches',
    '--tags',
    '--remotes',
    'HEAD',
    '--topo-order',
    `--max-count=${String(limit + 1)}`,
    `--format=${LOG_FORMAT}`,
  ], signal)
  if (log.exitCode !== 0) {
    return { commits: [], hasMore: false, degraded: true }
  }
  const all = parseLog(log.stdout)
  return {
    commits: all.slice(0, limit),
    hasMore: all.length > limit,
    degraded: log.lossy,
  }
}

/**
 * Answer one panel read.
 *
 * The working directory comes from the Session header, never from the request,
 * so a client cannot ask git about an arbitrary directory.
 * @param ctx - host context.
 * @param request - the authenticated fetch request.
 * @returns the JSON envelope.
 */
async function readPanel(ctx, request) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  if (sessionId === null || sessionId === '') {
    return json({ ok: false, error: 'missing sessionId' }, 400)
  }
  const cwd = ctx.sessions.get(sessionId)?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') {
    return json({ ok: false, error: 'this session has no working directory' }, 404)
  }
  const limit = pageSize(url.searchParams.get('limit'))

  let status
  try {
    status = await runGit(ctx, cwd, ['status', '--porcelain=v1', '-b', '-z', '--untracked-files=all'], request.signal)
  } catch {
    request.signal.throwIfAborted()
    // Spawn or provider failure; its message may carry host paths, so it is
    // classified here rather than echoed to the browser.
    return json({ ok: false, error: 'git could not be run' }, 500)
  }
  if (status.exitCode !== 0) {
    if (/not a git repository/iu.test(status.stderr)) {
      return json({ ok: true, value: { cwd, state: 'not-git' } })
    }
    return json({ ok: false, error: 'git status failed' }, 500)
  }

  const { head, counts, changes } = parseStatus(status.stdout)
  let commits = []
  let lanes = []
  let hasMore = false
  let historyFailed = false
  if (!head.unborn) {
    try {
      const page = await readCommits(ctx, cwd, limit, request.signal)
      commits = page.commits
      lanes = computeLanes(commits)
      hasMore = page.hasMore
      historyFailed = page.degraded
    } catch {
      request.signal.throwIfAborted()
      historyFailed = true
    }
  }

  return json({
    ok: true,
    value: {
      cwd,
      state: head.unborn ? 'empty' : 'ready',
      branch: head.branch,
      upstream: head.upstream,
      ahead: head.ahead,
      behind: head.behind,
      detached: head.detached,
      clean: counts.total === 0,
      counts,
      changes: changes.slice(0, MAX_FILES),
      truncated: changes.length > MAX_FILES || status.lossy,
      limit,
      commits,
      lanes,
      hasMore,
      historyFailed,
    },
  })
}

/**
 * Mount the Host half.
 * @param ctx - host context carrying connection, sessions, and subprocess.
 */
export function apply(ctx) {
  ctx.effect(() => {
    const registration = ctx.connection.fetch.register({
      path: PANEL_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: request => readPanel(ctx, request),
    })
    return () => registration.then(dispose => dispose())
  })
}
