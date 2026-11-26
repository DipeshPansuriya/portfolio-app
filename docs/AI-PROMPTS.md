# portfolio: AI prompt library

**Date:** 2026-11-26  **Status:** Current

Prompts for studying this repository with an AI coding assistant. The app itself has **no AI features**: no model
calls, embeddings or vector search at run time. Rules for assistants: [contributor and agent guide](AGENTS.md).

## Ground rule (put it first in every session)

```text
Work only from files in this repository. Give file:line for every claim. If you cannot find something, say
"not found". Mark anything you did not check as UNVERIFIED. Do not read .env or data/. Do not install, push or
deploy anything.
```

## Prompts

| ID | Goal | Prompt | Where the answer already lives |
|---|---|---|---|
| P1 | Overview | "Explain what this project does, who uses it and its three main parts." | [README](../README.md), [PRD](PRD.md) |
| P2 | Stack | "List each technology, its version from package.json or the Dockerfile, and why it is used." | [Architecture](ARCHITECTURE.md) |
| P3 | Folders | "Draw the folder tree and say what each folder owns." | [Project summary](Project_Summary.md) |
| P4 | Run | "Give the exact steps to run a fresh clone, with variable names only." | [Setup](implementation/Setup-Initialisation.md) |
| P5 | Write path | "Trace PUT /api/content from request to stored revision." | [Project summary](Project_Summary.md) |
| P6 | Read path | "Trace a visitor's request for /, including the server-rendered hero." | [Architecture](ARCHITECTURE.md) |
| P7 | API | "List every endpoint with method, auth, body and error codes." | [API](API.md) |
| P8 | Data | "Describe every table and the shape of the content document." | [Database](DATABASE.md) |
| P9 | Security | "List the controls on sign-in and on writes, and the stated limits." | [Authentication and security](implementation/Authentication-Security.md) |
| P10 | Delivery | "Explain the eight CI gates and what the pipeline does after them." | [deploy guide](../deploy/README.md) |
| P11 | Failure | "What happens if the database, the 3D files or the server shell fail?" | [Architecture](ARCHITECTURE.md), [PRD](PRD.md) |
| P12 | Change plan | "Plan a change: files, tests, documents, risks. Do not write code yet." | [Features](implementation/Feature-Development.md) |

## Not applicable

Search engines, caches such as Redis, local models and embeddings are not used here.

## Check an answer

- [ ] Every claim has `file:line`
- [ ] Nothing invented to fill a gap
- [ ] Matches the current commit
