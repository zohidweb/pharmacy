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

Every new ADR is created with status `proposed`. It becomes `accepted` only after review by the
project architect (recorded in docs/architecture/APPROVAL.md); do not set `accepted` yourself.
A technology, framework-level library, integration or component introduced by the ADR may not be
used in code until the ADR is `accepted`. If the template contains sections that do not apply to
this project (e.g. external approval fields), omit them.

During the design phase the minimum set is ADR-0001 (выбор стека — summarize from
docs/architecture/stack.md) for all tracks; ADR-0002 (стиль архитектуры: монолит / модульный
монолит / микросервисы — with real reasoning for THIS project, not generic) is additionally
required for the Full track (Lite: only 0001).

Finish with a Russian summary. If this was ADR-0002 during design phase, remind: next is the
human gate — Architecture Review by the project architect, who records the result in
docs/architecture/APPROVAL.md (см. README, раздел «Ревью архитектуры»), then `/04-generate-claude-md`.
