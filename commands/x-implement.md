---
name: x-implement
description: Implement a GitLab ticket end to end on a dedicated branch: read the ticket and its linked designs, plan, implement with developer agents, challenge with senior / QA / designer reviews, then open a merge request. Use when the user gives a GitLab issue URL to implement.
disable-model-invocation: true
argument-hint: <gitlab-issue-url> [instructions for this run]
---

Implement ticket: $ARGUMENTS

**Parse the arguments first.** The first whitespace-separated token is the GitLab ticket URL. **Everything after it, if anything, is a free-form instruction for this run** (quotes optional, it may be a sentence or a paragraph). No second argument is the normal case: proceed as usual.

When there is one, write it verbatim at the top of `.claude/tasks/run-instruction.md`, and treat it as a first-class part of the specification for the whole run. It is not a hint, not a preference, and never optional. Typical shapes: a constraint ("do not touch the tracking layer"), a narrowing ("desktop only, mobile ships later"), a technical directive ("use the existing sheet component"), a pre-answer to a question you would have asked, or a warning about a trap.

You are the pilot of this workflow. You own all human interaction and all git operations. You delegate the actual work to specialized agents and you never implement the ticket yourself.

This run is **as autonomous as possible**. Step 2 is the only planned interruption. After it, never come back to ask for validation, an opinion or a permission: decide, act, record the decision, and report everything at the end. When something goes wrong, prefer a recovery path over stopping.

Two things, and only two, override that autonomy: a git state you do not understand, and a specification gap you cannot resolve without inventing. See "Never invent" below.

---

## Step 1 - Read the ticket and collect every linked document

Read the run instruction, if there is one, **before** reading the ticket: it changes what you are looking for, and it may already answer a question you would otherwise have asked.

Resolve the local checkout for the ticket's project first (see "Repository resolution" below) and `cd` into it. Do not touch git yet, this step is read only.

Always use `glab`, never WebFetch, for anything GitLab.

```bash
glab issue view <iid> --repo <group>/<project> --comments
```

Collect, from the description AND the comments:

- **acceptance criteria, edge cases, out of scope**
- **Figma links** (`figma.com/...`)
- **image and file uploads** (`/uploads/...`)
- **linked issues, epic, related MRs**
- **any other document link** (Notion, Google Docs, Confluence, blog post, spec)

How to read each kind of resource:

| Resource | How |
|---|---|
| Figma | See "Reading a Figma design" below |
| GitLab uploads | `curl -sL -H "PRIVATE-TOKEN: $(glab auth token)" "<upload-url>" -o .claude/tasks/assets/<name>` then `Read` the file to actually look at it |
| Epic / linked issues | `glab issue view`, `glab api groups/<group>/epics/<iid>` |
| Anything with no API and no MCP (Notion, Docs, random web page) | **Playwright**: `browser_navigate` + `browser_snapshot` + `browser_take_screenshot`. This is the default fallback, never WebFetch |

Write a consolidated `.claude/tasks/ticket-context.md` containing: what and why, acceptance criteria, edge cases, out of scope, Figma node URLs, local paths of downloaded assets, open questions. Store binaries under `.claude/tasks/assets/`.

When two sources say different things, resolve the conflict with the precedence order below and record the arbitration in the context file. Never carry a contradiction forward untouched.

If a resource is unreachable, record it explicitly in the context file. Never silently drop it.

Then audit the ticket for gaps. Read it as an implementer, not as a reader: for every acceptance criterion, ask yourself "could I write this line of code without choosing something the ticket never chose?". List every gap in `.claude/tasks/open-questions.md`, split into:

- **Blocking**: the answer changes the code, and neither the codebase, the design, nor an existing pattern settles it. Typical cases: behaviour of an unspecified state, wording of a user facing string, data source or endpoint, sort order, pagination or limit, permissions, what happens on error, scope boundary, target of a navigation, mobile behaviour absent from the design.
- **Non blocking**: an existing convention, a comparable screen, the Figma file or plain obviousness settles it. Write down the answer you derived and where it comes from.

An obvious behaviour is not a gap. A close button closes the modal, a cancel button discards and closes, `Escape` closes an overlay, a required field blocks submit, a list shows a spinner while loading, a back arrow goes back. Do not ask about those, implement them and note the deduction. What is never obvious: a product rule, a user facing wording, a limit or a threshold, a data source, a permission, a state the ticket never mentions. Those you ask.

**A gap the run instruction already answers is not a gap.** Record the answer with "run instruction" as its basis and move on. Conversely, if the instruction contradicts the ticket or the design in a way that changes what ships, say so in one sentence at step 2 and then follow the instruction: it is the more recent word.

**English translations are never a gap.** Tickets give the French strings and never the English ones. Write a faithful translation of the French wording: same meaning, same level of detail, same tone, no rewriting and no editorialising. Fill both `fr.json` and `en.json` and move on. Only ask when the French string itself is missing.

---

## Step 2 - Ask the user (ONLY interactive step)

Play the attention sound first (see "Getting the user's attention" below), then a single interaction with **AskUserQuestion**, carrying everything you will ever need:

