/** Repository guards: secret scanner, git hooks, GitHub rulesets and the review workflow. */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('..', import.meta.url))
const missing = ['python3', 'bash', 'git'].filter((name) => spawnSync(name, ['--version']).status !== 0)
const skip = missing.length > 0 && `not available: ${missing.join(', ')}`
const made = []
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

// Nothing from this machine's git settings, and no real repository, may be reached.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')))
Object.assign(env, {
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
})

function run(cwd, command, args = [], input) {
  const done = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', maxBuffer: 1 << 26 })
  return { status: done.status, out: `${done.stdout}${done.stderr}` }
}
function git(cwd, ...args) {
  const done = run(cwd, 'git', args)
  assert.equal(done.status, 0, `git ${args.join(' ')}: ${done.out}`)
  return done.out.trim()
}
function put(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}
/** A throwaway repository holding only the guard files. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'portfolio-guards-'))
  made.push(dir)
  git(dir, 'init', '--quiet', '--initial-branch=main')
  for (const path of ['scripts/check_secrets.py', 'scripts/install_hooks.sh', '.githooks/pre-commit', '.githooks/pre-push']) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    copyFileSync(join(source, path), join(dir, path))
    run(dir, 'chmod', ['+x', path])
  }
  return dir
}
const commit = (dir, message = 'c') => {
  git(dir, 'add', '--all', '--force')
  git(dir, 'commit', '--quiet', '--no-verify', '--allow-empty', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}
const scan = (dir, args = [], from = '.') => run(join(dir, from), 'python3', ['-B', join(dir, 'scripts/check_secrets.py'), ...args])

// Assembled at run time, so this file holds nothing the scanner would report.
const word = ['Zq7m', 'Kp2v', 'R9tw'].join('')
const token = ['gh', 'p_', 'a1B2'.repeat(9)].join('')
const keyLine = (kind) => `${'-'.repeat(5)}BEGIN ${kind}${'-'.repeat(5)}`
const set = (name, value, sign = '=') => `${name}${sign}${value}`

/** Stage one file alone and scan it. */
function verdict(path, text) {
  const dir = repo()
  commit(dir)
  put(dir, path, `${text}\n`)
  git(dir, 'add', '--force', path)
  return scan(dir, ['--staged'])
}
function blocks(path, text, rule) {
  const done = verdict(path, text)
  assert.equal(done.status, 1, `passed, but must block: ${path}: ${text.replace(word, '<value>')}`)
  if (rule) assert.match(done.out, new RegExp(rule))
  for (const secret of [word, token]) assert.ok(!done.out.includes(secret), 'the value was printed')
}

