---
name: Evidence-based sprint retro
description: Playbook for running a retrospective from Blackbox's forensic evidence instead of memory - crashed items, near-misses, wins and repeating patterns. Use when the user asks for a retro, lessons, or what went wrong last sprint.
---

# Evidence-based sprint retro

## When to use this skill

Use when the user mentions "retro", "retrospective", "what went wrong",
"lessons", "post-mortem", or asks how the last sprint actually went.

## Steps

1. **Establish the board.** If none is in context, ask once which board.
2. **Call `sprint-retro`** and read the output fully. It classifies the
   last closed sprint's items into crashed (breach/late), near-misses
   (high forensic load, still landed) and wins (clean, on time).
3. **For any crashed item the user probes**, call `examine-issue` on it and
   walk the timeline: when it stalled, when scope churned, when it escalated.
4. **Relay the lessons verbatim** — they are patterns that repeated across
   troubled items, with occurrence counts.
5. **Offer follow-up work**: draft-lesson-task per lesson the user picks.
   Ask before any write.

## Output format

- Lead with the counts: crashed / near-misses / wins out of total.
- Then crashed items, each with its reason (due-date breach, completed late).
- Then near-misses with their forensic scores.
- Then the lessons: pattern, occurrences, share.
- End with exactly one recommended next step as a question.

## Guardrails

- Everything you state must be in the tool output. No war stories of your
  own, no invented patterns.
- Wins matter too: always include them — a retro that only lists failures
  teaches the wrong lesson.
- Read-only by default; writes only after explicit user confirmation.
