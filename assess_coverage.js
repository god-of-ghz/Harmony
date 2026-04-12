const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const basePath = __dirname;
const clientPath = path.join(basePath, 'client');
const serverPath = path.join(basePath, 'server');

function installCoverage(targetPath) {
    console.log(`Ensuring @vitest/coverage-v8 is installed in ${targetPath}...`);
    try {
        execSync('npm list @vitest/coverage-v8', { cwd: targetPath, stdio: 'ignore' });
    } catch {
        console.log(`Installing coverage package in ${targetPath}...`);
        execSync('npm install -D @vitest/coverage-v8', { cwd: targetPath, stdio: 'inherit' });
    }
}

function runCoverage(targetPath, name) {
    console.log(`\n===========================================`);
    console.log(`Running coverage assessment for: ${name}`);
    console.log(`===========================================`);
    installCoverage(targetPath);
    try {
        const output = execSync('npm run test -- --coverage', { cwd: targetPath, encoding: 'utf-8' });
        console.log(output);
    } catch (err) {
        console.error(`Coverage run for ${name} ended with issues:`);
        if (err.stdout) console.log(err.stdout);
    }
}

console.log("Starting Harmony Codebase Coverage Assessment...");
runCoverage(serverPath, 'Server');
runCoverage(clientPath, 'Client');
console.log("\nAssessment Complete.");
