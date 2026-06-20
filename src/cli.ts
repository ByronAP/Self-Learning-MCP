#!/usr/bin/env node

/**
 * CLI for self-learning-mcp setup and management.
 *
 * Usage:
 *   node dist/src/cli.js init   — Register in Antigravity's mcp_config.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ANTIGRAVITY_DIR = path.join(os.homedir(), '.gemini', 'antigravity');
const MCP_CONFIG_PATH = path.join(ANTIGRAVITY_DIR, 'mcp_config.json');
const MCP_INSTRUCTIONS_DIR = path.join(ANTIGRAVITY_DIR, 'mcp', 'self-learning-mcp');

function init() {
  console.log('[self-learning-mcp] Initializing Antigravity integration...\n');

  // 1. Resolve the server entry point
  const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', '..');
  const serverPath = path.join(projectRoot, 'dist', 'src', 'server.js').replace(/\\/g, '/');

  console.log(`  Server path: ${serverPath}`);

  // 2. Read or create mcp_config.json
  let mcpConfig: { mcpServers: Record<string, unknown> } = { mcpServers: {} };

  if (fs.existsSync(MCP_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(MCP_CONFIG_PATH, 'utf-8');
      mcpConfig = JSON.parse(raw);
      if (!mcpConfig.mcpServers) {
        mcpConfig.mcpServers = {};
      }
    } catch {
      console.warn('  ⚠ Could not parse existing mcp_config.json, creating new one.');
    }
  }

  // 3. Add self-learning-mcp server entry
  mcpConfig.mcpServers['self-learning-mcp'] = {
    command: 'node',
    args: [serverPath],
  };

  // Ensure directory exists
  fs.mkdirSync(path.dirname(MCP_CONFIG_PATH), { recursive: true });
  fs.writeFileSync(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log(`  ✓ Updated ${MCP_CONFIG_PATH}`);

  // 4. Copy instructions.md to the MCP server directory
  const sourceInstructions = path.join(projectRoot, 'instructions.md');
  const destInstructions = path.join(MCP_INSTRUCTIONS_DIR, 'instructions.md');

  if (fs.existsSync(sourceInstructions)) {
    fs.mkdirSync(MCP_INSTRUCTIONS_DIR, { recursive: true });
    fs.copyFileSync(sourceInstructions, destInstructions);
    console.log(`  ✓ Copied instructions.md → ${destInstructions}`);
  } else {
    console.warn(`  ⚠ instructions.md not found at ${sourceInstructions}`);
  }

  console.log('\n  Done! Restart Antigravity to load the memory server.');
  console.log('  No API keys or model config needed — the agent handles all reasoning.\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const command = process.argv[2];

switch (command) {
  case 'init':
    init();
    break;
  default:
    console.log(`
self-learning-mcp — Self-improving memory for AI agents

Commands:
  init    Register this MCP server in Antigravity

Usage:
  node dist/src/cli.js init
`);
}