test('secret shapes: YAML, env lines and private key blocks are blocked', { skip }, () => {
  for (const [path, text] of [
    ['config.yml', set('password', word, ': ')],
    ['config.yaml', set('  api_key', `'${word}'`, ': ')],
    ['compose.yaml', set('      POSTGRES_PASSWORD', word, ': ')],
    ['compose.yaml', set('      POSTGRES_PASSWORD', `"${word}"  # prod`, ': ')],
    ['compose.yaml', set('      - POSTGRES_PASSWORD', word)],
    ['compose.yaml', set('  DB_PASSWORD', `\${DB_PASSWORD:-${word}}`, ': ')],
    ['app.conf', set('DB_PASS', word)],
    ['app.conf', set('SMTP_PWD', word)],
    ['app.conf', set('DB_PASSWORD', `${word.slice(0, 4)}$${word.slice(4)}`)],
    ['app.conf', set('DB_PASSWORD', `${word} # prod`)],
    ['app.conf', set('API_KEY', word)],
    ['app.conf', set('DB_PASSWORD', `$${word}`)],
    ['app.conf', set('export STRIPE_APIKEY', `"${word}"`)],
    ['app.conf', set('AWS_SECRET_ACCESS_KEY', word)],
    ['run.sh', set('ADMIN_PASSWORD', `${word} node server.mjs`)],
    ['Dockerfile', set('ENV DB_PASSWORD', word)],
  ]) blocks(path, text)
  for (const kind of ['PRIVATE KEY', 'RSA PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'OPENSSH PRIVATE KEY', 'PGP PRIVATE KEY BLOCK']) {
    blocks('notes.txt', keyLine(kind), 'SEC-013')
  }
})

test('secret shapes: references, placeholders and ordinary code stay allowed', { skip }, () => {
  const lines = {
    'run.sh': [
      'PASS=0; FAIL=0; WARN=0',
      set('ADMIN_PASSWORD', '"Ci1-$(random_hex)"'),
      set('POSTGRES_PASSWORD', `"$(node -p "require('node:crypto').randomBytes(24).toString('hex')")"`),
      set('  PGPASSWORD', `"$(sed -n 's/^DB_PASSWORD=//p' .env)" \\`),
      set('ADMIN_PASSWORD', '$admin_password'),
      set('DB_PASSWORD', '"${DB_PASSWORD:?set DB_PASSWORD}"'),
      set('API_TOKEN', '"${API_TOKEN:-}"'),
      set('OLDPWD', '/somewhere/long/enough'),
      set('BYPASS', 'enabled-for-all'),
      set('API_KEY', '<your key here>'),
      set('DB_PASSWORD', 'change_me_please'),
      set('DB_PASSWORD', ''),
    ],
    'ci.yml': [
      set('  ADMIN_PASSWORD', '${ADMIN_PASSWORD:-}', ': '),
      set('  POSTGRES_PASSWORD', '${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}', ': '),
      set('  GITHUB_TOKEN', '${{ secrets.GITHUB_TOKEN }}', ': '),
      set('  id-token', 'write', ': '),
      set('  bypass', 'everything', ': '),
      set('  token', 'the token that the caller provides', ': '),
      set('  password', '<chosen at deploy time>', ': '),
      set('  POSTGRES_PASSWORD_FILE', '/run/secrets/database', ': '),
    ],
    'types.ts': [set('  password', 'string', ': '), set('  token', 'session.token,', ': ')],
  }
  for (const [path, text] of Object.entries(lines)) {
    for (const line of text) {
      const done = verdict(path, line)
      assert.equal(done.status, 0, `false positive: ${path}: ${line}\n${done.out}`)
    }
  }
})

test('large files are scanned, not skipped', { skip }, () => {
  const text = `${'filler text\n'.repeat(200_000)}${token}`
  assert.ok(text.length > 2.2 * 1024 * 1024)
  blocks('big.txt', text, 'SEC-001')
  const dir = repo()
  put(dir, 'big.txt', text)
  const sha = commit(dir)
  for (const args of [[], ['--all-history'], ['--range', sha], ['--tree', sha]]) assert.equal(scan(dir, args).status, 1, args.join(' '))
})

test('a type change is scanned and syntax-checked', { skip }, () => {
  const dir = repo()
  symlinkSync('elsewhere', join(dir, 'link.txt'))
  symlinkSync('elsewhere', join(dir, 'link.mjs'))
  commit(dir)
  unlinkSync(join(dir, 'link.txt'))
  put(dir, 'link.txt', `${token}\n`)
  git(dir, 'add', 'link.txt')
  assert.match(git(dir, 'diff', '--cached', '--name-status'), /^T\tlink\.txt/m)
  const done = scan(dir, ['--staged'])
  assert.equal(done.status, 1, done.out)
  git(dir, 'reset', '--quiet', '--hard')
  unlinkSync(join(dir, 'link.mjs'))
  put(dir, 'link.mjs', 'const = broken(\n')
  git(dir, 'add', 'link.mjs')
  const hook = run(dir, 'bash', ['.githooks/pre-commit'])
  assert.equal(hook.status, 1, hook.out)
  assert.match(hook.out, /link\.mjs has a syntax error/)
})

test('a scan started in a subfolder covers the whole repository', { skip }, () => {
  const dir = repo()
  put(dir, 'top.txt', `${token}\n`)
  const sha = commit(dir)
  for (const args of [[], ['--all-history'], ['--tree', sha]]) {
    const done = scan(dir, args, 'scripts')
    assert.equal(done.status, 1, `${args.join(' ')}: ${done.out}`)
    assert.match(done.out, /top\.txt:1/)
  }
  put(dir, 'staged.txt', `${token}\n`)
  git(dir, 'add', 'staged.txt')
  assert.equal(scan(dir, ['--staged'], 'scripts').status, 1)
})

test('range and history scans check every path of a blob', { skip }, () => {
  const dir = repo()
  const base = commit(dir)
  // Same content, so one blob; the harmless name sorts first.
  put(dir, 'a.txt', 'same content\n')
  put(dir, 'z.pem', 'same content\n')
  commit(dir)
  // A later commit gives an old blob a forbidden name.
  put(dir, 'later/prod.key', 'same content\n')
  commit(dir)
  rmSync(join(dir, 'z.pem'))
  rmSync(join(dir, 'later'), { recursive: true })
  const head = commit(dir)
  for (const args of [['--all-history'], ['--range', `${base}..${head}`], ['--range', head]]) {
    const done = scan(dir, args)
    assert.equal(done.status, 1, `${args.join(' ')}: ${done.out}`)
    assert.match(done.out, /z\.pem/)
    assert.match(done.out, /later\/prod\.key/)
  }
  assert.equal(scan(dir).status, 0, 'the tree no longer holds them')
})

test('range scan: a file added only by a merge commit is checked', { skip }, () => {
  const dir = repo()
  const base = commit(dir)
  git(dir, 'checkout', '--quiet', '-b', 'side')
  put(dir, 'side.txt', 'side\n')
  commit(dir)
  git(dir, 'checkout', '--quiet', 'main')
  put(dir, 'a.txt', 'same content\n')
  commit(dir)
  git(dir, 'merge', '--quiet', '--no-ff', '--no-commit', 'side')
  put(dir, 'merged.pem', 'same content\n')
  const head = commit(dir, 'merge')
  const done = scan(dir, ['--range', `${base}..${head}`])
  assert.equal(done.status, 1, done.out)
  assert.match(done.out, /merged\.pem/)
})

test('pre-push scans the committed tree, not the working tree', { skip }, () => {
  const dir = repo()
  put(dir, 'config.txt', `${token}\n`)
  const head = commit(dir)
  put(dir, 'config.txt', 'cleaned, not committed\n')
  // The remote already has the commit, so only the tree scan can see it.
  const hook = run(dir, 'bash', ['.githooks/pre-push', 'origin'], `refs/heads/main ${head} refs/heads/main ${head}\n`)
  assert.equal(hook.status, 1, hook.out)
  // And the other way round: an uncommitted secret is not part of the push.
  put(dir, 'config.txt', 'clean\n')
  const clean = commit(dir)
  git(dir, 'update-ref', 'HEAD', clean)
  put(dir, 'config.txt', `${token}\n`)
  const again = run(dir, 'bash', ['.githooks/pre-push', 'origin'], `refs/heads/main ${clean} refs/heads/main ${clean}\n`)
  assert.equal(again.status, 0, again.out)
})

test('hooks stay active on a branch that does not have them', { skip }, () => {
  const dir = repo()
  git(dir, 'checkout', '--quiet', '--orphan', 'old')
  git(dir, 'rm', '-r', '--quiet', '--cached', '--ignore-unmatch', '.')
  put(dir, 'old.txt', 'before the hooks existed\n')
  git(dir, 'add', 'old.txt')
  git(dir, 'commit', '--quiet', '-m', 'old')
  git(dir, 'clean', '--quiet', '-fd')
  assert.ok(!existsSync(join(dir, '.githooks')))
  // Back on a branch with the hooks, as after a fresh clone.
  for (const path of ['scripts/check_secrets.py', 'scripts/install_hooks.sh', '.githooks/pre-commit', '.githooks/pre-push']) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    copyFileSync(join(source, path), join(dir, path))
  }
  git(dir, 'checkout', '--quiet', '--orphan', 'new')
  commit(dir)
  // The old setting is replaced.
  git(dir, 'config', 'core.hooksPath', '.githooks')
  const installed = run(dir, 'bash', ['scripts/install_hooks.sh'])
  assert.equal(installed.status, 0, installed.out)
  assert.equal(run(dir, 'bash', ['scripts/install_hooks.sh', '--check']).status, 0)

  for (const branch of ['new', 'old']) {
    git(dir, 'checkout', '--quiet', branch)
    put(dir, 'leak.txt', `${token}\n`)
    git(dir, 'add', 'leak.txt')
    const done = run(dir, 'git', ['commit', '-m', 'leak'])
    assert.notEqual(done.status, 0, `${branch}: committed a token\n${done.out}`)
    assert.match(done.out, /SEC-001/)
    git(dir, 'reset', '--quiet', 'HEAD', 'leak.txt')
    unlinkSync(join(dir, 'leak.txt'))
  }
  // pre-push on the old branch, reading stdin through the installed hook.
  put(dir, 'leak.txt', `${token}\n`)
  const leaked = commit(dir)
  git(dir, 'init', '--quiet', '--bare', join(dir, '.git/remote.git'))
  const push = run(dir, 'git', ['push', join(dir, '.git/remote.git'), `${leaked}:refs/heads/old`])
  assert.notEqual(push.status, 0, push.out)
  assert.match(push.out, /Push blocked/)

  git(dir, 'checkout', '--quiet', 'new')
  assert.equal(run(dir, 'bash', ['scripts/install_hooks.sh', '--remove']).status, 0)
  assert.equal(run(dir, 'bash', ['scripts/install_hooks.sh', '--check']).status, 1)
  assert.ok(!existsSync(join(dir, '.git/hooks/pre-commit')))
})

