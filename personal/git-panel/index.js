/**
 * Host half of @wintry/git-panel.
 *
 * Publishes one authenticated route for the calling Session's working
 * directory. GET reports Git state. POST updates remotes or fast-forwards the
 * current branch to the remotes selected for the one-click push. The browser
 * half is discovered from package.json `dsh.client` and `exports["./client"]`;
 * this module never imports it.
 */
import { computeLanes } from './lanes.js'
import {
  branchNameOk,
  commitOidOk,
  mergeCommitFiles,
  parseCommitShow,
  parseLog,
  parseNameStatus,
  parseNumstat,
  parseRemotes,
  parseStatus,
  planPush,
  remoteArgOk,
  remoteNameOk,
  remoteUrlOk,
  remoteUrlUnsafe,
} from './parse.js'

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
/** Files named in one opened commit before the remainder is only counted. */
const MAX_COMMIT_FILES = 40
/** `git show -s` fields: id, parents, author, committer, subject, body. */
const COMMIT_FORMAT = '%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%s%x00%b'
/** Commits returned when the request names no limit. */
const DEFAULT_COMMITS = 200
/** Largest commit page a request may ask for. */
const MAX_COMMITS = 500
/** One log record: hash, parents, author, author time, ref decorations, subject. */
const LOG_FORMAT = '%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e'
/** Local git commands give up after this long so a stuck lock cannot hold the route. */
const LOCAL_MS = 20_000
/** Network git commands give up after this long instead of waiting on a prompt. */
const NETWORK_MS = 60_000
/** Full object id, either SHA-1 or SHA-256. */
const OID = /^[0-9a-f]{40,64}$/i
/** Local config flag: the one-click selection was saved and must not be inferred. */
const PUSH_CONFIGURED = 'wintry.gitpanel.pushConfigured'
/** Local config multivar: remote names included in the one-click push. */
const PUSH_REMOTE = 'wintry.gitpanel.push'
/**
 * Keeps credential helpers from opening a prompt. A missing credential fails
 * the command instead of parking the route.
 */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_PAGER: 'cat' }
/** Working directories with a remote or push command still running. */
const busyDirs = new Set()

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
    env: GIT_ENV,
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
 * Run one git command and give up when it exceeds `ms` or the request aborts.
 *
 * A timeout is reported as `aborted` so the caller can refuse the push instead
 * of treating a killed process as success. Request cancellation still throws.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param args - git arguments without the leading executable name.
 * @param parent - request cancellation.
 * @param ms - deadline in milliseconds.
 * @returns the command result. `aborted` is true only for the deadline.
 */
async function git(ctx, cwd, args, parent, ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, ms)
  const onParent = () => { controller.abort() }
  if (parent.aborted) controller.abort()
  else parent.addEventListener('abort', onParent, { once: true })
  try {
    const result = await runGit(ctx, cwd, args, controller.signal)
    if (controller.signal.aborted && !parent.aborted) return { ...result, aborted: true }
    return result
  } catch (error) {
    parent.throwIfAborted()
    if (controller.signal.aborted) return { exitCode: null, stdout: '', stderr: '', lossy: false, aborted: true }
    throw error
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', onParent)
  }
}

/**
 * First stderr line safe to show in the panel.
 *
 * Userinfo in a URL is removed. The rest is capped so a long hint cannot
 * take over the dialog.
 * @param text - the raw stderr.
 * @returns a single short line, or an empty string.
 */
function firstLine(text) {
  const line = String(text).split(/\r?\n/).find(item => item.trim() !== '') ?? ''
  return line.replace(/:\/\/[^/\s]+@/g, '://').slice(0, 200)
}

/**
 * Reserve one working directory for a mutating git command.
 * @param cwd - the session working directory.
 * @returns false when another mutation is already running there.
 */
function claim(cwd) {
  if (busyDirs.has(cwd)) return false
  busyDirs.add(cwd)
  return true
}

/**
 * Read which remotes the one-click push includes.
 *
 * Missing config means the choice has never been saved. Git exits 1 for an
 * unset key; any other failure is reported instead of being treated as empty.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param signal - request cancellation.
 * @returns the saved names, or `failed` when config could not be read.
 */
