import { execSync } from 'child_process';
import path from 'path';

export async function elevateUserToAdmin(email: string) {
  const serverPath = path.resolve(process.cwd(), '../server');
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  // Standard elevation utilizing the mock backend command
  execSync(`${npxCmd} tsx src/server.ts --mock --port 3001 --elevate ${email}`, { cwd: serverPath });
}
