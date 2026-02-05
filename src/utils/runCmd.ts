import { spawn } from 'child_process';
import { styleText } from 'node:util';

export type RunCmdOptions = {
  cwd?: string;
  silent?: boolean;
};

export async function runCmd(
  label: string,
  cmd: string[],
  options: RunCmdOptions = {},
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const [command, ...args] = cmd;

  if (!command) {
    return { ok: false, error: 'No command provided' };
  }

  if (!options.silent) {
    console.log(styleText(['dim'], `> ${cmd.join(' ')}`));
  }

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      shell: true,
      stdio: options.silent ? 'pipe' : 'inherit',
    });

    let stdout = '';
    let stderr = '';

    if (options.silent) {
      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, output: stdout });
      } else {
        resolve({
          ok: false,
          error: stderr || stdout || `Command failed with exit code ${code}`,
        });
      }
    });

    proc.on('error', (error) => {
      resolve({ ok: false, error: error.message });
    });
  });
}

export async function runCmdOrExit(
  label: string,
  cmd: string[],
  options: RunCmdOptions = {},
): Promise<string> {
  const result = await runCmd(label, cmd, options);

  if (!result.ok) {
    console.error(styleText(['red', 'bold'], `Failed: ${label}`));
    console.error(result.error);
    process.exit(1);
  }

  return result.output;
}
