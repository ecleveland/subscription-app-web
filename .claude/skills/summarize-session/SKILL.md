---
name: summarize-session
description: Summarize the work done in this session and save it to .claude/docs
disable-model-invocation: true
allowed-tools: Read, Grep, Glob, Bash, Write
argument-hint: [filename-slug]
---

# Summarize Session

Generate a concise summary of the work done in this session and write it to `.claude/docs/`.

## Steps

1. **Gather context** — Run these commands to understand what was done:
   - `git log --oneline main...HEAD` (or if already on main, find the commits from this session by checking the plan file dates or recent commits)
   - `git diff --stat <first-commit>^..HEAD` to see all files changed
   - Read the plan file if one exists under `~/.claude/plans/` (check conversation context for the plan filename)
   - Review the conversation context for what was requested and why

2. **Determine the filename** — If `$ARGUMENTS` is provided, use it as the filename slug (e.g., `$ARGUMENTS.md`). Otherwise, derive a short kebab-case slug from the main topic of the work (e.g., `dark-mode-theme-toggle.md`, `add-user-auth.md`).

3. **Write the summary** to `.claude/docs/<slug>.md` using this exact format:

```markdown
# <Title — short descriptive name of the change>

**Date**: <YYYY-MM-DD>
**Commit**: `<short-hash>` on `<branch>`

## What changed

<1-2 sentence high-level summary of what was done and why.>

### <Group 1 heading> (<count> new/modified files)
- **`path/to/file`** — <what it does / what changed>
- **`path/to/file`** — <what it does / what changed>

### <Group 2 heading>
- **`path/to/file`** — <what changed>

<Repeat groups as needed. Group logically — by feature area, by new vs modified, or by layer (infra, components, pages).>

## <Optional: data tables, config details, or other structured info relevant to the change>

<Use tables for things like color palettes, API routes, env vars, mappings, etc. Only include if genuinely useful for future reference. Skip if not applicable.>

## Key decisions
- **<Decision>** — <brief rationale>
- **<Decision>** — <brief rationale>
```

## Guidelines

- Be concise — this is a reference doc, not a narrative. Bullet points over paragraphs.
- Bold file paths and use code formatting for values, classes, commands.
- Group files logically rather than listing them flat.
- Only include a data table section if the change introduced structured data worth referencing (palettes, route tables, env vars, etc.). Otherwise skip it.
- Key decisions should capture the "why" — choices that weren't obvious and their rationale.
- If multiple commits were made, reference the final commit hash and mention the range.
- Do NOT include the plan file content — this is a distilled outcome summary.
