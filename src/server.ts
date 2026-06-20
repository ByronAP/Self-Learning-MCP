#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.js';
import { Database } from './db/database.js';
import { recordToolDefs, createRecordHandlers } from './tools/record.js';
import { recallToolDefs, createRecallHandlers } from './tools/recall.js';
import { cooperativeToolDefs, createCooperativeHandlers } from './tools/cooperative.js';
import { proactiveToolDefs, createProactiveHandlers } from './tools/proactive.js';
import { ProactiveEngine } from './proactive/index.js';

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

const db = new Database(config.dbPath);

const server = new Server(
  {
    name: 'self-learning-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const allToolDefs = [...recordToolDefs, ...recallToolDefs, ...cooperativeToolDefs, ...proactiveToolDefs];

const recordHandlers = createRecordHandlers(db, config);
const recallHandlers = createRecallHandlers(db, config);
const cooperativeHandlers = createCooperativeHandlers(db, config);
const proactiveHandlers = createProactiveHandlers(db, config);

const toolHandlers: Record<string, (args: unknown) => unknown> = {
  ...recordHandlers,
  ...recallHandlers,
  ...cooperativeHandlers,
  ...proactiveHandlers,
};

// ---------------------------------------------------------------------------
// MCP request handlers
// ---------------------------------------------------------------------------

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: allToolDefs };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = toolHandlers[name];
  if (!handler) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: `Unknown tool: ${name}` }),
        },
      ],
      isError: true,
    };
  }

  try {
    const result = handler(args ?? {});
    return {
      content: [
        {
          type: 'text' as const,
          text: typeof result === 'string' ? result : JSON.stringify(result),
        },
      ],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ error: message }),
        },
      ],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'memory://stats',
        name: 'Memory Stats',
        description: 'Entity, pattern, and insight counts',
        mimeType: 'application/json',
      },
      {
        uri: 'memory://wiki/latest',
        name: 'Latest Wiki',
        description: 'Full synthesized wiki',
        mimeType: 'application/json',
      },
      {
        uri: 'memory://insights/active',
        name: 'Active Insights',
        description: 'Current proactive insights',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case 'memory://stats': {
      const stats = {
        entities: db.getEntityCount(),
        patterns: db.getPatternStats(),
        traces: db.getTraceStats(null),
      };
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(stats),
          },
        ],
      };
    }

    case 'memory://wiki/latest': {
      const wiki = db.getLatestWiki();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(wiki),
          },
        ],
      };
    }

    case 'memory://insights/active': {
      const insights = db.getActiveInsights();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(insights),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Start the proactive heuristic engine
  const engine = new ProactiveEngine(db);
  engine.start();

  // Run initial analysis if needed
  engine.runIfNeeded();

  if (config.logLevel === 'debug' || config.logLevel === 'info') {
    console.error(
      `[self-learning-mcp] Server started. DB: ${config.dbPath}`,
    );
  }
}

main().catch((err) => {
  console.error('[self-learning-mcp] Fatal error:', err);
  process.exit(1);
});
