/**
 * Pure parsers for the porcelain and log output dsh-git-panel reads.
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
