import { spawn } from 'child_process';
import { platform } from 'node:process';
import { styleText } from 'node:util';

const NPM_BROWSER_AUTH_PROMPT_REGEX = /Press\s+ENTER\s+to\s+open\s+in\s+(?:the\s+)?browser\.\.\./i;
const NPM_AUTH_URL_TITLE_REGEX = /(?:Login|Authenticate your account|Create your account|Browser unavailable\. Please open the URL manually) at:/i;
const URL_REGEX = /https?:\/\/[^\s)]+/i;

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
  return runCmdAndOpenAuthUrl(command, args, options);
}

function runCmdAndOpenAuthUrl(
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
    let answeredBrowserPrompt = false;
    let openedAuthUrl = false;

    function handleOutput(
      data: Buffer,
      stream: NodeJS.WriteStream,
      append: (text: string) => void,
    ) {
      const text = data.toString();
      append(text);
      stream.write(text);

      promptBuffer = `${promptBuffer}${text}`.slice(-2000);

      if (!answeredBrowserPrompt && NPM_BROWSER_AUTH_PROMPT_REGEX.test(promptBuffer)) {
        answeredBrowserPrompt = true;
        proc.stdin.write('\n');
      }

      if (!openedAuthUrl) {
        const authUrl = getNpmAuthUrl(promptBuffer);

        if (authUrl) {
          openedAuthUrl = true;
          openUrl(authUrl);
        }
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

function getNpmAuthUrl(output: string): string | undefined {
  const titleMatch = output.match(NPM_AUTH_URL_TITLE_REGEX);

  if (titleMatch?.index === undefined) return undefined;

  return output.slice(titleMatch.index).match(URL_REGEX)?.[0];
}

function openUrl(url: string): void {
  if (platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (platform === 'linux') {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  }
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