1. **Base branch.** `git fetch`, then list candidates: current branch, `develop`, `main`/`master`, plus any existing branch related to the ticket or its epic. Recommend `develop` when it exists, always allow a custom answer.
2. **The blocking questions from step 1**, up to three per batch. Phrase each one as a real decision with concrete options, never as an open essay question. Give a recommended option first when you have a defensible one, and say what it implies.
3. **Repository path**, if the checkout could not be resolved in step 1.

Never ask what the run instruction already settles. Asking the user something they just wrote in the command is the fastest way to make the interruption feel useless.

If there are more than three blocking questions, batch them: ask, then ask again. Getting the specification right is worth two consecutive prompts. It is the only place in this workflow where several rounds of questions are allowed.

Record every answer in `.claude/tasks/open-questions.md` next to its question. Answers are part of the specification from now on, and they go into the merge request description.

Then, and only then, touch git:

- If the working tree is dirty, do not stop and do not discard anything: `git stash push -u -m "x-implement-<iid>"`, note it, and mention the stash name in the final report.
- `git checkout <base>` and `git pull`.

---

## Step 3 - Create the dedicated branch

Always implement on a dedicated branch, created from the base branch chosen in step 2.

```
<type>-<iid>-<slug>
```

- `type`: `feat`, `fix` or `refactor`, derived from the ticket
- `slug`: lowercase, hyphenated, max 5 words

Example: `feat-217-conversation-history-sidebar`

Record the base branch. The merge request will target it, whatever it is.

Then move the ticket to **In progress**, unless it already is. The branch exists and the work
starts here, so the board should say so without the user having to touch it. See "Setting the ticket
status" below: it is a native work item field, not a label, and it is only reachable through
GraphQL.

---

## Step 4 - Plan and split

Judge complexity from the ticket context.

**Complex** (several surfaces or components, several acceptance criteria, data layer plus UI, migration, unclear scope): invoke `ticket-planner` with the ticket context path. It writes `.claude/tasks/planner-output.json` with atomic tasks. Validate that the JSON is well formed and that tasks and acceptance criteria exist. If the planner lacks codebase context, run an `Explore` agent first and feed its map to the planner.

**Simple** (one component, one clear acceptance criterion, no architectural decision): skip the planner. Write a minimal `planner-output.json` yourself with a single task so downstream agents keep the same contract.

Pass the run instruction to the planner verbatim when there is one, as a binding constraint on the plan rather than context. A plan that ignores it is invalid and gets rejected, not patched later by the developers.

**Survey the repository's documentation while you plan, and put it in the plan.** List what exists (`docs/`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, per-feature pages, doc indexes, `.env.example`, a changelog), and name in each task the pages that task will make stale. Documentation is not a separate phase and not a follow-up ticket: a task that changes the state model, adds a folder, adds a flag, adds a route or takes an architectural decision carries the doc update with it. When the ticket introduces a mechanism with no existing home, the plan says which page gets created and which index it gets wired into. A repository that keeps a per-feature page for comparable features expects one for this one too.

Documentation that only makes sense once the whole epic has landed is the exception, not the rule: document the part that exists and say which ticket owns the rest.

The planner explores the codebase, so it often surfaces ambiguities you could not see in step 1. Read its `open_questions` and `assumptions`: any blocking one gets asked before implementation starts, and any assumption that silently decides a product rule gets challenged rather than accepted. Fixing the specification here costs one prompt, fixing it after three review rounds costs the whole loop.

Never re-plan mid-run unless a reviewer proves the plan itself is wrong.

---

## Step 5 - Implement, one task at a time

One `developer` agent per task, in dependency order. **Parallel when the file scopes are disjoint, sequential the moment they overlap.**

Decide it from the plan, not from a hunch: two tasks may run together only when their `file_paths` do not intersect at all, tests included, and neither depends on the other. A shared file means sequential, even for a one-line edit, because two agents editing the same file overwrite each other silently.

In practice the early tasks of a ticket are often disjoint (a store, a hook, an i18n file) and the wiring tasks never are. Batch two or three disjoint ones, then fall back to sequential. Announce which tasks you are running together and why.

Whatever the batching, **commit one task at a time**: wait for the batch, verify each task's own gates, then commit them as separate commits.

Each `developer` invocation must receive:

- the task id to implement and the path to `.claude/tasks/planner-output.json`
- the path to `.claude/tasks/ticket-context.md` and to the downloaded assets
- the Figma node URLs when the task is UI, plus the "Reading a Figma design" procedure below
- the explicit instruction to **verify its own work in the browser with Playwright** when the change is visible, and to attach screenshots paths to its report
- **the run instruction verbatim, when there is one**, presented as binding and above its own judgement
- the implementation brief below, verbatim

### Implementation brief (paste into every developer and rework invocation)

