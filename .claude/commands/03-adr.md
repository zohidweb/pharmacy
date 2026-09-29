---
description: "Record an architecture decision (ADR). Lives for the whole project lifecycle."
argument-hint: "[title of the decision]"
allowed-tools: Read, Write, Bash(ls:*)
---

Existing ADRs: !`ls docs/architecture/adr 2>/dev/null || echo EMPTY`

Template: @templates/adr-template.md

# Record an ADR

Decision title (may be empty): $ARGUMENTS

Work in Russian. Rules from the root CLAUDE.md apply. Number = highest existing NNNN + 1, zero-padded to 4 digits (start at 0001).
File: `docs/architecture/adr/NNNN-<short-slug-latin>.md`, following the template exactly:
Статус, Дата, Контекст, Рассмотренные варианты (min 2), Решение, Последствия — the negative
consequences are MANDATORY; push back if the user claims there are none.

If the decision involves a technology outside the radar («Утверждено» statuses in
tech-radar/RADAR.md): keep the ADR in status `proposed`, fill the exception section
(alternatives from the radar, approvals fields empty), and tell the user to submit it via
tech-radar/EXCEPTIONS.md. The technology may not be used until approvals are recorded. Once approvals are recorded in the ADR, change its status to `accepted`.

During the design phase the minimum set is ADR-0001 (выбор стека — summarize from
docs/architecture/stack.md) for all tracks; ADR-0002 (стиль архитектуры: монолит / модульный
монолит / микросервисы — with real reasoning for THIS project, not generic) is additionally
required for the Full track (Lite: only 0001).

Finish with a Russian summary. If this was ADR-0002 during design phase, remind: next is the
human gate — Architecture Review; the reviewer records docs/architecture/APPROVAL.md
(см. README, раздел «Ревью архитектуры»), then `/04-generate-claude-md`.
