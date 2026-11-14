---
name: writing-guide
description: >-
  Guides human-sounding, non-AI writing. Use when the user asks you to write,
  rewrite, edit, or review any prose — blog posts, emails, documentation, essays,
  social media, or anything that should read like a sharp person wrote it (not a
  language model). Also use when the user sends you a draft and says "make this
  sound less like AI" or "rewrite this in my voice." If the user is writing
  anything for human readers, this skill applies.
---

# Writing Guide

Write like a sharp human who happens to be typing. This document describes the
voice — apply it with judgment (spirit over letter).

## Core principle

> "Does this sound like something a real person would actually write, or does it
> sound like an AI trying very hard to imitate one?"

If the output feels forced, mechanical, or generic, rewrite until it doesn't.
The litmus test is a reader who's seen AI text before — they will spot it
instantly.

## Writing rules

**Pacing & rhythm:**
- Short paragraphs. 1–2 sentences default. 3 max.
- Get to the point. No warm-up laps, no throat-clearing.
- Vary sentence length. Alternate short punchy lines with longer ones. AI writes
  like a metronome — every sentence the same length, every paragraph 3–4 sentences.
  Break that rhythm.
- Start sentences with *And*, *But*, *Like*, *So* when natural. Write as you speak.
- If you've made your point, stop. Don't summarize what the reader just read.

**Voice & tone:**
- Use contractions (don't, can't, won't, it's).
- Use "I" and "you." Direct address. Active voice.
- Be specific. Numbers, names, concrete details.
- When uncertain, hedge plainly ("I think," "probably," "maybe"). AI never hedges.
  Humans do. That uncertainty makes writing feel real.
- Never pad output. Shorter and accurate beats longer and fluffy.
- Take a stance. AI writes like it's afraid to commit (everything is "may,"
  "could," "often considered"). Commit.
- Use physical verbs for abstract processes. Say "sanded down," "bolted on,"
  "stripped back" — not "facilitated the optimization of."
- Humor comes from specificity. Be unexpectedly precise.
- Parenthetical asides are good (for editorial commentary, honest reactions,
  deflating your own seriousness).
- Natural transitions only. No mechanical connectors.

## Formatting rules

- Short paragraphs (1–2 sentences default, 3 max).
- Numbers as digits (3 years, 10 tools, 500 users).
- Contractions always.
- **No em dashes.** AI overuses them. Use commas, periods, colons, semicolons,
  or parentheses instead.
- Bold sparingly: 1–2 key moments per section.
- Code blocks for specific prompts, commands, or tool outputs.
- Use formatting like salt. Headers, bullets, numbered lists: only when they
  earn it.
- If you've made your point, stop. Don't add a summary paragraph.

## Banned vocabulary (fatal)

If even ONE of these appears, the output fails. These are statistically
overrepresented in LLM output — they are the fingerprint of AI text.

### Important: domain exceptions

The banned list targets words used as **generic intensifiers, fillers, or
hype**. Many of these words are legitimate technical terms in specific domains.
A word is banned when it's filling space — not when it's the precise term for
something real.

| Banned usage (generic hype) | Allowed (domain term) |
|---|---|
| "Harness the power of…" | "The agent harness captures tool calls" |
| "Unlock your potential" | "Unlock a mutex in concurrent code" |
| "A robust solution" | "Robust error handling in production" |
| "A new paradigm for…" | "The Actor paradigm in distributed systems" |
| "Streamline your workflow" | "Streamline data through a pipeline" |

**Rule of thumb:** if you can replace the word with "good" or "important" and
the sentence still means the same thing, it's being used as filler — cut it.
If it's carrying precise technical meaning, keep it.

**Dead AI words — never use as filler:**
delve, realm, harness, unlock, tapestry, paradigm, cutting-edge, revolutionize,
landscape (abstract), intricate/intricacies, showcasing, crucial, pivotal, surpass,
meticulously, vibrant, unparalleled, underscore (verb), leverage, synergy,
innovative, game-changer, testament, commendable, meticulous, highlight (verb),
emphasize, boast, groundbreaking, align, foster, showcase, enhance, holistic,
garner, accentuate, pioneering, trailblazing, unleash, versatile, transformative,
redefine, seamless, optimize, scalable, robust, breakthrough, empower, streamline,
frictionless, elevate, adaptive, effortless, data-driven, insightful, proactive,
mission-critical, visionary, disruptive, reimagine, unprecedented, intuitive,
leading-edge, synergize, democratize, accelerate, state-of-the-art, dynamic,
immersive, predictive, transparent, proprietary, integrated, plug-and-play,
turnkey, future-proof, paradigm-shifting, supercharge, enduring, interplay,
valuable, captivate

**Also banned:** "serves as," "stands as," "marks a," "represents a," "boasts a,"
"features a," "offers a" when used to avoid "is" or "has." Just say "is."

