/**
 * In-memory FsLike for M2 resource-manager tests (T2+). Pure, node-free at
 * call sites; follows the same shape contract as the bridge (readdir/stat/
 * readHead/readTail/readRange). Symlinks are NOT representable — symlink
 * semantics live in their own bridge tests.
 */
import type { DirEntry, FileMeta, FsLike } from '../../src/bridge/sessions';

export type TreeNode = { file: string } | { dir: Record<string, TreeNode> };
export type DirNode = { dir: Record<string, TreeNode> };
export type FileNode = { file: string };

const dir = (children: Record<string, TreeNode>): DirNode => ({ dir: children });
const file = (content: string): FileNode => ({ file: content });
export { dir, file };

const MTIME = 1_700_000_000_000;

export function resourceFs(tree: Record<string, TreeNode>): FsLike {
  const lookup = (p: string): TreeNode | null => {
    const parts = p.split('/').filter(Boolean);
    let cur: TreeNode | undefined = { dir: tree } as TreeNode;
    for (const part of parts) {
      if (!cur || !('dir' in cur)) return null;
      cur = cur.dir[part];
      if (!cur) return null;
    }
    return cur ?? null;
  };

  const content = (p: string): string => {
    const node = lookup(p);
    if (!node || !('file' in node)) {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    }
    return node.file;
  };

  return {
    async readdir(p: string): Promise<DirEntry[]> {
      const node = lookup(p);
      if (!node || !('dir' in node)) {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      }
      return Object.entries(node.dir).map(([name, child]) => ({
        name,
        isDirectory: () => 'dir' in child,
        isFile: () => 'file' in child,
      }));
    },
    async stat(p: string): Promise<FileMeta> {
      return { size: Buffer.byteLength(content(p)), mtimeMs: MTIME };
    },
    async readHead(p: string, maxBytes: number): Promise<string> {
      return Buffer.from(content(p)).subarray(0, maxBytes).toString('utf8');
    },
    async readTail(p: string, maxBytes: number): Promise<string> {
      const b = Buffer.from(content(p));
      return b.subarray(Math.max(0, b.length - maxBytes)).toString('utf8');
    },
    async readRange(p: string, offset: number, length: number): Promise<Buffer> {
      return Buffer.from(content(p)).subarray(offset, offset + length);
    },
  };
}
