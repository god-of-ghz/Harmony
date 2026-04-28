const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const mockDataDir = path.join(__dirname, '../../server/data_mock');

console.log('Cleaning mock database...');

try {
  // Gracefully attempt to kill port 3001
  execSync('npx kill-port 3001', { stdio: 'ignore' });
} catch (e) {}

try {
  // Forcefully kill any orphaned mock server processes
  if (process.platform === 'win32') {
    execSync('wmic process where "commandline like \'%src/server.ts%\'" call terminate', { stdio: 'ignore' });
  } else {
    execSync('pkill -f "src/server.ts"', { stdio: 'ignore' });
  }
} catch (e) {}

function attemptClean(retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(mockDataDir)) {
        fs.rmSync(mockDataDir, { recursive: true, force: true });
      }
      console.log('Mock database cleaned successfully.');
      return;
    } catch (e) {
      if (i === retries - 1) {
        console.error('Failed to clean mock database after retries: ' + e.message);
      } else {
        // Sleep for 1 second before retrying
        const start = Date.now();
        while (Date.now() - start < 1000) {}
      }
    }
  }
}

attemptClean();
