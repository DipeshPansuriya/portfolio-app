# Changelog

All notable changes to this project. The version in `package.json` is 1.0.0. **No release is tagged or deployed
yet.** The public repository starts from a single clean commit, so earlier history is summarised here.

## 1.0.0 (unreleased)

### Added

- Reading mode and the 3D drive circuit with gates, timed lap, best time, keyboard and touch controls.
- `/admin` editor: sign-in, content tabs, raw JSON, history with restore, password change.
- Content stored in the database: newest valid revision is live; seed file for an empty database.
- Production guards, readiness endpoint, server-rendered hero for fast first paint.
- Page title, share title, structured data and no-script note filled from the live content; optional search and
  share descriptions.
- Container image, server stack, nightly database dump and restore test, deploy with rollback and undo.
- Eight CI gates, size budgets, Jenkins pipeline (not active).
- Repository safety: secret scanner, git hooks, security audit, GitHub workflows, Dependabot configuration, issue and
  pull request templates, settings script.
- Documentation set, licence, security policy, contributing guide and code of conduct.
- Licence texts for the bundled fonts in `public/fonts/`.

### Changed

- Navigation uses a menu below 1024 px, below 1280 px with seven or eight chapters, and at every width with more.
- Contact buttons stay when the `contact` chapter is renamed: the last chapter shows them.
- The tech ring icon size follows each item's level.
- Stats fill their rows for any count; item numbers always have two digits.
- History always lists the first revision.
- Saves have length limits per field.

### Fixed

- Small screens: mobile menu scrolling, drive buttons, intro and finish cards, gate card against the drive pad,
  notice position, admin chapter rows and sliders.
- Admin errors are linked to their fields.
- A save from an older revision is refused instead of overwriting newer edits.
- A social link with a non-text handle is refused instead of breaking the public page.
- An invalid stored revision is not served, and restoring a damaged one is refused.
- A failed deploy undo can be run again.

### Security

- Cap on parallel password hashing; sign-in limits that do not let a stranger lock the owner out from another
  address. Known limitation: a new browser may get 503 during a sustained flood of sign-in attempts.
- No personal defaults built into the first start or password reset.
- Read-only database role for backups.
- Repository protection tightened: the secret scanner catches more password, token and key shapes and skips no
  folder, file type or size; installed hooks also run on branches without them and check the committed tree before a push;
  release tags are set to be immovable; only the comment job of the review workflow can write; the settings check
  compares more of each ruleset. Not yet applied or run on GitHub.
