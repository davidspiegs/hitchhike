// Release snapshot script against throwaway git repositories under the system temp dir;
// no network, and this repository is never read or written.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release-snapshot.mjs', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'hitchhike-release-snapshot-'));
// Isolated git configuration: no user hooks, signing or templates leak into the fixtures.
const env = {
  ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(temporary, 'gitconfig'),
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
};
let count = 0;
const check = (name, fn) => { fn(); console.log(`ok ${++count} - ${name}`); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim();
const write = (root, path, content, mode = 0o644) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content, { mode }); };
const commit = (root, message) => { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', message); return git(root, 'rev-parse', 'HEAD'); };

function repository(name, origin) {
  const root = join(temporary, name);
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'remote', 'add', 'origin', origin);
  return root;
}

function run(...args) {
  try {
    return { status: 0, stdout: execFileSync(process.execPath, [script, ...args], { env, encoding: 'utf8', stdio: 'pipe' }), stderr: '' };
  } catch (error) {
    if (typeof error.status !== 'number') throw error;
    return { status: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

try {
  writeFileSync(env.GIT_CONFIG_GLOBAL, '');
  const source = repository('source', 'https://example.invalid/owner/private.git');
  write(source, '.gitignore', 'private/\n*.local.jsonc\n');
  write(source, 'README.md', '# Fixture\n\nCurrent text.\n');
  write(source, 'src/a.ts', 'export const a = 1;\n');
  write(source, 'docs/x.md', '# Docs\n');
  write(source, 'bin/run.sh', '#!/bin/sh\necho ok\n', 0o755);
  write(source, 'private/secret.txt', 'ignored on purpose\n');
  write(source, 'wrangler.selfhost.local.jsonc', '{ "name": "ignored on purpose" }\n');
  const good = commit(source, 'Fixture');
  assert.equal(git(source, 'status', '--porcelain'), '');

  const mirror = repository('mirror', 'https://example.invalid/owner/public.git');
  write(mirror, '.gitignore', 'private/\n*.local.jsonc\n');
  write(mirror, 'README.md', '# Fixture\n\nOld text.\n');
  write(mirror, 'old.md', 'stale\n');
  commit(mirror, 'Initial');
  const nextSteps = (version) => [
    `Next: review with  git -C ${mirror} show --stat`,
    `Push with         git -C ${mirror} push origin main ${version}`,
    `Then set HITCHHIKE_RELEASE=${version} in the Vercel project and redeploy, and deploy the Worker with --var HITCHHIKE_RELEASE:${version}`,
  ];

  check('--check reports additions, updates and deletions without writing to the mirror', () => {
    const result = run('--source', source, '--mirror', mirror, '--version', 'v0.1.0', '--check');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Snapshot v0\.1\.0 from [0-9a-f]+: 3 added, 1 updated, 1 unchanged, 1 deleted$/m);
    for (const line of ['A bin/run.sh', 'A docs/x.md', 'A src/a.ts', 'M README.md', 'D old.md']) assert.ok(result.stdout.includes(`\n${line}\n`), line);
    assert.match(result.stdout, /^Snapshot check passed$/m);
    assert.equal(git(mirror, 'status', '--porcelain'), '');
    assert.equal(git(mirror, 'tag', '-l'), '');
    assert.ok(existsSync(join(mirror, 'old.md')) && !existsSync(join(mirror, 'src/a.ts')));
  });

  check('a real run syncs tracked files only, commits Release v0.1.0, tags it and prints the next steps', () => {
    const result = run('--source', source, '--mirror', mirror, '--version', 'v0.1.0');
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(git(mirror, 'ls-files').split('\n'), ['.gitignore', 'README.md', 'bin/run.sh', 'docs/x.md', 'src/a.ts']);
    assert.equal(git(mirror, 'status', '--porcelain'), '');
    for (const absent of ['old.md', 'private', 'private/secret.txt', 'wrangler.selfhost.local.jsonc']) assert.ok(!existsSync(join(mirror, absent)), absent);
    assert.equal(readFileSync(join(mirror, 'README.md'), 'utf8'), '# Fixture\n\nCurrent text.\n');
    assert.ok(statSync(join(mirror, 'bin/run.sh')).mode & 0o111);
    assert.match(git(mirror, 'ls-files', '-s', 'bin/run.sh'), /^100755 /);
    assert.equal(git(mirror, 'log', '-1', '--format=%s'), 'Release v0.1.0');
    assert.equal(git(mirror, 'log', '-1', '--format=%b'), `Snapshot of the maintainer's working repository at ${git(source, 'rev-parse', '--short', 'HEAD')}.`);
    assert.equal(git(mirror, 'tag', '-l'), 'v0.1.0');
    assert.equal(git(mirror, 'cat-file', '-t', 'v0.1.0'), 'tag');
    assert.equal(git(mirror, 'rev-parse', 'v0.1.0^{commit}'), git(mirror, 'rev-parse', 'HEAD'));
    assert.match(git(mirror, 'cat-file', '-p', 'v0.1.0'), /\nHitchhike v0\.1\.0$/);
    for (const line of nextSteps('v0.1.0')) assert.ok(result.stdout.includes(`\n${line}\n`), line);
  });

  check('the same version is refused and an unchanged mirror refuses a new version', () => {
    const repeat = run('--source', source, '--mirror', mirror, '--version', 'v0.1.0');
    assert.equal(repeat.status, 1);
    assert.match(repeat.stderr, /^release-snapshot: tag v0\.1\.0 already exists in the mirror$/m);
    const unchanged = run('--source', source, '--mirror', mirror, '--version', 'v0.1.1');
    assert.equal(unchanged.status, 1);
    assert.match(unchanged.stderr, /^release-snapshot: Nothing changed since the last snapshot$/m);
    assert.equal(git(mirror, 'status', '--porcelain'), '');
    assert.equal(git(mirror, 'tag', '-l'), 'v0.1.0');
  });

  check('a dirty source, a credential pattern and a forbidden path stop the run before anything is written', () => {
    write(source, 'scratch.txt', 'untracked\n');
    const dirty = run('--source', source, '--mirror', mirror, '--version', 'v0.1.1');
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /^release-snapshot: source work tree has uncommitted changes: scratch\.txt$/m);
    rmSync(join(source, 'scratch.txt'));
    assert.equal(git(source, 'status', '--porcelain'), '');

    const key = 'sk_live_' + 'ABCDEFGH1234';
    write(source, 'src/b.ts', `export const key = "${key}";\n`);
    commit(source, 'Leak');
    const leak = run('--source', source, '--mirror', mirror, '--version', 'v0.1.1');
    assert.equal(leak.status, 1);
    assert.match(leak.stderr, /^release-snapshot: src\/b\.ts matches the sk_live_ key pattern/m);
    assert.ok(!leak.stderr.includes(key) && !leak.stdout.includes(key));
    git(source, 'reset', '-q', '--hard', good);

    write(source, 'handoff/notes.md', '# private notes\n');
    git(source, 'add', '-f', 'handoff/notes.md');
    git(source, 'commit', '-q', '-m', 'Forbidden path');
    const forbidden = run('--source', source, '--mirror', mirror, '--version', 'v0.1.1');
    assert.equal(forbidden.status, 1);
    assert.match(forbidden.stderr, /^release-snapshot: forbidden path in the export: handoff\/notes\.md$/m);
    git(source, 'reset', '-q', '--hard', good);
    assert.equal(git(source, 'status', '--porcelain'), '');
    assert.equal(git(mirror, 'status', '--porcelain'), '');
    assert.equal(git(mirror, 'tag', '-l'), 'v0.1.0');
  });

  check('a mirror whose origin is the source repository, a malformed version and a missing --mirror are refused', () => {
    const twin = repository('twin', 'https://example.invalid/owner/private/');
    write(twin, 'README.md', 'twin\n');
    commit(twin, 'Initial');
    const sameOrigin = run('--source', source, '--mirror', twin, '--version', 'v0.2.0', '--check');
    assert.equal(sameOrigin.status, 1);
    assert.match(sameOrigin.stderr, /^release-snapshot: mirror origin https:\/\/example\.invalid\/owner\/private\/ is the source repository itself/m);
    const badVersion = run('--source', source, '--mirror', mirror, '--version', '1.0', '--check');
    assert.equal(badVersion.status, 1);
    assert.match(badVersion.stderr, /^release-snapshot: --version must be a tag like v0\.1\.0/m);
    const missingMirror = run('--source', source, '--version', 'v0.2.0', '--check');
    assert.equal(missingMirror.status, 1);
    assert.match(missingMirror.stderr, /^release-snapshot: --mirror is required/m);
  });

  check('the synthetic Anthropic fixtures pass the content scan while a real-looking token is refused', () => {
    write(source, 'scripts/fixtures.mjs', "const token = 'sk-ant-oat01-SYNTHETIC_TOKEN_NOT_A_REAL_CREDENTIAL';\nconst maintenance = 'Bearer sk-ant-oat01-SYNTHETIC_MAINTENANCE_ONLY';\n");
    commit(source, 'Fixtures');
    const fixtures = run('--source', source, '--mirror', mirror, '--version', 'v0.2.0', '--check');
    assert.equal(fixtures.status, 0, fixtures.stderr);
    assert.match(fixtures.stdout, /^Snapshot check passed$/m);

    const token = 'sk-ant-api03-' + 'q7w8e9r0t1y2u3i4o5p6a7s8d9f0g1h2j3k4l5z6';
    write(source, 'src/token.ts', `export const token = "${token}";\n`);
    commit(source, 'Token');
    const refused = run('--source', source, '--mirror', mirror, '--version', 'v0.2.0', '--check');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /^release-snapshot: src\/token\.ts matches the sk-ant- token pattern/m);
    assert.ok(!refused.stderr.includes(token) && !refused.stdout.includes(token));
    git(source, 'reset', '-q', '--hard', good);
  });

  console.log(`Release snapshot checks passed: ${count}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