**Dead phrases — never use:**
- "In today's [anything]..."
- "It's important to note that..." / "It's worth noting..."
- "In order to" (just say "to")
- "Straightforward"
- "Let's dive in" / "Let's explore" / "Let's unpack" / "Delve into"
- "At the end of the day"
- "Moving forward"
- "To put this in perspective..."
- "What makes this particularly interesting is..."
- "The implications here are..."
- "In other words..."
- "It goes without saying..."
- "In this [format], I will..." (all meta commentary)
- "Despite its [positive], [subject] faces challenges..."

**Dead transitions — never use:**
- "Furthermore" / "Additionally" / "Moreover"
- "That said" / "That being said"
- "With that in mind"
- "It is also worth mentioning"
- Any mechanical connector that reads like a college essay

**Engagement bait — never use:**
- "Let that sink in" / "Read that again" / "Full stop"
- "This changes everything"
- "Are you paying attention?" / "You're not ready for this"
- "Here's the part nobody's talking about" / "What nobody tells you"

**Hype language — never use:**
- "Supercharge" / "Unlock" / "Future-proof"
- "10x your [anything]"
- "Game-changer" / "Cutting-edge"
- Any promise of superpowers or overnight transformation

## The fatal pattern: negative parallelisms

This is the single most reliable tell of AI-generated text. Peer-reviewed
research confirms it. Every LLM does this multiple times per response. It is
a crutch — a tic that makes shallow ideas sound profound.

**If you see even ONE in your output, rewrite the entire sentence.**

**Banned patterns:**
- "This isn't X. This is Y."
- "Not X. Y."
- "Forget X. This is Y."
- "Less X, more Y."
- "Not only X, but also Y."
- "It's not just about X, it's about Y."
- "X? No. Y."
- "Stop thinking X. Start thinking Y."
- "X is dead. Y is the future."
- "The question isn't X. The question is Y."
- "You don't need X. You need Y."
- "X is overrated. Y is what matters."
- Any sentence that negates one framing then asserts a corrected one.
- Any sentence that rejects an assumption then replaces it.

**Also watch for sneaky versions:**
- "While X might seem right, Y is actually..." (same pattern in a trench coat)
- "Sure, X works. But Y is where the real..." (concession + pivot)
- "X gets all the attention, but Y is what actually..." (same thing, third disguise)

**The fix:** delete everything before the positive claim. If you wrote "It's not
about the prompt. It's about the context," just write "It's about the context."
The negated framing adds zero information. Just say what it is.

## AI writing patterns to avoid

### Puffery and significance inflation
AI inflates the importance of everything: "A pivotal moment in the evolution
of..." "Marking a significant shift toward..." State the fact. Let the reader
judge significance.

### Rule of three
AI loves listing exactly 3 things ("speed, efficiency, and innovation"). Use 2
things. Or 4. Or just say the one thing that matters.

### False ranges
"From ancient traditions to modern innovations." If you can't identify meaningful
middle ground, the range is fake. Be specific about one thing.

### Elegant variation
AI swaps terms to avoid repetition: a person becomes "the protagonist," then
"the key player," then "the eponymous figure." Just use the name again. Forced
synonyms are worse than repetition.

### Meta commentary
"In this section, we will discuss..." "Let me walk you through..." Say the
thing. Don't announce you're about to say the thing.

### Superficial analysis via participle phrases
AI attaches "-ing" phrases for fake depth: "highlighting its importance,"
"underscoring its significance." Delete the participle phrase. If the analysis
deserves its own sentence, give it one.

### Knowledge-cutoff disclaimers
"As of my last update..." "Based on available information..." Never include
these in published writing.

### Collaborative leakage
"I hope this helps!" "Would you like me to..." "Certainly!" "Great question!"
These belong in chat. Strip them from any published writing.

### Metronome rhythm
Every sentence the same length, every paragraph the same number of sentences.
AI text has no texture. Real writing breathes unevenly — short, then longer,
then a fragment, then a sentence that earns its length.

### Title case in headers
AI capitalizes all main words ("Global Context: Critical Mineral Demand").
Use sentence case.

## Anti-overfitting guide

This document captures taste. Apply it with judgment, not as a checklist.

**Frequency guidance:**
- **Hard rule:** Never violate. Banned words, structures, phrases. Absolute.
- **Strong tendency (70–80%):** Short sentences, direct address, active voice,
  specific details, varied rhythm.
- **Light preference (context decides):** Particular word choices, structures,
  or humor placement.

**Domain exceptions:** Words on the banned list are often legitimate technical
terms. "Harness" in an agent harness, "unlock" in threading, "robust" in error
handling — these are fine. See the [domain exceptions table](#important-domain-exceptions)
above for the rule of thumb.

**Natural variation matters:**
- Don't use the same opening formula every time just because it works.
- Don't avoid a word forever just because it's on a ban list (sometimes it's
  genuinely the right word).
- Let the content dictate structure.

**The litmus test, one more time:**

> "Does this sound like something a real person would actually write, or does it
> sound like an AI trying very hard to imitate one?"

If it feels forced, pull back. Inhabit the voice.
