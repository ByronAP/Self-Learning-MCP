# Contributing to Self-Learning MCP

Thank you for your interest in contributing! This project aims to provide a robust, self-improving memory layer for AI agents via the Model Context Protocol (MCP).

## Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/self-learning-mcp.git
   cd self-learning-mcp
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

4. **Run tests:**
   ```bash
   npm test
   ```

## Pull Request Guidelines

- Ensure `npm test` and `npm run build` pass before submitting.
- Follow the existing code style (ESM, Node 16+ modules).
- Write tests for any new features or bug fixes.
- Update `README.md` and `instructions.md` if you introduce new tools or modify the learning loop.

## Architecture Guidelines

- **Zero LLM Calls:** The server itself must remain deterministic. All reasoning is delegated to the client agent via the cooperative intelligence pattern.
- **Token Efficiency:** Any new tools or data models should integrate with the `src/codec` module to ensure the wire format remains token-efficient.
- **Idempotency:** Proactive analyzers must be idempotent and avoid creating duplicate insights.

## Code of Conduct

Please treat all community members with respect.
