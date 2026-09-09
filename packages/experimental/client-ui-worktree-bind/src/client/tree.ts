/**
 * IDEA-style `/` prefix tree over local branch names.
 * @module @deepseek-ai/dsh-experimental-client-ui-worktree-bind/tree
 */

/** Folder or leaf in the branch picker. */
export type BranchTreeNode =
  | { kind: 'folder'; name: string; path: string; children: BranchTreeNode[] }
  | { kind: 'leaf'; name: string; branch: string }

function insert(nodes: BranchTreeNode[], parts: readonly string[], branch: string, prefix: string): void {
  const head = parts[0]
  if (head === undefined) return
  const rest = parts.slice(1)
  if (rest.length === 0) {
    nodes.push({ kind: 'leaf', name: head, branch })
    return
  }
  const path = prefix.length === 0 ? head : `${prefix}/${head}`
  let folder = nodes.find((node): node is Extract<BranchTreeNode, { kind: 'folder' }> =>
    node.kind === 'folder' && node.name === head)
  if (folder === undefined) {
    folder = { kind: 'folder', name: head, path, children: [] }
    nodes.push(folder)
  }
  insert(folder.children, rest, branch, path)
}

/**
 * Nest branch names on `/`.
 * @param names - local branch short names.
 * @returns root nodes in insertion order.
 */
export function buildBranchTree(names: readonly string[]): BranchTreeNode[] {
  const root: BranchTreeNode[] = []
  for (const branch of names) {
    const parts = branch.split('/').filter(part => part.length > 0)
    if (parts.length === 0) continue
    insert(root, parts, branch, '')
  }
  return root
}

/**
 * Case-insensitive substring filter; empty query keeps every name.
 * @param names - local branch short names.
 * @param query - search field.
 * @returns matching branch names.
 */
export function filterBranches(names: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...names]
  return names.filter(name => name.toLowerCase().includes(needle))
}

/**
 * Folder paths that should start open so `branch` is visible.
 * @param branch - selected or HEAD branch.
 * @returns ancestor folder paths of the branch.
 */
export function openFoldersFor(branch: string | null | undefined): Set<string> {
  const open = new Set<string>()
  if (branch === null || branch === undefined) return open
  const parts = branch.split('/').filter(part => part.length > 0)
  let path = ''
  for (const part of parts.slice(0, -1)) {
    path = path.length === 0 ? part : `${path}/${part}`
    open.add(path)
  }
  return open
}
