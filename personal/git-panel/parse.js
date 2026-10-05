/**
 * Pure parsers for the porcelain and log output @wintry/git-panel reads.
 *
 * Kept separate from the plugin entry so the format handling can be exercised
 * directly against captured git output.
 */

/** Field separator git writes between formatted log fields. */
const FIELD = '\u0000'
/** Record separator git writes after each formatted log record. */
const RECORD = '\u001e'

/**
 * Split one porcelain XY pair into its display bucket.
 * @param index - the staged-side status character.
 * @param worktree - the working-tree-side status character.
 * @returns the bucket this file is counted and labelled under.
 */
export function bucketOf(index, worktree) {
  if (index === '?' || worktree === '?') return 'untracked'
  if (index === 'U' || worktree === 'U'
    || (index === 'A' && worktree === 'A')
    || (index === 'D' && worktree === 'D')) return 'conflicted'
  if (index !== ' ') return 'staged'
  return 'unstaged'
}

/**
 * Parse the `## ` header of `git status --porcelain=v1 -b`.
 *
 * The four observed forms are `## <branch>...<upstream> [ahead N, behind M]`,
 * `## <branch>`, `## HEAD (no branch)`, and `## No commits yet on <branch>`.
 * @param header - the header text without its leading `## `.
 * @returns the branch, upstream, divergence counts, and flags it encodes.
 */
export function parseHeader(header) {
  const result = { branch: null, upstream: null, ahead: 0, behind: 0, detached: false, unborn: false }
  if (header.startsWith('HEAD (no branch)')) {
    result.detached = true
    return result
  }
  const unbornPrefix = 'No commits yet on '
  if (header.startsWith(unbornPrefix)) {
    result.branch = header.slice(unbornPrefix.length)
    result.unborn = true
    return result
  }
  const bracket = header.indexOf(' [')
  const core = bracket === -1 ? header : header.slice(0, bracket)
  const tail = bracket === -1 ? '' : header.slice(bracket + 2, -1)
  const separator = core.indexOf('...')
  result.branch = separator === -1 ? core : core.slice(0, separator)
  result.upstream = separator === -1 ? null : core.slice(separator + 3)
  const ahead = /ahead (\d+)/.exec(tail)
  const behind = /behind (\d+)/.exec(tail)
  if (ahead !== null) result.ahead = Number(ahead[1])
  if (behind !== null) result.behind = Number(behind[1])
  return result
}

/**
 * Parse `git status --porcelain=v1 -b -z --untracked-files=all`.
 *
 * Under `-z` every record is NUL-terminated instead of quoted, so paths keep
 * their exact bytes. A rename or copy record is followed by one extra record
 * carrying the original path, and the stream ends with a trailing empty
 * record after the final terminator.
 * @param text - the raw stdout.
 * @returns the header facts, the per-file rows, and the bucket counts.
 */
export function parseStatus(text) {
  const records = text.split('\0')
  const first = records[0] ?? ''
  const head = parseHeader(first.startsWith('## ') ? first.slice(3) : '')
  const counts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, total: 0 }
  const changes = []
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record.length < 4) continue
    const staged = record[0]
    const worktree = record[1]
    const path = record.slice(3)
    let oldPath = null
    if (staged === 'R' || staged === 'C') {
      index += 1
      oldPath = records[index] ?? null
    }
    const bucket = bucketOf(staged, worktree)
    counts[bucket] += 1
    counts.total += 1
    changes.push({ path, oldPath, index: staged, worktree, kind: bucket })
  }
  return { head, counts, changes }
}

/**
 * Turn one `%D` decoration string into displayable refs.
 *
 * Git writes `HEAD -> <branch>` for the checked-out branch, `tag: <name>` for a
 * tag, `<remote>/HEAD` for a remote's symbolic head, and a bare `HEAD` when the
 * checkout is detached. The last two name no branch, so they are dropped.
 * @param decoration - the raw `%D` value, empty when the commit carries no ref.
 * @returns the refs to label this commit with, in git's own order.
 */
export function parseRefs(decoration) {
  const refs = []
  if (decoration === '') return refs
  for (const entry of decoration.split(', ')) {
    if (entry === '') continue
    const arrow = entry.indexOf(' -> ')
    if (arrow !== -1) {
      // `HEAD -> x` marks the checked-out branch; `origin/HEAD -> x` marks a
      // remote's symbolic head and names no branch of its own.
      if (entry.startsWith('HEAD -> ')) refs.push({ name: entry.slice(8), kind: 'head' })
      continue
    }
    if (entry.startsWith('tag: ')) {
      refs.push({ name: entry.slice(5), kind: 'tag' })
      continue
    }
    if (entry === 'HEAD' || entry.endsWith('/HEAD')) continue
    refs.push({ name: entry, kind: 'ref' })
  }
  return refs
}

/**
 * Parse the formatted output of the panel's `git log`.
 *
 * The format is `%H %P %an %at %D %s` separated by NUL, with each record
 * terminated by RS and a newline.
 * @param text - the raw stdout.
 * @returns one record per commit, in the order git emitted them.
 */
