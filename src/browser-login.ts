import { spawn } from 'node:child_process';
import { mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';

export const TIKTOK_LOGIN_URL = 'https://www.tiktok.com/login';

// Match native Chrome's OS keychain. Playwright's testing stores cannot decrypt
// cookies saved with the native keychain. This does not change automation flags.
export const sharedProfileOptions = {
  ignoreDefaultArgs: ['--password-store=basic', '--use-mock-keychain']
};

/** Authentication is manual in an ordinary Chrome process, without Playwright/CDP. */
export async function manualBrowserLogin(profile: string, options: {
  executablePath?: string;
  signal?: AbortSignal;
  url?: string;
  onOpen?: () => void;
} = {}) {
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await chmod(profile, 0o700);
  if (options.signal?.aborted) return;
  await new Promise<void>((done, reject) => {
    const child = spawn(options.executablePath || process.env.CHROME_PATH || '/usr/bin/google-chrome', [
      '--user-data-dir=' + resolve(profile), '--new-window', options.url || TIKTOK_LOGIN_URL
    ], { stdio: 'ignore', shell: false, signal: options.signal });
    child.once('spawn', () => options.onOpen?.());
    child.once('error', reject);
    child.once('close', code => {
      if (options.signal?.aborted || code === 0) done();
      else reject(new Error('O Chrome de login não encerrou normalmente. Confira a sessão gráfica e feche as outras janelas desse perfil.'));
    });
  });
}