async function readSelection(ctx, cwd, signal) {
  const flag = await git(ctx, cwd, ['config', '--local', '--get', PUSH_CONFIGURED], signal, LOCAL_MS)
  if (flag.aborted || (flag.exitCode !== 0 && flag.exitCode !== 1)) {
    return { failed: true, configured: false, names: [] }
  }
  const configured = flag.exitCode === 0 && flag.stdout.trim() === 'true'
  if (!configured) return { failed: false, configured: false, names: [] }
  const listed = await git(ctx, cwd, ['config', '--local', '--get-all', PUSH_REMOTE], signal, LOCAL_MS)
  if (listed.aborted || (listed.exitCode !== 0 && listed.exitCode !== 1)) {
    return { failed: true, configured: true, names: [] }
  }
  const names = []
  for (const line of listed.stdout.split(/\r?\n/)) {
    const name = line.trim()
    if (remoteArgOk(name) && !names.includes(name)) names.push(name)
  }
  return { failed: false, configured: true, names }
}

/**
 * Replace the saved one-click selection.
 *
 * The flag is written first, then the names. An empty name list stays
 * configured so the next read does not infer the old defaults again.
 * `unset-all` exits 5 when the key was already absent.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param names - remote names to include, already validated.
 * @param signal - request cancellation.
 * @returns whether every config write succeeded.
 */
async function writeSelection(ctx, cwd, names, signal) {
  const flag = await git(ctx, cwd, ['config', '--local', PUSH_CONFIGURED, 'true'], signal, LOCAL_MS)
  if (flag.exitCode !== 0) return false
  const cleared = await git(ctx, cwd, ['config', '--local', '--unset-all', PUSH_REMOTE], signal, LOCAL_MS)
  if (cleared.exitCode !== 0 && cleared.exitCode !== 5) return false
  for (const name of names) {
    const added = await git(ctx, cwd, ['config', '--local', '--add', PUSH_REMOTE, name], signal, LOCAL_MS)
    if (added.exitCode !== 0) return false
  }
  return true
}

/**
 * List remotes and whether each one is included in the one-click push.
 *
 * Until the user saves a choice, a remote is included only when this
 * repository already has its remote-tracking ref for the current branch.
 * That keeps a fetch-only remote, such as an upstream that does not contain
 * this branch, out of the shortcut until someone checks it.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param branch - current branch, or null when there is nothing to track.
 * @param signal - request cancellation.
 * @returns the rows, or `failed` when the list could not be read.
 */
async function readRemoteRows(ctx, cwd, branch, signal) {
  const listed = await git(ctx, cwd, ['remote', '-v'], signal, LOCAL_MS)
  if (listed.aborted || listed.exitCode !== 0) return { remotes: [], failed: true }
  const selection = await readSelection(ctx, cwd, signal)
  if (selection.failed) return { remotes: [], failed: true }
  const rows = []
  for (const remote of parseRemotes(listed.stdout)) {
    const url = remote.pushUrl ?? remote.fetchUrl ?? ''
    const unsafe = [remote.fetchUrl, remote.pushUrl].some(item => item !== null && remoteUrlUnsafe(item))
    let push = false
    if (selection.configured) push = selection.names.includes(remote.name)
    else if (!unsafe && branch !== null && branchNameOk(branch)) {
      const shown = await git(ctx, cwd, [
        'show-ref', '--verify', '--quiet', `refs/remotes/${remote.name}/${branch}`,
      ], signal, LOCAL_MS)
      if (shown.aborted) return { remotes: [], failed: true }
      push = shown.exitCode === 0
    }
    rows.push({ name: remote.name, url, push, unsafe })
    if (rows.length >= 100) break
  }
  return { remotes: rows, failed: false }
}

/**
 * Classify one remote tip against HEAD.
 *
 * The fetch updates only the remote-tracking ref. A missing branch is
 * `absent`, not an invitation to create it. Anything that is not proved to
 * be an ancestor of HEAD is unsafe for this shortcut.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param remote - remote name.
 * @param branch - current branch name.
 * @param signal - request cancellation.
 * @returns `same`, `ff`, `diverged`, `absent`, or `unreachable`.
 */
