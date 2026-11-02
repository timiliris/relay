import { describe, expect, it } from 'vitest';
import type { GitFile } from '@/lib/agent/commands';
import { groupFiles } from './git';

const file = (path: string, status: GitFile['status'], staged: boolean): GitFile => ({
  path,
  status,
  staged,
  origPath: null,
});

describe('groupFiles', () => {
  it('splits files into staged, worktree changes and untracked, sorted by path', () => {
    const groups = groupFiles([
      file('z.txt', 'modified', false),
      file('b.txt', 'added', true),
      file('a.txt', 'modified', true),
      file('n.txt', 'untracked', false),
      file('c.txt', 'deleted', false),
      file('m.txt', 'untracked', false),
      file('x.txt', 'conflicted', false),
    ]);
    expect(groups.staged.map((f) => f.path)).toEqual(['a.txt', 'b.txt']);
    expect(groups.changes.map((f) => f.path)).toEqual(['c.txt', 'x.txt', 'z.txt']);
    expect(groups.untracked.map((f) => f.path)).toEqual(['m.txt', 'n.txt']);
  });

  it('keeps a file both staged and modified in two groups', () => {
    const groups = groupFiles([file('a.txt', 'modified', true), file('a.txt', 'modified', false)]);
    expect(groups.staged).toHaveLength(1);
    expect(groups.changes).toHaveLength(1);
    expect(groups.untracked).toHaveLength(0);
  });

  it('returns empty groups without files', () => {
    expect(groupFiles([])).toEqual({ staged: [], changes: [], untracked: [] });
  });
});
