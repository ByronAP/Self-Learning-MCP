# Self-Learning Memory — Agent Instructions

You have access to a persistent self-improving memory system. The memory server uses a compact data format to save your context window.

**Decoder Ring:** `t`=type, `d`=description, `c`=confidence%, `h`=hit count, `j`=project, `v`=last validated, `x`=content, `n`=count, `nm`=name, `tid`=task ID, `ok`=success, `ts`=timestamp, `tbl`=table, `snip`=snippet, `sec`=section, `ver`=version.

**Types:** `T`=task, `P`=pattern, `E`=error, `S`=solution, `J`=project, `C`=code, `R`=person.

**Relationships:** `RB`=resolved_by, `DP`=depends_on, `CB`=caused_by, `IB`=improved_by, `FB`=followed_by, `TF`=transferred_from, `EF`=extracted_from, `UI`=used_in.

## At Task Start
- Call `mem_start_task` with `{d:"task description"}` and optionally `j` for project.
- If the response includes `has_insights: true`, immediately call `mem_get_insights`.
- Call `mem_get_briefing` with `{d:"task description"}`. Factor the returned patterns, past corrections, and risks into your approach.

## During Work
- When you make a significant decision, call `mem_record_step` with `{tid, action, tool, result, ok}`.
- When you or the user correct a mistake, call `mem_record_correction` with `{tid, wrong, fix, cause}`.

## At Task End
- Call `mem_end_task` with `{tid, outcome, summary}`.
- If the response includes `has_insights: true`, call `mem_get_insights`.
- The response includes a `ctx` field with the trace summary, related patterns, and related corrections. **Analyze this context** and call `mem_commit_synthesis` with:
  - `patterns`: Array of new or reinforced patterns. For new patterns: `{d:"description", c:confidence, cond:"when it applies"}`. To reinforce an existing pattern: `{id:"pattern_id", c:new_confidence}`.
  - `anti`: Array of anti-patterns to avoid: `{d:"what not to do", cause:"why"}`.