async function classifyRemote(ctx, cwd, remote, branch, signal) {
  const tracking = `refs/remotes/${remote}/${branch}`
  const fetched = await git(ctx, cwd, [
    'fetch', '--no-tags', remote, `+refs/heads/${branch}:${tracking}`,
  ], signal, NETWORK_MS)
  if (fetched.aborted || fetched.exitCode === null) {
    return { name: remote, kind: 'unreachable', detail: firstLine(fetched.stderr) }
  }
  if (fetched.exitCode !== 0) {
    if (/couldn't find remote ref/i.test(fetched.stderr)) {
      return { name: remote, kind: 'absent', detail: firstLine(fetched.stderr) }
    }
    return { name: remote, kind: 'unreachable', detail: firstLine(fetched.stderr) }
  }
  const head = await git(ctx, cwd, ['rev-parse', '--verify', 'HEAD'], signal, LOCAL_MS)
  const tipRef = await git(ctx, cwd, ['rev-parse', '--verify', tracking], signal, LOCAL_MS)
  const headOid = head.stdout.trim()
  const tipOid = tipRef.stdout.trim()
  if (head.exitCode !== 0 || tipRef.exitCode !== 0 || !OID.test(headOid) || !OID.test(tipOid)) {
    return { name: remote, kind: 'unreachable', detail: firstLine(head.stderr || tipRef.stderr) }
  }
  if (headOid.toLowerCase() === tipOid.toLowerCase()) return { name: remote, kind: 'same' }
  const ancestor = await git(ctx, cwd, ['merge-base', '--is-ancestor', tipOid, 'HEAD'], signal, LOCAL_MS)
  if (ancestor.exitCode === 0) return { name: remote, kind: 'ff' }
  if (ancestor.exitCode === 1) return { name: remote, kind: 'diverged' }
  return { name: remote, kind: 'unreachable', detail: firstLine(ancestor.stderr) }
}

/**
 * Push the current branch to every selected remote, or to none.
 *
 * A remote that is missing the branch, has commits HEAD does not contain, or
 * cannot be read blocks the whole shortcut. The push itself has no force
 * flag, so a tip that moves after the check is still rejected.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param signal - request cancellation.
 * @returns the status and envelope.
 */
async function pushAll(ctx, cwd, signal) {
  const status = await git(ctx, cwd, [
    'status', '--porcelain=v1', '-b', '-z', '--untracked-files=all',
  ], signal, LOCAL_MS)
  if (status.aborted || status.exitCode === null) return { status: 500, body: { ok: false, code: 'failed' } }
  if (status.exitCode !== 0) {
    if (/not a git repository/i.test(status.stderr)) return { status: 409, body: { ok: false, code: 'not-git' } }
    return { status: 500, body: { ok: false, code: 'failed' } }
  }
  const { head } = parseStatus(status.stdout)
  if (head.detached || head.unborn || !branchNameOk(head.branch)) {
    return { status: 409, body: { ok: false, code: 'no-branch' } }
  }
  const rows = await readRemoteRows(ctx, cwd, head.branch, signal)
  if (rows.failed) return { status: 500, body: { ok: false, code: 'failed' } }
  const targets = rows.remotes.filter(item => item.push)
  if (targets.length === 0) return { status: 409, body: { ok: false, code: 'no-targets' } }
  const unsafe = targets.filter(item => item.unsafe).map(item => item.name)
  if (unsafe.length > 0) return { status: 409, body: { ok: false, code: 'invalid', remotes: unsafe } }
  const checks = []
  for (const target of targets) {
    checks.push(await classifyRemote(ctx, cwd, target.name, head.branch, signal))
  }
  const plan = planPush(checks)
  if (!plan.ok) {
    return {
      status: 409,
      body: {
        ok: false,
        code: 'blocked',
        diverged: plan.diverged,
        missing: plan.missing,
        unreachable: plan.unreachable,
        reasons: plan.reasons,
      },
    }
  }
  const pushed = []
  for (const name of plan.updates) {
    const result = await git(ctx, cwd, ['push', name, `HEAD:refs/heads/${head.branch}`], signal, NETWORK_MS)
    if (result.exitCode !== 0) {
      const raced = /non-fast-forward|\[rejected\]/i.test(result.stderr)
      const code = pushed.length === 0 ? (raced ? 'diverged' : 'failed') : 'partial'
      return {
        status: 409,
        body: {
          ok: false,
          code,
          remotes: [name],
          pushed,
          failed: name,
          detail: firstLine(result.stderr),
        },
      }
    }
    pushed.push(name)
  }
  return { status: 200, body: { ok: true, action: 'push', value: { pushed, current: plan.current } } }
}