test('hook installer: someone else’s hook is never overwritten', { skip }, () => {
  const dir = repo()
  put(dir, '.git/hooks/pre-push', '#!/bin/sh\necho mine\n')
  const done = run(dir, 'bash', ['scripts/install_hooks.sh'])
  assert.equal(done.status, 1, done.out)
  assert.equal(readFileSync(join(dir, '.git/hooks/pre-push'), 'utf8'), '#!/bin/sh\necho mine\n')
  assert.ok(!existsSync(join(dir, '.git/hooks/pre-commit')))
  run(dir, 'bash', ['scripts/install_hooks.sh', '--remove'])
  assert.ok(existsSync(join(dir, '.git/hooks/pre-push')))
})

test('path rules ignore letter case, and no folder or file type is skipped', { skip }, () => {
  for (const path of ['prod.KEY', '.ENV', 'Server.Pem', 'ID_RSA', 'dump.DB', 'Admin-Credentials.txt']) {
    blocks(path, 'harmless', 'SEC-030')
  }
  for (const path of ['build/conf.txt', 'dist/app.js', 'node_modules/x/index.js', 'report.pdf', 'image.PNG', 'font.woff2']) {
    blocks(path, token, 'SEC-001')
  }
  assert.equal(verdict('.env.example', 'HARMLESS=1').status, 0)
  assert.equal(verdict('src/data/icons.ts', 'export const a = 1').status, 0)
})

