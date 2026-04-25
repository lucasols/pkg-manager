import { spawn } from 'child_process';
import { platform } from 'node:process';
import { styleText } from 'node:util';

const NPM_BROWSER_AUTH_PROMPT_REGEX = /Press\s+ENTER\s+to\s+open\s+in\s+(?:the\s+)?browser\.\.\./i;
const SCRIPT_EOF_MARKER_REGEX = /\^D\b\b/g;

export type RunCmdOptions = {
  cwd?: string;
  silent?: boolean;
  autoRespondToNpmAuthPrompt?: boolean;
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

  if (options.autoRespondToNpmAuthPrompt && !options.silent) {
    return runCmdWithNpmAuthPromptResponse(command, args, options);
  }

  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
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

function runCmdWithNpmAuthPromptResponse(
  command: string,
  args: string[],
  options: RunCmdOptions,
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const scriptArgs = getScriptArgs(command, args);

  if (!scriptArgs) {
    return runCmdWithPipe(command, args, options);
  }

  return runCmdWithPipe('script', scriptArgs, options);
}

function runCmdWithPipe(
  command: string,
  args: string[],
  options: RunCmdOptions,
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: 'pipe',
    });

    let output = '';
    let error = '';
    let promptBuffer = '';
    let respondedToAuthPrompt = false;

    function handleOutput(
      data: Buffer,
      stream: NodeJS.WriteStream,
      append: (text: string) => void,
    ) {
      const text = data.toString().replaceAll(SCRIPT_EOF_MARKER_REGEX, '');
      append(text);
      stream.write(text);

      promptBuffer = `${promptBuffer}${text}`.slice(-2000);

      if (
        !respondedToAuthPrompt
        && NPM_BROWSER_AUTH_PROMPT_REGEX.test(promptBuffer)
      ) {
        respondedToAuthPrompt = true;
        proc.stdin.write('\n');
      }
    }

    function forwardInput(data: Buffer) {
      if (proc.stdin.writable) {
        proc.stdin.write(data);
      }
    }

    process.stdin.on('data', forwardInput);

    proc.stdout.on('data', (data: Buffer) => {
      handleOutput(data, process.stdout, (text) => {
        output += text;
      });
    });

    proc.stderr.on('data', (data: Buffer) => {
      handleOutput(data, process.stderr, (text) => {
        error += text;
      });
    });

    proc.on('close', (code) => {
      process.stdin.off('data', forwardInput);

      if (code === 0) {
        resolve({ ok: true, output });
      } else {
        resolve({
          ok: false,
          error: error || output || `Command failed with exit code ${code}`,
        });
      }
    });

    proc.on('error', (spawnError) => {
      process.stdin.off('data', forwardInput);
      resolve({ ok: false, error: spawnError.message });
    });
  });
}

function getScriptArgs(command: string, args: string[]): string[] | undefined {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return undefined;
  }

  if (platform === 'darwin') {
    return ['-q', '/dev/null', command, ...args];
  }

  if (platform === 'linux') {
    return ['-qfec', [command, ...args].map(shellQuote).join(' '), '/dev/null'];
  }

  return undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
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