/**
 * Confirm the directory is a Git work tree.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param signal - request cancellation.
 * @returns a failure envelope, or null when git can edit this directory.
 */
async function ensureGit(ctx, cwd, signal) {
  const probed = await git(ctx, cwd, ['rev-parse', '--is-inside-work-tree'], signal, LOCAL_MS)
  if (probed.aborted) return { status: 500, body: { ok: false, code: 'failed' } }
  if (probed.exitCode !== 0 || probed.stdout.trim() !== 'true') {
    return { status: 409, body: { ok: false, code: 'not-git' } }
  }
  return null
}

/**
 * Add one remote.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param name - requested remote name.
 * @param url - requested fetch and push URL.
 * @param signal - request cancellation.
 * @returns the status and envelope.
 */
async function addRemote(ctx, cwd, name, url, signal) {
  const safeUrl = remoteUrlOk(url)
  if (!remoteNameOk(name) || safeUrl === null) return { status: 400, body: { ok: false, code: 'invalid' } }
  const repo = await ensureGit(ctx, cwd, signal)
  if (repo !== null) return repo
  const added = await git(ctx, cwd, ['remote', 'add', name, safeUrl], signal, LOCAL_MS)
  if (added.exitCode !== 0) {
    if (/already exists/i.test(added.stderr)) return { status: 409, body: { ok: false, code: 'exists' } }
    return { status: 409, body: { ok: false, code: 'failed', detail: firstLine(added.stderr) } }
  }
  return { status: 200, body: { ok: true, action: 'remote-add', value: { name } } }
}

/**
 * Set one remote's fetch and push URLs to the same value.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param name - existing remote name.
 * @param url - requested URL.
 * @param signal - request cancellation.
 * @returns the status and envelope.
 */
async function setRemoteUrl(ctx, cwd, name, url, signal) {
  const safeUrl = remoteUrlOk(url)
  if (!remoteArgOk(name) || safeUrl === null) return { status: 400, body: { ok: false, code: 'invalid' } }
  const repo = await ensureGit(ctx, cwd, signal)
  if (repo !== null) return repo
  const listed = await git(ctx, cwd, ['remote', '-v'], signal, LOCAL_MS)
  if (listed.exitCode !== 0) return { status: 500, body: { ok: false, code: 'failed' } }
  if (!parseRemotes(listed.stdout).some(item => item.name === name)) {
    return { status: 404, body: { ok: false, code: 'absent' } }
  }
  const fetchUrl = await git(ctx, cwd, ['remote', 'set-url', name, safeUrl], signal, LOCAL_MS)
  if (fetchUrl.exitCode !== 0) return { status: 409, body: { ok: false, code: 'failed', detail: firstLine(fetchUrl.stderr) } }
  const pushUrl = await git(ctx, cwd, ['remote', 'set-url', '--push', name, safeUrl], signal, LOCAL_MS)
  if (pushUrl.exitCode !== 0) return { status: 409, body: { ok: false, code: 'failed', detail: firstLine(pushUrl.stderr) } }
  return { status: 200, body: { ok: true, action: 'remote-set-url', value: { name } } }
}

/**
 * Remove one remote and drop it from the saved push selection.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param name - existing remote name.
 * @param signal - request cancellation.
 * @returns the status and envelope.
 */