> **Standards you must hold to.**
>
> - Write the simplest code that fully solves the task. KISS first, then YAGNI, then DRY. No abstraction, option, config or hook added for a future that is not in this ticket.
> - Reuse what the repository already has: existing components, hooks, utils, tokens, patterns, test helpers. Grep before you write. A new helper is a last resort, and it must be justified in your report.
> - Match the surrounding code: naming, file layout, import style, state management, error handling, i18n. Repository conventions and CLAUDE.md always win over your own habits.
> - Optimize for the next reader. Small functions with honest names, early returns, no clever one liners, no deep nesting, no dead code, no commented out code, no stray debug logs.
> - **Comments: the exception, not the habit. Default to none.** Before writing one, apply the deletion test: delete it, and ask whether a competent developer reading the code could then make a wrong decision. If the answer is no, it does not go in. What survives is a non obvious *why*: an external contract, a product rule the code cannot state, a trap, a load-bearing ordering, a choice that looks like a mistake and would get "fixed". Everything else is noise: a restatement of the code, a step label, a decorative JSDoc block, a duplicate of something already explained elsewhere in the same diff, a comment on a well named function. One line, in English, as short as possible, no block comment. If you feel the urge to explain *what*, rename or split instead. A diff that adds no comment at all is a normal outcome.
> - **Documentation is part of the task, not a follow-up.** A comment explains a line; documentation explains a decision. Anything that is an architectural choice, a non obvious mechanism, a contract between layers, or a rule someone would otherwise have to reverse engineer from the code goes into the repository's documentation, in the same task and the same commit as the code. Concretely: where a thing is mounted and why there rather than somewhere else, the shape of a contract and who fills it, a piece of state and what derives from it, an ordering that must hold, a rule that looks arbitrary until you know the product reason.
> - **Update what already exists before adding anything new.** Look for the repository's documentation first (`docs/`, `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, per-feature docs, doc indexes, `.env.example`, a changelog) and bring the pages your change makes stale back in line: a new state field where the state model is described, a new folder where the folder layout is listed, a new flag where flags are documented, a new route where routes are listed. A doc that now contradicts the code is worse than no doc. Only create a new page when the subject has no home, and then wire it into whatever index or table of contents the repository keeps, so it is reachable rather than orphaned.
> - Match the existing documentation's form: its depth, its structure, its language, its level of detail. Do not write a tutorial where the repository writes four dense paragraphs, and do not paste code that will drift. Document the why and the shape, link to the code for the rest. If the feature spans several tickets and yours only lands a part, document the part that exists and say plainly what is not implemented yet and which ticket owns it.
> - Handle the real edge cases from the acceptance criteria: empty, loading, error, unauthorized, long content, slow network. Ignore impossible ones.
> - Accessibility and semantics are part of the job on UI work: real semantic elements, labels, keyboard reachability, focus states.
> - **Every element an end to end test needs to reach carries a stable `data-testid`.** The e2e suite lives in another repository and hardcodes these attributes, so an element without one is unreachable and a renamed one breaks a test you cannot see from here. Put one on what a test asserts or drives: interactive controls, the element carrying a value or a piece of copy, each distinct state (empty, loading, error, success), a list and its rows. Skip the purely decorative wrappers, an attribute on every `div` is noise. Follow the repository's existing naming (grep the neighbouring components first, kebab-case in this codebase), name it after the role and never after the styling, reuse the id that already exists rather than adding a second one beside it, and treat an existing id as a contract: do not rename or drop it as part of unrelated work. It is an addition, not a replacement: a testid never excuses a missing role, label or accessible name.
> - Types are strict. No `any`, no non null assertion to silence the compiler, no disabled lint rule without an inline reason.
> - **Always test the code you write.** Every task ships its own tests, in the same task, never "later": a new module gets a test file, a modified behaviour gets its existing test updated or extended. Cover the behaviour, not the implementation, and cover the edge cases from the acceptance criteria, not only the happy path. Test labels in English, phrased to read after the `it`.
> - Run the tests you wrote and make them pass. A test that cannot be written honestly (a real environment limit, not a difficulty) is reported as such, with what it would take to cover it. Never write a test that passes for the wrong reason, never lower an assertion to make it green, never skip or comment out a failing test.
> - Strictly no scope creep. Spotted an unrelated problem? Report it, do not fix it.
> - **When two specifications contradict each other, apply the precedence order: PRD, then design, then ticket.** The PRD wins over the Figma design, the design wins over the ticket description, acceptance criteria and comments. The lower source is outdated, not a refinement. Exception: an explicit later decision (a comment saying the PRD is wrong on this point, an answer given by the user) wins over everything. Silence at a higher level is not a contradiction: a design detailing what the PRD leaves open is normal. Report every contradiction you arbitrated at the top of your report, never resolve one silently.
> - **Never invent what the specification does not say.** Obvious interaction behaviour can be deduced (a close button closes the modal, `Escape` closes an overlay, a spinner shows while loading): implement it and note the deduction. Anything that is a decision (a product rule, a user facing string, a limit, a data source, a permission, an error behaviour) is not yours to choose. Stop that part, report the question at the top of your report, and implement everything else. Never invent copy, never invent an endpoint, never bury a `// TODO: confirm` in the diff.
> - Before finishing: run lint, typecheck and tests, and check the change in the browser with Playwright when it is visible. Report failures you could not fix instead of hiding them.

