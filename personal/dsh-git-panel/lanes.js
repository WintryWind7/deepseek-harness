/**
 * Commit-graph lane layout for dsh-git-panel.
 *
 * Produces one row of single-character lane glyphs per commit. A lane holds the
 * commit id it is still waiting for; the row that emits that commit takes the
 * lane over. Rendering single glyphs instead of line segments keeps every row
 * plain text, so alignment is automatic at any font size.
 *
 * Adapted from the lane assignment of the `dsh-web` plugin family's git graph
 * (`packages/dsh-git-graph/src/core/types.ts`, Apache-2.0), with one change:
 * `later` is the set of commits this page actually renders, not every parent
 * named by a row. A merge's second parent is exactly the commit a bounded walk
 * over every ref tends to cut, so without that change a lane waits for a commit
 * that never arrives and holds its column open for the rest of the page.
 */

/**
 * Safety cap on one row's gutter. Rows are as wide as their own concurrent
 * branches — far narrower than the page's widest stretch — so this only guards
 * a pathological repository; a node past it clamps into the last column.
 */
const MAX_LANES = 24

/**
 * Lay out the lanes for one page of commits.
 *
 * Each row renders only the columns live at that row, and trailing lanes that
 * have freed up are released, so a narrow stretch of history does not carry the
 * widest stretch's gutter.
 * @param commits - commits in the order git emitted them, each with `oid` and `parents`.
 * @returns one glyph-key row per commit, parallel to `commits`.
 */
export function computeLanes(commits) {
  const present = new Set(commits.map(commit => commit.oid))
  /** Lane index to the commit id that lane is still waiting for, or null when free. */
  const lanes = []
  const rows = []
  for (const commit of commits) {
    let nodeColumn = lanes.findIndex(pending => pending === commit.oid)
    if (nodeColumn === -1) {
      lanes.push(commit.oid)
      nodeColumn = lanes.length - 1
    }
    const row = []
    for (let index = 0; index < lanes.length; index += 1) {
      const pending = lanes[index]
      if (pending === null) row.push('gap')
      else if (index === nodeColumn) row.push(commit.parents.length > 1 ? 'merge' : 'node')
      // A second lane waiting for this commit joins here. Its line ends into
      // the node, which a one-glyph-per-column gutter can only show as blank.
      else if (pending === commit.oid) row.push('gap')
      else row.push('pass')
    }
    // The node's lane continues with the first parent; every other lane that was
    // waiting for this commit is consumed.
    for (let index = 0; index < lanes.length; index += 1) {
      if (lanes[index] === commit.oid && index !== nodeColumn) lanes[index] = null
    }
    // A parent past the page edge ends its line at the boundary instead of
    // holding a column open.
    const parents = commit.parents.filter(parent => present.has(parent))
    const first = parents[0]
    lanes[nodeColumn] = first === undefined ? null : first
    for (let index = 1; index < parents.length; index += 1) {
      const parent = parents[index]
      if (!lanes.includes(parent)) lanes.push(parent)
    }
    // Release the columns that just freed up.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    rows.push(clamp(row, nodeColumn))
  }
  return rows
}

/**
 * Bound one row to the gutter cap, keeping its node visible.
 * @param row - the row's glyph keys, left to right.
 * @param nodeColumn - the column the node sits in.
 * @returns the row, unchanged unless it exceeds the cap.
 */
function clamp(row, nodeColumn) {
  if (row.length <= MAX_LANES) return row
  const shown = Math.min(nodeColumn, MAX_LANES - 1)
  const bounded = row.slice(0, MAX_LANES)
  bounded[shown] = row[nodeColumn]
  return bounded
}