async function removeRemote(ctx, cwd, name, signal) {
  if (!remoteArgOk(name)) return { status: 400, body: { ok: false, code: 'invalid' } }
  const repo = await ensureGit(ctx, cwd, signal)
  if (repo !== null) return repo
  const removed = await git(ctx, cwd, ['remote', 'remove', name], signal, LOCAL_MS)
  if (removed.exitCode !== 0) {
    if (/No such remote/i.test(removed.stderr)) return { status: 404, body: { ok: false, code: 'absent' } }
    return { status: 409, body: { ok: false, code: 'failed', detail: firstLine(removed.stderr) } }
  }
  const selection = await readSelection(ctx, cwd, signal)
  if (selection.configured) {
    const saved = await writeSelection(ctx, cwd, selection.names.filter(item => item !== name), signal)
    if (!saved) return { status: 500, body: { ok: false, code: 'failed' } }
  }
  return { status: 200, body: { ok: true, action: 'remote-remove', value: { name } } }
}

/**
 * Save the remotes included in the one-click push.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param requested - the names the panel submitted.
 * @param signal - request cancellation.
 * @returns the status and envelope.
 */
async function setPushRemotes(ctx, cwd, requested, signal) {
  if (!Array.isArray(requested) || requested.length > 100) return { status: 400, body: { ok: false, code: 'invalid' } }
  const names = []
  for (const name of requested) {
    if (!remoteArgOk(name) || names.includes(name)) return { status: 400, body: { ok: false, code: 'invalid' } }
    names.push(name)
  }
  const repo = await ensureGit(ctx, cwd, signal)
  if (repo !== null) return repo
  const rows = await readRemoteRows(ctx, cwd, null, signal)
  if (rows.failed) return { status: 500, body: { ok: false, code: 'failed' } }
  const known = new Map(rows.remotes.map(item => [item.name, item]))
  if (names.some(name => known.get(name)?.unsafe === true || !known.has(name))) {
    return { status: 400, body: { ok: false, code: 'invalid' } }
  }
  const saved = await writeSelection(ctx, cwd, names, signal)
  if (!saved) return { status: 500, body: { ok: false, code: 'failed' } }
  return { status: 200, body: { ok: true, action: 'push-set', value: { remotes: names } } }
}

/**
 * Answer one mutating panel request.
 *
 * The working directory comes from the Session header. One directory runs one
 * mutation at a time; a second request is refused rather than interleaved.
 * @param ctx - host context.
 * @param request - the authenticated fetch request.
 * @returns the JSON envelope.
 */
async function writePanel(ctx, request) {
  let body
  try {
    const text = await request.text()
    if (text.length > 16_000) return json({ ok: false, code: 'invalid' }, 400)
    body = JSON.parse(text)
  } catch (error) {
    // Malformed JSON is a client error. The parse message is not useful here.
    void error
    return json({ ok: false, code: 'invalid' }, 400)
  }
  if (body === null || typeof body !== 'object' || typeof body.sessionId !== 'string' || body.sessionId === '') {
    return json({ ok: false, code: 'invalid' }, 400)
  }
  const cwd = ctx.sessions.get(body.sessionId)?.header?.cwd
  if (typeof cwd !== 'string' || cwd === '') return json({ ok: false, code: 'no-session' }, 404)
  if (!claim(cwd)) return json({ ok: false, code: 'busy' }, 409)
  try {
    const signal = request.signal
    let result
    if (body.action === 'push') result = await pushAll(ctx, cwd, signal)
    else if (body.action === 'remote-add') result = await addRemote(ctx, cwd, body.name, body.url, signal)
    else if (body.action === 'remote-set-url') result = await setRemoteUrl(ctx, cwd, body.name, body.url, signal)
    else if (body.action === 'remote-remove') result = await removeRemote(ctx, cwd, body.name, signal)
    else if (body.action === 'push-set') result = await setPushRemotes(ctx, cwd, body.remotes, signal)
    else result = { status: 400, body: { ok: false, code: 'invalid' } }
    return json(result.body, result.status)
  } catch (error) {
    request.signal.throwIfAborted()
    // Spawn failures can include host paths, so the browser only gets a code.
    void error
    return json({ ok: false, code: 'failed' }, 500)
  } finally {
    busyDirs.delete(cwd)
  }
}