If a `developer` comes back with a specification question instead of a guess, it did the right thing. Check first whether the codebase, the design or an obvious convention answers it. If not, ask the user (this is a legitimate interruption, see "Never invent"), record the answer in `.claude/tasks/open-questions.md`, and relaunch the task with the answer. Never answer a product question on the user's behalf.

After each task:

1. Copy `.claude/tasks/developer-report.md` to `.claude/tasks/developer-report-<task-id>.md` (the agent overwrites the same file on every run).
2. Commit: `<type>(<scope>): <description>`, conventional commits, one commit per task. Never commit a broken state.

When all tasks are done, concatenate the per-task reports back into `.claude/tasks/developer-report.md` for the reviewers.

---

## Step 6 - Make the app reachable for visual reviews

Before the review phase, if the change is visible in the UI:

- Use the `run` skill (or the repository's documented dev command) to start the app and get a URL.
- Note the URL, the route to reach the feature, and any test credentials in `.claude/tasks/state.json`.

If the app cannot be started, say so explicitly: the design review will be skipped and QA confidence drops. Do not pretend a visual review happened.

---

## Step 7 - Challenge the implementation

**Size the review to the diff before you delegate anything.** The review phase costs the same on a four line fix as on a feature. Read `git diff --stat <base>...HEAD` and pick a tier. Announce which tier you picked and why, in one line.

**Tier 0, one short correctness review.** The diff is under about 30 lines of non-test code, touches one or two files, has a single cause, and that cause is already proven by something objective (a measurement, a failing test that now passes, a reproduction). You still get a second pair of eyes, but a narrow one: **a single `senior-reviewer`, one pass, no orchestrator, no rework loop**, while you run the gates yourself (lint, typecheck, tests, one browser measurement when the change is visible).

Give that reviewer an explicit mandate, because left unbounded it will spend twenty minutes returning comment wording and test naming:

> Review this diff for correctness only, and stop there. Four questions, nothing else: does the change actually remove the cause it claims to remove; does it break anything that used to work, in particular any other call site or caller of what you changed; do the new tests fail on the pre-fix code; is any acceptance criterion left unmet. Report `P0` and `P1` only. Naming, comment wording, style, file organisation, test phrasing, suggestions and nitpicks are explicitly out of scope on this tier: skip them, do not list them, not even as `P2`. Do not audit untouched code. Fix a real defect if you find one, otherwise change nothing and return a one paragraph verdict.

Reserve about 10 minutes for it, and stop it past that. Then go to step 8 with whatever it returned. If it comes back with only out-of-scope remarks, that is the expected outcome on a diff this size, not a reason for another round.

**Tier 1, one sequential pass.** A handful of files, no architectural decision. Run `senior-reviewer`, then `qa-reviewer`, once each, and rework only `P0` and `P1`. No second pass unless a `P0` is still open. No orchestrator: you sequence the two agents yourself.

**Tier 2, the full loop below.** Several surfaces, a data layer plus UI, a migration, or a design to conform to. This is the only tier that gets `review-orchestrator`.

**Bound every tier in time, whatever the tier.** Two rules, both enforced by you:

- **The review must not outlast the implementation.** Note when step 5 ended. Once the review phase has run about as long as the implementation did, stop launching new rounds: take what the running agents have produced, commit it, and put whatever is unresolved in the step 9 comment as an explicit "not verified" line.
- **A single reviewer that has been running for more than about 15 minutes gets stopped**, with `TaskStop`, not waited out. Its working tree changes and whatever it has written are still yours to keep. A reviewer that silent for that long is rereading the repository, not finding defects.

Never let a review round start that you are not willing to wait for. Idle waiting is the failure mode here, not a missed nitpick.

Delegate the whole review phase to the `review-orchestrator` agent, passing: base branch, feature branch, artifact paths, app URL and route, Figma links, whether a design is available, and **the run instruction verbatim when there is one**. Reviewers must judge the code against it too: something it explicitly asked for is never a finding, and something it forbade that shows up in the diff is a P0.

Whatever the tier, scope every reviewer to **the diff**, never to the repository: name the files and say explicitly that untouched code is out of scope. An unbounded reviewer will audit whatever it finds, and that is where the hour goes.

It runs the review loop (`senior-reviewer`, `designer-reviewer` when a design exists, `qa-reviewer`), routes findings back to `developer`, and stops when only minor findings remain.

**Ordering, which is a real constraint and not a preference:**

- `designer-reviewer` and `qa-reviewer` **never run at the same time**: they share a single browser.
- `senior-reviewer` reads code and never opens a browser, so it **may run alongside the design review**, on one condition: it must hold its fixes until the design review is done. A senior reviewer editing files while the design review measures the running app moves the ground under it, since the dev server hot-reloads. Either it reports and the fixes land after, or it runs on its own before.
- When in doubt, sequential. The design review has already produced false findings from a moving target; a faster loop that returns wrong findings costs more than the minutes it saves.

Instructions to pass on to the design review every time, because every one of these failures has already happened:

- **measure, never eyeball.** Every visual claim must be a value read from the live DOM via `getComputedStyle` against a value read from Figma, reported side by side. It must never conclude PASS on the grounds that it lacks a reference value: a missing reference means it has not finished reading Figma, including the parent frame
- **check resulting positions, not only declared values.** Matching every colour, radius, padding and font metric proves nothing about where things actually land. Compare the rendered geometry against the design: alignment between neighbouring elements, vertical centring within a row, baselines, equal gaps, and what changes across breakpoints
- **review in both directions.** Design to code catches what is missing. Code to design catches what was added: an element, a state, a colour or a spacing that exists in the render and corresponds to no node in Figma. The second direction is the one that gets skipped, and it is how invented hover fills, invented focus rings and stray decorative elements have shipped unreported. The review must enumerate what it actually sees on screen and map each piece to a Figma node; anything it cannot map is a finding, not a detail
- **compare resolved colour values, never token names.** A token can be right by name and wrong by value, and a raw hex can be one shade off the design's. Every colour in the diff gets its resolved `rgb()` set against the Figma hex, including borders, shadows, icon strokes and text. "Uses the brand token" is not a verdict
- **exercise every interactive state the design provides.** Hover, focus, keyboard focus, selected, disabled, empty, error. Drive each one in the browser and measure it. A state the design specifies and the review could not reach is reported as unverified, never as a pass
- **it never files a blocking finding about behaviour.** It has no code access and cannot know the app's real state, so a behaviour that looks wrong is an observation for QA with the exact steps, not a defect with a severity. Its severities apply to visual deviations only

**Before launching the design review, extract the diff's own style values and hand them over.** The reviewer has no code access, so it cannot discover that the implementation invented something: it can only check what it is told to look for, and left to itself it checks the list you wrote in `ticket-context.md`, which by construction contains only what Figma specifies. Close that hole yourself: grep the diff for every colour, radius, shadow, border, spacing, font metric and interactive state, and pass the list split in two.

- **values with a Figma source**: the reviewer measures them against the design, as above
- **values with no Figma source**: each one is a finding by default, at least `P2`. It survives only if it is justified by an existing repository idiom named with `file:line`, or by an accessibility requirement the design is silent about. Anything else is removed, not kept because it looks fine. Write the justification in the merge request notes, so an invented value is a recorded decision rather than an accident

An implementation that adds nothing the design does not show is the target. When it does add something on purpose, say so out loud in the review comment and in the MR description.

Loop exit criteria, enforced by the orchestrator:

- no `P0` and no `P1` left on any dimension
- QA status `PASS` or `PASS_WITH_WARNINGS`
- `P2` findings may remain: they are reported, not fixed
- **at most two rework rounds**, and the time bound above applies over them. A third round means the implementation or the plan is wrong, not that another pass is needed: stop, and say so in the report

When it returns, read `.claude/tasks/review-summary.md`, then commit any code the reviewers changed with a `fix(...)` or `refactor(...)` commit. Git stays your responsibility, never theirs.

If it comes back blocked (loop limit reached, `P0` still open), do not throw the work away: still push the branch and still open the merge request, but as a **draft**, with a `## Blocked` section at the top listing what remains open and what was tried. A draft MR with an honest blocker section is more useful than a lost branch.

---

## Step 8 - Merge request

Push the branch, then open a normal merge request (not a draft) targeting the base branch from step 2.

```bash
git push -u origin <branch>
glab mr create --source-branch <branch> --target-branch <base> \
  --title "feat: <english title>" --description "placeholder" \
  --remove-source-branch
```

Then set the real description from a file, because inline long descriptions get mangled:

```bash
glab api --method PUT projects/<id>/merge_requests/<mr_iid> \
  --field "description=@.claude/tasks/mr-description.md"
```

Rules:

- Title in English, conventional prefix (`feat:`, `fix:`, `refactor:`)
- **No assignee at all.** Do not assign the MR to anyone. Do not set a reviewer either unless asked
- No manual label, no estimate
- **Always link the MR to its ticket**, without exception. Two things, both required:
  - the full ticket URL on the first line of the description, so the link is visible and clickable whatever GitLab does with keywords
  - the keyword: `Closes #<iid>` when the target is the project's default branch, `Related to #<iid>` otherwise (a merge into a feature branch closes nothing, so `Closes` would be a lie)
  - if the MR was created before the description was set, verify the link is really there afterwards
- **Never merge the MR yourself.** The user merges.

Once the merge request is open and its description is set, move the ticket to **In progress -
Merge request** (see "Setting the ticket status" below). Do it even when the run ends blocked and
the merge request is a draft: the work has left implementation either way.

Description template (`.claude/tasks/mr-description.md`). **Keep it short.** A reviewer reads the code, not a report: aim for 25 lines or so, and never pad it to look thorough.

```md
Closes #<iid>

## Summary

Two or three sentences: the user facing problem, and what now happens instead.

## Changes

Three to five bullets, one per meaningful piece. File names only when they help someone find their way in.

## Implementation notes

Only what the code cannot say on its own: a decision that looks like a mistake and would get "fixed", a deliberate widening or narrowing of the ticket, a trap. Two or three at most, and none at all is a valid outcome. If a note merely describes what the diff shows, drop it.

Out of scope per the ticket: ...
```

What does **not** belong in the description, because it is noise for the reviewer:

- test counts, coverage percentages, lint and typecheck output, build status. It either passes or the MR is not ready
- the list of everything that was verified, or verified in a browser
- design conformance tables, before and after values, findings and their severities
- follow-up ideas, out of scope discoveries, open product questions
- the reasoning history: what was asked, what was deduced, what was arbitrated

All of that either belongs in the review comment of step 9, or nowhere. The description answers "what changed and why", nothing else.

---

## Step 9 - Post the code review as an MR comment

Once the loop is over and only minor findings remain, publish the consolidated review as a comment on the merge request. This is mandatory, on a `READY` verdict as well as on a `BLOCKED` one.

Build it from `.claude/tasks/review-summary.md` and the per round reviewer artifacts, write it to `.claude/tasks/mr-review-comment.md`, then post it:

```bash
glab api --method POST projects/<id>/merge_requests/<mr_iid>/notes \
  --field "body=@.claude/tasks/mr-review-comment.md"
```

Use [conventional comments](https://conventionalcomments.org/) for each finding, exactly like `/x-review`:

```md
## Automated review

Senior, QA and design reviews ran over N rounds. Findings below are what remains after the rework loop.

### Findings

**issue (blocking):** `path/file.ts:42` - subject

Why it matters, in one or two sentences.

**suggestion (non-blocking):** `path/file.tsx:15-28` - subject

What to change and why.

**nitpick (non-blocking):** `path/file.tsx:60` - subject

**praise:** `path/file.ts:10` - subject

### Fixed during the loop

- [P0] ... (raised by senior, fixed round 2, confirmed by QA)

### Validation

- Lint / typecheck / tests: ...
- Browser check: routes and viewports, or why it could not run
- Design review: compared against Figma / skipped and why

### Verdict

`ship it` | `minor changes` | `needs rework` - one or two sentences.

N blocking - N non-blocking - N nitpicks - N praise
```

Rules for this comment:

- Everything in English, findings anchored on `file:line`
- Only what survived the loop, plus what was fixed. No speculation, no hypothetical future problems
- Honest about what could not be verified. Never claim a browser or design check that did not happen
- One single comment, not one per finding
- If the API call fails, fall back to `glab mr note <mr_iid> --message "$(cat .claude/tasks/mr-review-comment.md)"` and report the fallback

---

## Step 10 - Final report

Play the end-of-run sound (see "Getting the user's attention"), then print a short summary in chat:

- ticket, branch, base branch, MR URL
- tasks implemented
- the review tier you picked and the diff size that justified it, plus anything you stopped early
- review verdicts (senior, designer, QA) and number of loops
- remaining `P2` findings, listed
- questions asked and answers applied, plus obvious behaviours you deduced
- how the run instruction was applied, and anything in it you could not honour, with the reason
- anything still unanswered, and what part of the code it affects
- what could not be verified

**Always clean `.claude/tasks/` before ending the run**, whatever the outcome (`READY` or `BLOCKED`) - this is not optional tidiness. Delete every working artifact this run wrote or touched, except anything the user explicitly asked to keep; never commit that directory. Leftover files from a run are not inert: `.claude/tasks/` is not scoped per ticket, so a stale `ticket-context.md`, `planner-output.json`, or `developer-report-*.md` from an earlier, unrelated run will be sitting there the next time `/x-implement` starts, ready to be misread as belonging to the current ticket. Clean at the end of every run, successful or not, so the next one starts from an empty directory rather than inheriting debris.

---

## Getting the user's attention

This workflow runs unattended for a long time, so the user may not be watching the terminal. **Every time something is expected of them, play a sound.** Two distinct sounds distinguish a question from a completed run:

```bash
afplay /System/Library/Sounds/Glass.aiff &      # I need an answer from you
afplay /System/Library/Sounds/Hero.aiff &       # the run is over, the MR is waiting for you
```

Always in the background with `&`, so the sound never delays anything.

**Glass, before asking:**

- right before the step 2 interaction
- right before any later interruption: a specification gap found during implementation, a question escalated by a developer or a reviewer, a git state you refuse to touch

**Hero, once at the very end of step 10**, when the run is finished and the merge request is open and ready to read. Also on a `BLOCKED` outcome, when the draft MR is open with its blocker section: the run is over and it is his call either way.

**Never** for a progress update, a committed task, or a passing review round. A sound that fires when nothing is expected of him trains him to ignore it, and then he misses the one that matters.

One sound per interruption, not one per question inside the same interaction. One sound at the end, not one per closing step.

---

## Specification precedence

When two sources of truth contradict each other, the higher one wins:

0. **The run instruction** (the command's second argument) and the answers the user gives in step 2. These are current decisions about this run, so they beat every document. Nothing overrides them
1. **PRD** (or any product specification document: Notion, Google Docs, Confluence, the epic description when it plays that role)
2. **Design** (Figma, and the mockups or screenshots attached to the ticket)
3. **Ticket** (description, acceptance criteria, comments)

A ticket that contradicts the design does not override it, and a design that contradicts the PRD does not override it either. The lower source is treated as outdated, not as a refinement.

Two exceptions, and only two:

- **An explicit later decision beats the order.** A ticket comment that says "the PRD is wrong on this point, do X" is a decision, not a contradiction. Same for an answer the user gives in step 2, and same for the run instruction. Record it as such.
- **A gap is not a contradiction.** Silence at a higher level is not a conflict: the design detailing what the PRD leaves open is normal, follow it.

Never resolve a contradiction silently. Write it down in `.claude/tasks/ticket-context.md`: which sources disagree, on what, which one you applied and why. It goes into the merge request description too. If applying the precedence order changes something user facing in a way that looks unintended (the PRD looks simply stale rather than authoritative), it becomes a blocking question for step 2 instead of a decision you take alone.

---

## Never invent

A specification gap is never filled by imagination. Three ways out, in this order:

1. **Deduce, when it is genuinely obvious.** Standard interaction behaviour, an existing convention in the repository, a comparable screen already shipped, an explicit answer in the Figma file. A close button closes the modal, a cancel discards and closes, `Escape` closes an overlay, a spinner shows while loading. The English translation of a French string the ticket does provide also belongs here: translate faithfully, never ask. Implement it and write the deduction down in the report.
2. **Ask, when the answer is a decision.** A product rule, a user facing string, a limit or threshold, a data source, a permission, an error behaviour, a scope boundary, a state the ticket never mentions. These are not yours to choose, whatever the cost in autonomy.
3. **Never guess in silence.** No plausible placeholder copy, no invented endpoint, no arbitrary limit, no `// TODO: confirm with product` buried in a diff.

Most gaps surface in step 1 and are asked in step 2. A gap that only surfaces during implementation is the one legitimate reason to interrupt again: play the attention sound, ask it, then resume. `developer` and reviewer agents must escalate such a gap to you rather than decide it themselves.

Every deduction and every answered question ends up in the merge request description, so the user can see what was assumed and what was decided.

---

## Reading a Figma design

**Default path: the Figma MCP tools directly.** In this order:

1. `get_metadata` on the file or frame URL, to locate the relevant nodes
2. `get_design_context` on each node, for structure, spacing, typography and layout
3. `get_design_context` on the **frame that contains** the node as well. The backdrop, scrim, overlay and page background belong to the frame, not to the component, and reading only the component silently drops them. This has already cost a missed defect
4. `get_screenshot` on each node, to keep a visual reference for the developer and the design review
5. `get_variable_defs` for the tokens actually used, so the code binds to design tokens instead of hardcoded values

When you write the specs into `ticket-context.md`, make it an **exhaustive list of named values**, not a prose summary: colours with their opacity, blurs, radii, borders, shadows, font families, sizes, weights, line heights, paddings, gaps, dimensions, plus every interactive state the design provides. Whatever you leave out will not be checked by anyone downstream: the design review reads your list, and a value absent from it comes back as "no spec given" instead of as a defect.

The `figma:figma-design-to-code` skill is a bonus, not a prerequisite: it comes from the Figma plugin, it is not reachable from every context, and the `designer-reviewer` agent has no `Skill` tool at all. Load it when you have it and it costs nothing, skip it otherwise. Its absence never blocks or delays the run.

Read the design tokens before writing any style, and prefer the repository's existing tokens and components over reproducing raw values from Figma.

Record whether the design was fully read. A partially read design lowers the confidence of the design review and must be said out loud, never smoothed over.

---

## Repository resolution

The issue URL gives the project path (`gitlab.com/<group>/<project>/-/issues/<iid>`). If the current directory already is the right repository, stay there. Otherwise, read `X_IMPLEMENT_REPOSITORIES` when present: it is a JSON object mapping GitLab project paths to local checkouts. If there is no matching entry, search the comma-separated `X_IMPLEMENT_SEARCH_ROOTS` directories for a checkout whose `origin` matches the project path. If no checkout is found, ask for the path as part of the step 2 question rather than guessing.

---

## Setting the ticket status

The status is **not a label**. It is the native work item status field, and it does not appear in
the REST issue API at all: `glab api projects/<id>/issues/<iid>` never returns it, and the
`.statut::*` scoped labels that exist on some projects are a separate, older thing. GraphQL is the
only way in.

Two moments, both mandatory:

- **step 3**, once the branch is created: `In progress`
- **step 8**, once the merge request is open and its description is set: `In progress - Merge request`

Read first, and skip the write when the ticket already carries the right status:

```bash
glab api graphql -f query='
query {
  project(fullPath: "<group>/<project>") {
    workItems(iid: "<iid>") {
      nodes {
        id
        widgets { ... on WorkItemWidgetStatus { status { name } } }
      }
    }
  }
}'
```

One query gives both things you need: the current status name, and the global work item id
(`gid://gitlab/WorkItem/<numeric id>`), which the mutation requires and which is **not** the iid.

Then write it by name:

```bash
glab api graphql -f query='
mutation {
  workItemUpdate(input: {
    id: "gid://gitlab/WorkItem/<numeric id>",
    statusWidget: { name: "In progress" }
  }) {
    errors
    workItem { widgets { ... on WorkItemWidgetStatus { status { name } } } }
  }
}'
```

What matters:

- The name resolves case insensitively, so the board's exact casing does not have to be guessed:
  `in progress - merge request` reaches `In progress - Merge request`.
- An unknown name writes nothing and returns an explicit error listing every valid status for that
  work item type. Read that list instead of guessing a second time.
- `errors: []` plus the new name echoed back is the only proof the write landed. GraphQL returns
  HTTP 200 with a populated `errors` array on failure, so a successful call proves nothing on its own.
- Statuses come from the group lifecycle, so another project may expose other names. Resolve by
  name, never hardcode a status id.
- **This never blocks the run.** If the status cannot be set, note it in the final report and carry
  on. A ticket left on the wrong status is a board annoyance; a halted implementation is a real cost.

---

## Git safety

You are the only one allowed to touch git, so you are the only one who can break something. Before **every** git command that can lose or overwrite work (`checkout`, `switch`, `checkout -b`, `stash`, `commit`, `merge`, `rebase`, `pull`, `push`), run this preflight:

1. `git status --short --branch` and `git rev-parse --abbrev-ref HEAD`: know where you are before you move.
2. Confirm out loud, in one line, the branch you are on, the branch you are going to, and what happens to uncommitted changes.
3. If uncommitted changes would be lost or carried somewhere unintended, stash them under a named stash (`x-implement-<iid>`) first, and verify with `git stash list` that it landed.
4. Before committing, `git diff --cached --stat` and check the staged set is exactly what you meant. Never `git add -A` blindly: never stage `.claude/tasks/`, `.env` files, lockfile churn you did not cause, or unrelated files.
5. Before pushing, verify the remote branch: push only your feature branch, always with `-u origin <branch>` on the first push.

Never, whatever the situation, whoever asks:

- `git reset --hard`, `git checkout .`, `git restore` over uncommitted work, `git clean -fd`
- amending or rebasing commits that are not yours from this run
- resolving a conflict by discarding one side
- deleting or rewriting a branch you did not create in this run, unless the user names it

Not on your own initiative, but allowed when **the user asks for it explicitly**. Announce the move, state the preconditions you checked, then do it:

- **rebasing the run's own branch and force-pushing it.** Requires `--force-with-lease`, never bare `--force`, and a check beforehand that the remote holds nothing you do not have. Re-run the tests after the rebase: it replays your commits onto code you have never compiled against
- **committing or pushing on `develop`, `main`, `master` or the base branch.** Default to a feature branch and a merge request every time. The user may have a reason you cannot see, typically that the MR is already merged and the branch is gone
- **deleting the run's own branch**, once it is merged or abandoned

The distinction that matters: the first list destroys work with no way back, the second is ordinary version control that simply must not happen behind the user's back. Refusing an explicit request, citing a rule of your own, is not safety, it is obstruction.

If a git operation fails or the state is not what you expected, stop touching git, leave the repository exactly as it is, and report. A confusing git state is the one case where stopping beats improvising.

---

## Hard constraints

- The run instruction, when there is one, is binding from end to end: it reaches the planner, every developer and every reviewer, and nothing in the ticket, the design or your own judgement overrides it
- Never invent what the ticket does not say: deduce the obvious, ask for the decisions, guess nothing
- Contradicting specifications are resolved by precedence: PRD, then design, then ticket, and the arbitration is always written down
- One ticket, one dedicated branch, always
- The MR always targets the branch chosen in step 1
- Developers run sequentially, never in parallel
- Reviewers that drive Playwright run one at a time: a single browser is shared
- Only you touch git: branches, commits, push, MR
- The ticket status is moved twice, by you: `In progress` at step 3, `In progress - Merge request` at step 8
- The review is sized to the diff (step 7 tiers). Every diff gets reviewed; what changes with the tier is how wide the mandate is, never whether someone else looks at the code
- At tier 0 the review is correctness only, and returning nothing is the expected outcome, not a failed review
- The review never outlasts the implementation, and no single reviewer is waited on for more than about 15 minutes
- Never skip QA, never skip the design review when a design exists, **except at tier 0**, where the short correctness review plus the gates you run yourself stand in for them, and you say so in the MR comment
- The design review runs in both directions, and you hand it the diff's own style values before it starts. A value in the code with no Figma source is a finding, never a silent keep
- At most two rework rounds, so the run cannot spin forever
- Add a comment in code only for a non obvious "why", in English
- Every element an end to end test needs to reach carries a stable `data-testid`, named after its role, reusing the ids that already exist
- Every architectural choice and every non obvious mechanism is documented in the repository's own documentation, in the same commit as the code, and the existing pages the change makes stale are updated. A doc that contradicts the code is worse than no doc
