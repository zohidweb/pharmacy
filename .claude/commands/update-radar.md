---
description: "Refresh the local tech-radar/ copy from the central ai-project-start repository"
argument-hint: ""
allowed-tools: Read, Bash(git:*), Bash(ls:*), Bash(cp:*), Bash(rm:*), Bash(robocopy:*), Bash(head:*)
---

Local radar header: !`head -5 tech-radar/RADAR.md`

# Update local tech radar

1. Read the source URL from the RADAR.md header line `Источник: <url>`.
   If it still contains the unpublished-placeholder text — tell the user the central
   repository is not published yet and stop.
2. Fetch fresh copy and replace local `tech-radar/` (Bash writes are the sanctioned path —
   the guard hook only blocks Write/Edit tools):

```bash
git clone --depth 1 <source-url> .radar-tmp
rm -rf tech-radar && cp -r .radar-tmp/tech-radar tech-radar
rm -rf .radar-tmp
```

3. Show the user a Russian diff summary: old version/date → new version/date, and any
   status changes that affect technologies used by this project (compare with
   docs/architecture/stack.md if it exists). If a used technology moved to «Запрещено» —
   flag it prominently and point to GOVERNANCE.md (migration is coordinated with the
   radar owner).