/**
 * Read one commit's message and the files it changed against its first parent.
 *
 * The id must already be a full object id. Root commits diff against the empty
 * tree. Line counts come from numstat; a binary file has none.
 * @param ctx - host context.
 * @param cwd - working directory.
 * @param oid - the requested commit id.
 * @param signal - request cancellation.
 * @returns the JSON envelope.
 */
async function readCommit(ctx, cwd, oid, signal) {
  if (!commitOidOk(oid)) return json({ ok: false, code: 'invalid' }, 400)
  const shown = await git(ctx, cwd, ['show', '-s', `--format=${COMMIT_FORMAT}`, oid], signal, LOCAL_MS)
  if (shown.aborted) return json({ ok: false, code: 'failed' }, 500)
  if (shown.exitCode !== 0) {
    if (/not a git repository/i.test(shown.stderr)) return json({ ok: true, value: { state: 'not-git' } })
    return json({ ok: false, code: 'absent' }, 404)
  }
  const message = parseCommitShow(shown.stdout)
  if (message === null) return json({ ok: false, code: 'absent' }, 404)
  const tree = ['diff-tree', '--no-commit-id', '--first-parent', '--root', '-r', '--find-renames']
  const named = await git(ctx, cwd, [...tree, '--name-status', '-z', message.oid], signal, LOCAL_MS)
  const counted = await git(ctx, cwd, [...tree, '--numstat', '-z', message.oid], signal, LOCAL_MS)
  const files = named.exitCode === 0 && counted.exitCode === 0
    ? mergeCommitFiles(parseNameStatus(named.stdout), parseNumstat(counted.stdout))
    : []
  let additions = 0
  let deletions = 0
  for (const file of files) {
    if (typeof file.additions === 'number') additions += file.additions
    if (typeof file.deletions === 'number') deletions += file.deletions
  }
  const parents = []
  if (message.parents.length > 0) {
    const logged = await git(ctx, cwd, [
      'log', '--no-walk', '--format=%H%x00%s', ...message.parents,
    ], signal, LOCAL_MS)
    const subjects = new Map()
    if (logged.exitCode === 0) {
      for (const line of logged.stdout.split(/\r?\n/)) {
        const split = line.indexOf('\0')
        if (split <= 0) continue
        subjects.set(line.slice(0, split).toLowerCase(), line.slice(split + 1))
      }
    }
    for (const parent of message.parents) {
      parents.push({ oid: parent, subject: subjects.get(parent.toLowerCase()) ?? '' })
    }
  }
  return json({
    ok: true,
    value: {
      kind: 'commit',
      oid: message.oid,
      subject: message.subject,
      body: message.body,
      author: message.author,
      authorEmail: message.authorEmail,
      authorTime: message.authorTime,
      committer: message.committer,
      committerEmail: message.committerEmail,
      parents,
      files: files.slice(0, MAX_COMMIT_FILES),
      fileCount: files.length,
      additions,
      deletions,
      filesTruncated: files.length > MAX_COMMIT_FILES,
      filesFailed: named.exitCode !== 0 || counted.exitCode !== 0,
    },
  })
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
  const commit = url.searchParams.get('commit')
  if (commit !== null && commit !== '') {
    try {
      return await readCommit(ctx, cwd, commit, request.signal)
    } catch (error) {
      request.signal.throwIfAborted()
      // Spawn failures can include host paths, so the browser only gets a code.
      void error
      return json({ ok: false, code: 'failed' }, 500)
    }
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
    } catch (error) {
      request.signal.throwIfAborted()
      // The history is optional; a failure here still leaves the status usable.
      void error
      historyFailed = true
    }
  }

  const tracked = head.detached || head.unborn || !branchNameOk(head.branch) ? null : head.branch
  let remotes = []
  let remotesFailed = false
  try {
    const rows = await readRemoteRows(ctx, cwd, tracked, request.signal)
    remotes = rows.remotes
    remotesFailed = rows.failed
  } catch (error) {
    request.signal.throwIfAborted()
    void error
    remotesFailed = true
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
      remotes,
      remotesFailed,
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
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: request => (request.method === 'POST' ? writePanel(ctx, request) : readPanel(ctx, request)),
    })
    return () => registration.then(dispose => dispose())
  })
}
