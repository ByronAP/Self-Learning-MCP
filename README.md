# Self-Learning MCP Server

> Self-improving memory for AI agents — Antigravity-native MCP server

A persistent memory system that lets AI agents **learn from their own work**. Records tasks, extracts patterns, detects mistakes, and proactively surfaces insights — all using the agent's own model through a cooperative intelligence pattern.

## Quick Start (Antigravity)

```bash
# 1. Clone and build
git clone <repo-url> && cd Self-Learning-MCP
npm install && npm run build

# 2. Register in Antigravity
node dist/src/cli.js init
```

That's it. **No API keys. No model config. No env vars.** The server uses Antigravity's own model for all reasoning.

## How It Works

### Agent-Cooperative Intelligence

Unlike traditional memory systems that need their own LLM, this server uses a **cooperative pattern**:

1. **Server** handles storage, retrieval, and structuring (SQLite + FTS5)
2. **Agent** (running on Antigravity's model) does all reasoning and synthesis
3. **Agent** commits learned patterns back to the server

```
Agent does work → calls mem_end_task → server returns synthesis context
→ agent reasons over it → calls mem_commit_synthesis → patterns stored
→ next task: mem_get_briefing → patterns influence approach
```

### The Learning Loop

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Record  │────▶│  Recall  │────▶│Synthesize│────▶│ Proactive│
│          │     │          │     │          │     │          │
│ Tasks    │     │ Briefings│     │ Patterns │     │ Insights │
│ Steps    │     │ Context  │     │ Anti-pat │     │ Drift    │
│ Errors   │     │ Wiki     │     │ Wiki     │     │ Risks    │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
```

### Compact Wire Codec

All tool outputs use a token-efficient format (~77% smaller than verbose JSON):

```
Verbose: {"type":"pattern","description":"validate webhooks","confidence":0.95,"tags":["api","security"]}
Compact: {"t":"P","d":"validate webhooks","c":95,"ta":"api|security"}
```

## Tools Reference

### Record (6 tools)

| Tool | Description |
|------|-------------|
| `mem_start_task` | Begin a task trace `{d, j?, conv?}` → `{tid, has_insights}` |
| `mem_record_step` | Record a step `{tid, action, tool?, result?, ok?}` |
| `mem_record_correction` | Record a correction `{tid, wrong, fix, cause?}` |
| `mem_end_task` | Close trace `{tid, outcome?, summary?}` → synthesis context |
| `mem_store_entity` | Store entity `{t, nm, d?, j?, obs?[]}` |
| `mem_add_relationship` | Create edge `{src, tgt, rel}` |

### Recall (6 tools)

| Tool | Description |
|------|-------------|
| `mem_recall` | Full-text search `{q, n?, t?, j?}` |
| `mem_get_context` | Context packet for topic `{topic, j?}` |
| `mem_get_wiki` | Retrieve wiki `{j?, sec?}` |
| `mem_query_graph` | Structured query `{t?, rel?, j?, since?, n?}` |
| `mem_get_entity` | Entity details `{id}` |
| `mem_get_briefing` | Pre-task intelligence `{d, j?}` |

### Cooperative (3 tools)

| Tool | Description |
|------|-------------|
| `mem_commit_synthesis` | Commit learned patterns `{tid, patterns[], anti[]}` |
| `mem_commit_wiki` | Save wiki sections `{sections[{sec, j?, x}]}` |
| `mem_regenerate_wiki` | Gather wiki context `{j?}` |

### Proactive (3 tools)

| Tool | Description |
|------|-------------|
| `mem_get_insights` | Active insights `{t?, n?}` |
| `mem_dismiss_insight` | Dismiss insight `{id, reason?}` |
| `mem_set_watch` | Set watch `{condition, entity_id?}` |

## Compact Codec Decoder Ring

| Short Key | Full Name |
|-----------|-----------|
| `t` | type |
| `d` | description |
| `c` | confidence (0-100) |
| `h` | hit count |
| `j` | project |
| `nm` | name |
| `x` | content |
| `n` | count / total |
| `tid` | task ID |
| `ok` | success |
| `ts` | timestamp |
| `sec` | section |

**Entity Types:** `T`=task, `P`=pattern, `E`=error, `S`=solution, `J`=project, `C`=code, `R`=person

**Relationships:** `RB`=resolved_by, `DP`=depends_on, `CB`=caused_by, `IB`=improved_by, `FB`=followed_by, `TF`=transferred_from, `EF`=extracted_from, `UI`=used_in

## Configuration

All optional, via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SELF_LEARNING_MCP_DB` | `~/.gemini/antigravity/self-learning-mcp/memory.db` | Database path |
| `SELF_LEARNING_MCP_PROACTIVE_MIN` | `30` | Minutes between proactive analysis |
| `SELF_LEARNING_MCP_STALENESS_DAYS` | `30` | Days before pattern flagged stale |
| `SELF_LEARNING_MCP_CODEC` | `compact` | Wire format: `compact` or `verbose` |
| `SELF_LEARNING_MCP_LOG` | `info` | Log level |

## Architecture

```
src/
├── server.ts              # MCP entry point + proactive engine startup
├── config.ts              # Env-var configuration
├── cli.ts                 # Init command for Antigravity setup
├── codec/                 # Token-efficient wire format
│   ├── types.ts           # Type codes, field maps
│   ├── encoder.ts         # Internal → compact
│   ├── decoder.ts         # Compact/verbose → internal
│   └── index.ts           # Public API
├── db/
│   ├── schema.sql         # SQLite schema (13 tables + 5 FTS5)
│   └── database.ts        # Database class (SQL embedded)
├── tools/
│   ├── record.ts          # 6 recording tools
│   ├── recall.ts          # 6 recall tools
│   ├── cooperative.ts     # 3 synthesis tools
│   └── proactive.ts       # 3 proactive tools
├── wiki/
│   └── generator.ts       # Wiki context gathering
└── proactive/
    ├── engine.ts           # Hybrid scheduler orchestrator
    ├── staleness-detector.ts
    ├── drift-detector.ts
    ├── risk-forecaster.ts
    ├── opportunity-surfacer.ts
    ├── briefing-assembler.ts
    └── index.ts
```

## Generic MCP Usage

Works with any MCP client, not just Antigravity. Add to your MCP config:

```json
{
  "mcpServers": {
    "self-learning-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/Self-Learning-MCP/dist/src/server.js"]
    }
  }
}
```

The difference: without `instructions.md`, the client agent needs to know when to call the memory tools on its own.

## License

MIT
