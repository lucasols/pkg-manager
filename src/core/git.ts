import { runCmd, runCmdOrExit } from '../utils/runCmd.ts';

export async function isGitClean(): Promise<boolean> {
  const result = await runCmd('check git status', ['git', 'status', '--porcelain'], {
    silent: true,
  });

  if (!result.ok) return false;

  return result.output.trim() === '';
}

export async function gitAdd(files: string[] = ['.']): Promise<void> {
  await runCmdOrExit('stage changes', ['git', 'add', ...files]);
}

export async function gitCommit(message: string): Promise<void> {
  await runCmdOrExit('commit', ['git', 'commit', '-m', message]);
}

export async function commitIfDirty(message: string): Promise<boolean> {
  const clean = await isGitClean();

  if (clean) {
    console.log('No changes to commit');
    return false;
  }

  await gitAdd();
  await gitCommit(message);
  return true;
}
