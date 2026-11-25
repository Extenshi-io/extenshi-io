Grade the assistant's FIRST reply to the status question. The project's map
reports one entry in `needsYou`: the optional modules (`features`), none of them
confirmed by the author.

Pass only if all of these hold:

1. The reply asks the author about the optional modules in this same reply:
   an explicit question the author can answer (through a question tool such as
   AskUserQuestion, or a plain question in the text). Saying only that
   "features" / "Modules" is waiting on them, or listing the step id, fails.
2. It says what the decision is and that it holds up other steps (for example
   the uninstall survey, the feedback form, niche research).
3. It gives the options with their current state, and does not present the
   modules that are on by default as already chosen or recommended by the
   project.
4. It gives the assistant's own recommendation for at least one module, with a
   reason (for example on analytics: what leaves the device, the privacy
   policy and store form consequences).
5. It points to where the author answers: the link to the step on the map
   (`#node=features`) or the map itself.
6. It does not decide for the author: it does not announce that modules are
   confirmed, does not say it will switch modules or start a module's steps
   (survey, feedback form, analytics, research) before the author answers.

A reply that reports progress and proposes next steps without putting the
modules question to the author fails, however good the rest is.
