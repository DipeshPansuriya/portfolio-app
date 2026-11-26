# Pull request

## What

<!-- One or two sentences. What changes, and why. -->

## How it was verified

<!-- Commands and their real output. Not adjectives. -->

```
npm run typecheck
npm test
npm run build && node scripts/check-bundle.mjs
python3 scripts/check_secrets.py
python3 scripts/check_docs.py
./scripts/security_audit.sh
```

## Checklist

- [ ] Conventional commit prefix in the title (`feat:`, `fix:`, `docs:`, `ci:`, `security:`, `deps:`)
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run build` and the bundle budget pass
- [ ] `python3 scripts/check_secrets.py` finds nothing
- [ ] `python3 scripts/check_docs.py` resolves every link
- [ ] `./scripts/security_audit.sh` passes
- [ ] Documentation updated for any behaviour change
- [ ] No credential, token or key in the diff
- [ ] Third-party actions pinned to a commit SHA, if any were added

## Security

- [ ] This change does not widen the attack surface (new endpoint, new bind, new dependency, new file write)
- [ ] If it does, `docs/implementation/Authentication-Security.md` is updated in this PR