/* ---------------------------------------------------------- GitHub rulesets */

/** Runs github_settings.check() against a made-up live repository; no request leaves. */
const CHECK = `
import contextlib, copy, importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location("settings", sys.argv[1])
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

def rule(ruleset, kind):
    return next(r for r in ruleset["rules"] if r["type"] == kind)

def failures(change=None):
    live = {r["name"]: copy.deepcopy(r) for r in s.RULESETS}
    # What GitHub adds on its own must not count as a difference.
    main = live["main-protection"]
    rule(main, "pull_request")["parameters"]["require_extra_approval_for_unattributed_changes"] = True
    rule(main, "pull_request")["parameters"]["allowed_merge_methods"].reverse()
    for check in rule(main, "required_status_checks")["parameters"]["required_status_checks"]:
        check["integration_id"] = 15368
    for item in live["release-tags"]["rules"]:
        if item["type"] == "update":
            item["parameters"] = {"update_allows_fetch_and_merge": False}
    if change:
        change(live)
    names = list(live)
    def call(method, path, body=None):
        assert method == "GET", method
        if path.endswith("rulesets?per_page=100"):
            return 200, [{"name": n, "id": i} for i, n in enumerate(names)]
        if "/rulesets/" in path:
            return 200, live[names[int(path.rsplit("/", 1)[1])]]
        if path == s.BASE:
            analysis = {k: {"status": "enabled"} for k in (*s.SCANNING["security_and_analysis"], "dependabot_security_updates")}
            return 200, {"visibility": "public", **s.REPO_SETTINGS, "security_and_analysis": analysis}
        if path.endswith("/vulnerability-alerts"):
            return 204, None
        if "/alerts" in path:
            return 200, []
        answers = {"/private-vulnerability-reporting": {"enabled": True}, "/actions/permissions": s.ACTIONS,
                   "/actions/permissions/workflow": s.TOKEN_DEFAULTS,
                   "/actions/permissions/fork-pr-contributor-approval": s.FORK_APPROVAL,
                   "/code-scanning/default-setup": {"state": "configured"}}
        return 200, answers[path[len(s.BASE):]]
    s.call = call
    s.FAILED.clear()
    with contextlib.redirect_stdout(io.StringIO()):
        s.check()
    return list(s.FAILED)

def params(name, kind, key, value):
    def change(live):
        rule(live[name], kind)["parameters"][key] = value
    return change

def top(name, key, value):
    def change(live):
        live[name][key] = value
    return change

def refs(name, include, exclude):
    return top(name, "conditions", {"ref_name": {"include": include, "exclude": exclude}})

def drop(name, kind):
    def change(live):
        live[name]["rules"] = [r for r in live[name]["rules"] if r["type"] != kind]
    return change

def fewer_checks(live):
    rule(live["main-protection"], "required_status_checks")["parameters"]["required_status_checks"].pop()

def other_app(live):
    rule(live["main-protection"], "required_status_checks")["parameters"]["required_status_checks"][0]["integration_id"] = 1

main, tags = "main-protection", "release-tags"
weakened = {
    "check reported by another app": other_app,
    "branch excluded": refs(main, ["~DEFAULT_BRANCH"], ["refs/heads/main"]),
    "another branch protected": refs(main, ["refs/heads/other"], []),
    "tags narrowed": refs(tags, ["refs/tags/v0*"], []),
    "tag excluded": refs(tags, ["refs/tags/v*"], ["refs/tags/v1*"]),
    "wrong target": top(tags, "target", "branch"),
    "disabled": top(main, "enforcement", "evaluate"),
    "bypass": top(tags, "bypass_actors", [{"actor_type": "RepositoryRole"}]),
    "rebase merge": params(main, "pull_request", "allowed_merge_methods", ["squash", "merge", "rebase"]),
    "stale reviews kept": params(main, "pull_request", "dismiss_stale_reviews_on_push", False),
    "open threads": params(main, "pull_request", "required_review_thread_resolution", False),
    "not strict": params(main, "required_status_checks", "strict_required_status_checks_policy", False),
    "no check on create": params(main, "required_status_checks", "do_not_enforce_on_create", True),
    "fewer checks": fewer_checks,
    "tag may move": drop(tags, "update"),
    "force push": drop(main, "non_fast_forward"),
}
tag_rules = [r["type"] for r in next(r for r in s.RULESETS if r["name"] == tags)["rules"]]
checks = next(r for r in s.RULESETS if r["name"] == main)
apps = {c.get("integration_id") for c in rule(checks, "required_status_checks")["parameters"]["required_status_checks"]}
policy = [s.REPO_SETTINGS["allow_auto_merge"], s.FORK_APPROVAL["approval_policy"], list(apps)]
print(json.dumps({"tag_rules": tag_rules, "policy": policy, "intact": failures(), "missed": [k for k, c in weakened.items() if not failures(c)]}))
`