export function parseLog(text) {
  const commits = []
  for (const raw of text.split(RECORD)) {
    const record = raw.startsWith('\n') ? raw.slice(1) : raw
    if (record === '') continue
    const fields = record.split(FIELD)
    const oid = fields[0]
    const parents = fields[1]
    const author = fields[2]
    const authorTime = fields[3]
    const decoration = fields[4]
    if (oid === undefined || parents === undefined || author === undefined
      || authorTime === undefined || decoration === undefined) continue
    commits.push({
      oid,
      parents: parents === '' ? [] : parents.split(' '),
      author,
      authorTime: Number(authorTime),
      refs: parseRefs(decoration),
      subject: fields.slice(5).join(FIELD),
    })
  }
  return commits
}

/**
 * A remote or branch name that can be placed in fixed git argv.
 *
 * Rejects option-looking names and ref metacharacters. Slashes stay allowed so
 * an existing remote or a `feature/topic` branch still round-trips.
 * @param name - the candidate.
 * @returns whether git can be given this name as one argument.
 */
export function remoteArgOk(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 200
    && name !== 'HEAD'
    && !name.startsWith('-')
    && !name.startsWith('/')
    && !name.endsWith('/')
    && !name.endsWith('.lock')
    && !name.endsWith('.')
    && !name.includes('..')
    && !name.includes('//')
    && !name.includes('@{')
    && !/[\u0000-\u001f\u007f\s~^:?*[\\]/.test(name)
}

/**
 * A remote name the panel itself may create.
 * @param name - the candidate.
 * @returns whether the add form may submit it.
 */
export function remoteNameOk(name) {
  return remoteArgOk(name) && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
}

/**
 * A branch name the panel may use in a refspec.
 * @param name - the candidate.
 * @returns whether a `refs/heads/<name>` refspec is safe to build.
 */
export function branchNameOk(name) {
  return remoteArgOk(name)
}

/**
 * Normalize a remote URL typed into the panel.
 *
 * `ext::` is rejected because git treats it as a command. Leading dashes are
 * rejected so the value cannot become an option.
 * @param url - the raw field value.
 * @returns the trimmed URL, or null when the panel must not store it.
 */
export function remoteUrlOk(url) {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (trimmed.length < 1 || trimmed.length > 2000) return null
  if (trimmed.startsWith('-') || trimmed.toLowerCase().startsWith('ext::')) return null
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return null
  return trimmed
}

/**
 * Whether a URL already stored by git must not be pushed to from this panel.
 * @param url - the fetch or push URL from `git remote -v`.
 * @returns true when pushing this remote could execute a command.
 */
export function remoteUrlUnsafe(url) {
  if (typeof url !== 'string' || url === '') return true
  return url.startsWith('-') || url.toLowerCase().startsWith('ext::') || /[\u0000-\u001f\u007f]/.test(url)
}

/**
 * Parse `git remote -v`.
 *
 * Each line is `<name>\t<url> (fetch|push)`. A name that cannot safely be
 * passed back to git is dropped.
 * @param text - the raw stdout.
 * @returns one entry per remote, in the order git listed them.
 */
export function parseRemotes(text) {
  /** @type {Map<string, {name: string, fetchUrl: string|null, pushUrl: string|null}>} */
  const byName = new Map()
  for (const raw of String(text).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const name = line.slice(0, tab)
    const rest = line.slice(tab + 1)
    const fetchMark = ' (fetch)'
    const pushMark = ' (push)'
    let kind = ''
    let url = ''
    if (rest.endsWith(fetchMark)) {
      kind = 'fetch'
      url = rest.slice(0, -fetchMark.length)
    } else if (rest.endsWith(pushMark)) {
      kind = 'push'
      url = rest.slice(0, -pushMark.length)
    }
    if (kind === '' || url === '' || !remoteArgOk(name)) continue
    const row = byName.get(name) ?? { name, fetchUrl: null, pushUrl: null }
    if (kind === 'fetch') row.fetchUrl = url
    else row.pushUrl = url
    byName.set(name, row)
  }
  return [...byName.values()]
}

/**
 * Decide a one-click push that updates every selected remote or updates none.
 *
 * `same` needs no write. `ff` may be pushed. `diverged` and `absent` are not
 * fast-forwards, and `unreachable` was not proved safe, so each of those
 * refuses the whole push. This panel does not create a missing remote branch.
 * @param checks - one classification per selected remote.
 * @returns the push plan, or the remotes that blocked it.
 */
export function planPush(checks) {
  const names = kind => checks.filter(item => item.kind === kind).map(item => item.name)
  const reason = kind => ({
    remotes: names(kind),
    detail: checks.find(item => item.kind === kind)?.detail ?? '',
  })
  const diverged = names('diverged')
  const missing = names('absent')
  const known = new Set(['same', 'ff', 'diverged', 'absent', 'unreachable'])
  const unreachable = names('unreachable').concat(
    checks.filter(item => !known.has(item.kind)).map(item => item.name),
  )
  if (diverged.length > 0 || missing.length > 0 || unreachable.length > 0) {
    return {
      ok: false,
      diverged,
      missing,
      unreachable,
      reasons: {
        diverged: reason('diverged'),
        missing: reason('absent'),
        unreachable: reason('unreachable'),
      },
    }
  }
  return { ok: true, updates: names('ff'), current: names('same') }
}

/** Full Git object id, SHA-1 or SHA-256. */
const COMMIT_OID = /^[0-9a-f]{40,64}$/i

/**
 * Whether a request may name this commit.
 * @param value - the raw query value.
 * @returns whether it is a full object id and nothing else.
 */
export function commitOidOk(value) {
  return typeof value === 'string' && COMMIT_OID.test(value)
}

/**
 * Parse `git show -s` for one commit.
 *
 * Fields are separated by NUL: id, parents, author name, author email, author
 * time, committer name, committer email, committer time, subject, body.
 * @param text - the raw stdout.
 * @returns the commit message fields, or null when the record is incomplete.
 */
export function parseCommitShow(text) {
  const fields = String(text).replace(/\n$/, '').split('\0')
  if (fields.length < 10) return null
  const oid = fields[0]
  const parents = fields[1]
  const author = fields[2]
  const authorEmail = fields[3]
  const authorTime = fields[4]
  const committer = fields[5]
  const committerEmail = fields[6]
  const committerTime = fields[7]
  const subject = fields[8]
  if (!commitOidOk(oid) || author === undefined || authorEmail === undefined
    || authorTime === undefined || committer === undefined || committerEmail === undefined
    || committerTime === undefined || subject === undefined) return null
  return {
    oid,
    parents: parents === '' ? [] : parents.split(' ').filter(commitOidOk),
    author,
    authorEmail,
    authorTime: Number(authorTime),
    committer,
    committerEmail,
    committerTime: Number(committerTime),
    subject,
    body: fields.slice(9).join('\0').replace(/\n+$/, ''),
  }
}

/**
 * Parse `git diff-tree --name-status -z`.
 *
 * A rename or copy is followed by the old path and then the new path. Every
 * other status is followed by one path.
 * @param text - the raw stdout, without a leading commit id.
 * @returns one file per status record.
 */
export function parseNameStatus(text) {
  const parts = String(text).split('\0')
  const files = []
  for (let index = 0; index < parts.length; index += 1) {
    const status = parts[index]
    if (status === undefined || status === '') continue
    const kind = status[0]
    if (kind === 'R' || kind === 'C') {
      const oldPath = parts[index + 1]
      const path = parts[index + 2]
      if (oldPath === undefined || path === undefined || oldPath === '' || path === '') break
      files.push({ status: kind, path, oldPath })
      index += 2
      continue
    }
    const path = parts[index + 1]
    if (path === undefined || path === '') break
    files.push({ status: kind, path, oldPath: null })
    index += 1
  }
  return files
}

/**
 * Parse `git diff-tree --numstat -z`.
 *
 * A rename leaves the path column empty and puts the old and new paths in the
 * following NUL fields. `-` means a binary file, which has no line counts.
 * @param text - the raw stdout, without a leading commit id.
 * @returns one file per numstat record.
 */
export function parseNumstat(text) {
  const parts = String(text).split('\0')
  const files = []
  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index]
    if (record === undefined || record === '') continue
    const first = record.indexOf('\t')
    const second = first === -1 ? -1 : record.indexOf('\t', first + 1)
    if (first < 0 || second < 0) continue
    const added = record.slice(0, first)
    const removed = record.slice(first + 1, second)
    const inline = record.slice(second + 1)
    const counts = {
      additions: added === '-' ? null : Number(added),
      deletions: removed === '-' ? null : Number(removed),
    }
    if (inline === '') {
      const oldPath = parts[index + 1]
      const path = parts[index + 2]
      if (oldPath === undefined || path === undefined || oldPath === '' || path === '') break
      files.push({ ...counts, path, oldPath })
      index += 2
      continue
    }
    files.push({ ...counts, path: inline, oldPath: null })
  }
  return files
}

/**
 * Attach line counts to status rows from the matching numstat output.
 *
 * The two commands are run with the same revision and rename detection, so
 * equal positions are the same file. A length mismatch falls back to the path.
 * @param statuses - name-status rows.
 * @param stats - numstat rows.
 * @returns status rows with additions and deletions.
 */
export function mergeCommitFiles(statuses, stats) {
  return statuses.map((file, index) => {
    const samePlace = stats[index]
    const stat = samePlace !== undefined && samePlace.path === file.path
      ? samePlace
      : stats.find(item => item.path === file.path && item.oldPath === file.oldPath)
    return {
      status: file.status,
      path: file.path,
      oldPath: file.oldPath,
      additions: stat === undefined ? null : stat.additions,
      deletions: stat === undefined ? null : stat.deletions,
    }
  })
}
