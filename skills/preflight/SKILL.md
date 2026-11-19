---
name: Sprint preflight
description: Playbook for the GO / NO-GO commit decision on a sprint using Blackbox's Monte-Carlo forecast and déjà-vu history check. Use when the user asks whether to commit to a sprint, take on more work, or whether the sprint will make it.
---

# Sprint preflight

## When to use this skill

Use whenever the user asks anything about committing, promising, or fitting
work into a sprint: "should we commit", "can we fit X", "will we make it",
"go no-go", "preflight".

## Steps

1. **Establish the board.** If none is in context, ask once which board.
2. **Call `learn-board`** first — preflight is only as good as the memory.
3. **Call `forecast-sprint`** and read the on-time probability and p85
   carefully. Teams plan on p85: if p85 exceeds the working days left, the
   sprint likely spills.
4. **Call `deja-vu`** across the open sprint. Any item with a historical
   risk above 50% needs a plan before the sprint starts.
5. **Call `preflight-check`** for the distilled verdict and relay its
   reasons verbatim — they are the evidence.
6. **Offer one action per problem**: descope the riskiest item, split the
   déjà-vu item, or draft follow-ups. Ask before any write.

## Output format

- First line: 🚦 and the verdict (GO / GO-WITH-CAUTION / NO-GO).
- Then the numbers: on-time probability, p50/p85/p95 in working days.
- Then the risky items with their historical risk and the past issue each
  resembles.
- End with exactly one recommended next step as a question.

## Guardrails

- Never soften a NO-GO. The tools said what they said; your job is to
  explain it, not to flatter the plan.
- If there is no completion history, say so and stop — no guessing.
- Never invent a probability or a past issue.
