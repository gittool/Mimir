#!/usr/bin/env node
/**
 * Cross-platform startup script for Mimir
 * Detects architecture and uses the right docker-compose file
 */

import { execSync } from 'child_process';
import { existsSync, copyFileSync } from 'fs';
import { createInterface } from 'readline';
import { platform, arch } from 'process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// ANSI color codes
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function detectSystem() {
  log('🚀 Mimir Smart Startup', 'blue');
  console.log('');

  const os = platform;
  const architecture = arch;

  log('Detected System:', 'blue');
  console.log(`  OS: ${os}`);
  console.log(`  Architecture: ${architecture}`);
  console.log('');

  return { os, architecture };
}

function selectComposeFile({ os, architecture }) {
  let composeFile = 'docker-compose.yml';
  let systemName = 'Unknown';

  if (os === 'darwin') {
    // macOS
    if (architecture === 'arm64') {
      systemName = 'macOS ARM64 (Apple Silicon)';
      composeFile = 'docker-compose.arm64.yml';
    } else {
      systemName = 'macOS x86_64';
      composeFile = 'docker-compose.yml';
    }
  } else if (os === 'linux') {
    // Linux
    if (architecture === 'arm64' || architecture === 'aarch64') {
      systemName = 'Linux ARM64';
      composeFile = 'docker-compose.arm64.yml';
    } else {
      systemName = 'Linux x86_64';
      composeFile = 'docker-compose.yml';
    }
  } else if (os === 'win32') {
    // Windows
    systemName = 'Windows';
    composeFile = 'docker-compose.amd64.yml';
  } else {
    log('⚠️  Unknown OS, using default docker-compose.yml', 'yellow');
  }

  if (systemName !== 'Unknown') {
    log(`✓ ${systemName} detected`, 'green');
  }

  log(`Using compose file: ${composeFile}`, 'blue');
  console.log('');

  return composeFile;
}

function checkEnvFile() {
  const envPath = join(projectRoot, '.env');
  const envExamplePath = join(projectRoot, 'env.example');

  if (!existsSync(envPath)) {
    log('⚠️  No .env file found, copying from env.example', 'yellow');
    copyFileSync(envExamplePath, envPath);
    log('✓ Created .env file', 'green');
    console.log('');
  }
}

function runDockerCommand(composeFile, command, args = []) {
  const composePath = join(projectRoot, composeFile);
  const fullCommand = `docker compose -f "${composePath}" ${command} ${args.join(' ')}`;
  
  try {
    execSync(fullCommand, { 
      stdio: 'inherit',
      cwd: projectRoot
    });
    return true;
  } catch (error) {
    log(`❌ Command failed: ${error.message}`, 'red');
    return false;
  }
}

function askQuestion(query) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function handleCommand(composeFile, command, extraArgs) {
  switch (command) {
    case 'up':
    case 'start':
      log('🏗️  Starting services...', 'blue');
      runDockerCommand(composeFile, 'up -d', extraArgs);
      console.log('');
      log('✅ Services started!', 'green');
      console.log('');
      log('Access Points:', 'blue');
      console.log('  • Mimir Server: http://localhost:9042');
      console.log('  • Neo4j Browser: http://localhost:7474');
      console.log('  • Copilot API: http://localhost:4141');
      console.log('  • LLM Embeddings: http://localhost:11434');
      break;

    case 'down':
    case 'stop':
      log('🛑 Stopping services...', 'blue');
      runDockerCommand(composeFile, 'down', extraArgs);
      log('✅ Services stopped', 'green');
      break;

    case 'restart':
      log('🔄 Restarting services...', 'blue');
      runDockerCommand(composeFile, 'restart', extraArgs);
      log('✅ Services restarted', 'green');
      break;

    case 'build':
      log('🔨 Building images...', 'blue');
      runDockerCommand(composeFile, 'build', extraArgs);
      log('✅ Build complete', 'green');
      break;

    case 'rebuild':
      log('🔨 Rebuilding from scratch...', 'blue');
      runDockerCommand(composeFile, 'down', []);
      runDockerCommand(composeFile, 'build --no-cache', extraArgs);
      runDockerCommand(composeFile, 'up -d', []);
      log('✅ Rebuild complete', 'green');
      break;

    case 'logs':
      runDockerCommand(composeFile, 'logs -f', extraArgs);
      break;

    case 'status':
    case 'ps':
      runDockerCommand(composeFile, 'ps', extraArgs);
      break;

    case 'clean': {
      log('⚠️  This will remove all containers, volumes, and data!', 'yellow');
      const confirm = await askQuestion('Are you sure? (yes/no): ');
      if (confirm.toLowerCase() === 'yes') {
        log('🧹 Cleaning up...', 'blue');
        runDockerCommand(composeFile, 'down -v', []);
        
        // Remove data directories
        try {
          const { rmSync } = await import('fs');
          const dataPath = join(projectRoot, 'data', 'neo4j');
          const logsPath = join(projectRoot, 'logs', 'neo4j');
          
          if (existsSync(dataPath)) {
            rmSync(dataPath, { recursive: true, force: true });
          }
          if (existsSync(logsPath)) {
            rmSync(logsPath, { recursive: true, force: true });
          }
        } catch (err) {
          log(`⚠️  Could not remove data directories: ${err.message}`, 'yellow');
        }
        
        log('✅ Cleanup complete', 'green');
      } else {
        log('Cancelled', 'yellow');
      }
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      console.log('Usage: npm run start [command] [args]');
      console.log('');
      console.log('Commands:');
      console.log('  up, start      Start all services (default)');
      console.log('  down, stop     Stop all services');
      console.log('  restart        Restart all services');
      console.log('  build          Build images');
      console.log('  rebuild        Full rebuild (no cache) and restart');
      console.log('  logs           Follow logs');
      console.log('  status, ps     Show service status');
      console.log('  clean          Remove all containers and data');
      console.log('  help           Show this help');
      console.log('');
      console.log('Examples:');
      console.log('  npm run start              # Start all services');
      console.log('  npm run start down         # Stop all services');
      console.log('  npm run start logs         # View logs');
      console.log('  npm run start rebuild      # Full rebuild');
      break;

    default:
      log(`❌ Unknown command: ${command}`, 'red');
      console.log("Run 'npm run start help' for usage");
      process.exit(1);
  }
}

async function main() {
  const system = detectSystem();
  const composeFile = selectComposeFile(system);
  checkEnvFile();

  const command = process.argv[2] || 'up';
  const extraArgs = process.argv.slice(3);

  await handleCommand(composeFile, command, extraArgs);
}

main().catch(error => {
  log(`❌ Error: ${error.message}`, 'red');
  process.exit(1);
});
