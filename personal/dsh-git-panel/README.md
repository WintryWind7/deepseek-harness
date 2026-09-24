# dsh-git-panel

A Web GUI plugin for DeepSeek Harness: a compact control in the composer tool row that opens a panel showing the
current Session working directory's Git branch, its upstream tracking state, the files that are not committed, and the
commit history.

It is read-only. It never writes to a Session log, a Git repository, or the model-visible surface; reading the panel
creates no conversation message and no trajectory entry.

## Use it

The control sits in `conversation.input.left`, beside the shipped composer controls. Clicking it opens a dialog. The
dialog's footer re-reads Git state and, while older commits remain, extends the history by another page.

The panel reports:

- the current branch, its upstream, and how far ahead or behind it is; a detached HEAD and a repository with no
  commits are named rather than shown as an error;
- whether the working tree is clean, and how many files are not committed;
- each uncommitted file with its two-character porcelain status, its path, and its bucket (staged, unstaged,
  untracked, or conflicted). A rename shows its original path;
- the commit history newest first, with a single-character lane gutter, the abbreviated id, the subject, the refs
  that point at the commit, the author, and a relative time.

A directory that is not a Git repository produces an empty state, not a failure.

## How it is wired

The Host half registers one authenticated `GET /api/git.panel?sessionId=<id>&limit=<n>` route through
`ctx.connection.fetch`. It resolves the working directory from the Session header, never from the request, so the
browser cannot ask Git about an arbitrary directory. It runs two commands:

```text
git status --porcelain=v1 -b -z --untracked-files=all
git log --branches --tags --remotes HEAD --topo-order --max-count=<n+1> --format=%H%x00%P%x00%an%x00%at%x00%D%x00%s%x1e
```

Both use fixed argv: no shell parses a path or branch name.

### Reading `git status`

`-z` NUL-terminates every record instead of quoting paths, so a path with spaces or non-ASCII characters is read
byte-exact. A rename or copy record is followed by one extra record carrying the original path, and the stream ends
with a trailing empty record after the final terminator. The `## ` header supplies the branch, its upstream, and the
divergence counts in one call.

### Reading `git log`

`--branches --tags --remotes HEAD` walks every ref plus the current checkout. Without `HEAD`, a commit made on a
detached checkout belongs to no ref and would vanish. Git deduplicates a commit reached through several refs, so the
extra revision adds no duplicates. An unborn HEAD contributes no revision list, so the command is skipped entirely in
that state and the page reports zero commits. One record beyond the page size is fetched to tell "more commits exist"
from "the history ends here".

`%D` supplies the ref decorations. Git writes `HEAD -> <branch>` for the checked-out branch, `tag: <name>` for a tag,
a bare `HEAD` when the checkout is detached, and `<remote>/HEAD` for a remote's symbolic head; the last two name no
branch and are dropped.

### Lane layout

`computeLanes` assigns each commit a lane and returns one row of single-character glyphs per commit: `●` for a commit,
`◆` for a merge, `│` where another lane passes through, and a blank cell elsewhere. A lane remembers the commit id it
is waiting for; the row that emits that commit takes the lane over and continues with its first parent, and each extra
parent of a merge opens a lane of its own.

Two rules keep the gutter from swallowing the dialog:

- A lane is kept only for a commit the page will actually render. The walk covers every ref, and a merge's second
  parent is exactly the kind of commit that falls past the page boundary, so without the rule those lanes wait for a
  commit that never arrives and hold their column for the rest of the page.
- Trailing lanes that have freed up are released each row, so a row renders only the columns live at that row. Measured
  on this repository — 200 commits over 73 refs, 61 of them merges — the first 40 rows render one column instead of
  carrying the page's 24-column peak, and total gutter width across the page drops by 42%.

The pass runs newest to oldest, so paging in older commits never changes an already-rendered row. That is what lets
"load more" re-fetch the whole window instead of appending to it.

Rendering single glyphs rather than line segments keeps every row plain text, so alignment is automatic at any font
size. Two deliberate trade-offs: the horizontal join of a merge is not drawn, so a joining line ends one row early and
that row's join cell is blank; and a graph wider than 24 lanes clamps into the last visible column, which a real
repository of this shape does not reach.

The browser half registers one entry in `conversation.input.left` and renders the panel through the shared `Modal`
primitive in `headless` mode, which keeps the mask, the body portal, and Escape handling while leaving the panel's own
layout to this package. Its stylesheet is injected once and scoped to the `gp-` class names.

The panel's layout and lane assignment follow the `dsh-web` plugin family's git graph; see [NOTICE](NOTICE) for what
was adapted and how it differs.

## Layout

| File | Role |
|---|---|
| `index.js` | Host plugin: the route, the two subprocess calls, and the response envelope |
| `parse.js` | Pure porcelain and log parsers, kept separate so they can be tested against captured Git output |
| `lanes.js` | Pure commit-graph lane layout |
| `client.js` | Browser half: the composer control and the panel |
| `cordis.patch.yml` | Bundle patch inserting the Host row |
| `NOTICE` | Apache-2.0 attribution for the adapted layout and lane assignment |

## Installing and iterating

Installed into the `web` profile as a link. The two halves reload differently:

- **`client.js`** is re-fetched from disk on page refresh, so a browser-side change needs only a refresh.
- **`index.js`, `parse.js`, and `lanes.js`** are resolved once and then held in the process's module registry. Editing
  them does not affect the running process, and a plugin reload through the patch layer does not evict them either.
  A Host-side change needs a `dsh web` restart.

While the two halves disagree, the panel's response normalizer keeps the mismatch from breaking the render: a Host
that predates a field yields the empty default for it rather than an exception.

## Known limitations

- Read-only. It does not stage, commit, switch branches, or create worktrees.
- Selecting a commit does not yet expand its details, and clicking a file does not show its diff.
- The panel reads Git state when opened, when refreshed, and when the history is extended. It does not watch the
  repository, so an external change appears only after one of those.