test('rulesets: v* tags cannot move, and check reports a weakened ruleset', { skip }, () => {
  const done = run(source, 'python3', ['-I', '-B', '-c', CHECK, join(source, 'scripts/github_settings.py')])
  assert.equal(done.status, 0, done.out)
  const result = JSON.parse(done.out)
  assert.deepEqual([...result.tag_rules].sort(), ['deletion', 'non_fast_forward', 'update'])
  assert.deepEqual(result.intact, [])
  assert.deepEqual(result.missed, [])
  // No auto-merge, every outside contributor approved, checks pinned to GitHub Actions.
  assert.deepEqual(result.policy, [false, 'all_external_contributors', [15368]])
})

test('workflows: nothing merges a pull request by itself', () => {
  const folder = join(source, '.github/workflows')
  for (const name of readdirSync(folder)) {
    assert.doesNotMatch(readFileSync(join(folder, name), 'utf8'), /gh pr merge|enablePullRequestAutoMerge|pulls\.merge|auto-?merge/i, name)
  }
})

/* ---------------------------------------------------------- review workflow */

test('review workflow: the job that may write runs nothing from the pull request', () => {
  const text = readFileSync(join(source, '.github/workflows/pr-review.yml'), 'utf8')
  const [head, body] = text.split(/^jobs:$/m)
  assert.doesNotMatch(head, /:\s*write\b/, 'no workflow-wide write permission')
  const jobs = body.split(/^(?=  [\w-]+:$)/m).filter((job) => /^  [\w-]+:\n/.test(job))
  const writers = jobs.filter((job) => /^\s+[\w-]+:\s*write\b/m.test(job))
  assert.equal(writers.length, 1)
  assert.equal(jobs.length, 2)
  const [post] = writers
  const collect = jobs.find((job) => job !== post)
  assert.deepEqual(post.match(/^\s+[\w-]+:\s*write\b/gm).map((line) => line.trim()), ['pull-requests: write'])
  assert.match(post, /^    needs: review$/m)
  assert.doesNotMatch(post, /actions\/checkout|^\s+(- )?run:|npm |python3 /m)
  assert.deepEqual([...post.matchAll(/uses: ([^@\s]+)/g)].map((m) => m[1]), ['actions/github-script'])
  // The report is data: it reaches the script through the environment only.
  assert.doesNotMatch(post.split(/^\s+script: \|$/m)[1], /\$\{\{/)
  // The required check keeps its name and has no write permission.
  assert.match(collect, /^    name: Automated review$/m)
  assert.match(collect, /actions\/checkout/)
})
