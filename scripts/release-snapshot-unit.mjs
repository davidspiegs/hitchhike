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

  const marker = ['HOSTED', 'ONLY'].join('_');
  const begin = marker + '_BEGIN', end = marker + '_END';
  const overlaySource = repository('overlay-source', 'https://example.invalid/owner/overlay-private.git');
  const overlayMirror = repository('overlay-mirror', 'https://example.invalid/owner/overlay-public.git');
  const hostedBlock = (style, content, newline = '\n') => {
    const wrap = (name) => style === 'html' ? `  <!-- ${name} -->` : `${style} ${name}`;
    return [wrap(begin), content, wrap(end), ''].join(newline);
  };
  const credential = 'sk_live_' + 'ABCDEFGH1234';
  const jsPublic = 'export const before = true;\r\nexport const after = true;';
  const jsPrivate = 'export const before = true;\r\n' + hostedBlock('//', `const privateKey = "${credential}";`, '\r\n') + 'export const after = true;';
  const binary = Buffer.concat([Buffer.from([0, 255, 13, 10]), Buffer.from(begin + '\nprivate bytes\n' + end)]);
  const nonUtf8 = Buffer.concat([Buffer.from([255, 254]), Buffer.from(begin)]);
  write(overlaySource, 'README.md', '# Public overlay fixture\n');
  write(overlaySource, 'src/example.ts', jsPrivate);
  write(overlaySource, 'index.html', '<head>\n' + hostedBlock('html', '<script>privateCode()</script>') + '</head>\n');
  write(overlaySource, 'config.yml', 'public: true\n' + hostedBlock('#', 'private: true') + 'after: true\n');
  write(overlaySource, 'bin/run.sh', '#!/bin/sh\n' + hostedBlock('#', 'echo private') + 'echo public\n', 0o755);
  write(overlaySource, 'assets/binary.bin', binary);
  write(overlaySource, 'assets/non-utf8.bin', nonUtf8);
  write(overlaySource, 'scripts/release-snapshot.mjs', readFileSync(script), 0o755);
  write(overlaySource, 'hosted/analytics.js', 'private implementation\n');
  write(overlaySource, 'hosted/tests/nested.mjs', 'private test\n');
  commit(overlaySource, 'Hosted overlay fixture');
  write(overlayMirror, 'README.md', '# Old public fixture\n');
  write(overlayMirror, 'hosted/analytics.js', 'previously exported implementation\n');
  write(overlayMirror, 'hosted/obsolete.js', 'previously exported stale implementation\n');
  commit(overlayMirror, 'Previously published hosted files');

  check('overlay checks exclude hosted files and plan transformed content without mutating either checkout', () => {
    const sourceHead = git(overlaySource, 'rev-parse', 'HEAD');
    const mirrorHead = git(overlayMirror, 'rev-parse', 'HEAD');
    const result = run('--source', overlaySource, '--mirror', overlayMirror, '--version', 'v1.0.0', '--check');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^D hosted\/analytics\.js$/m);
    assert.match(result.stdout, /^D hosted\/obsolete\.js$/m);
    assert.doesNotMatch(result.stdout, /^[AM] hosted\//m);
    assert.ok(!result.stdout.includes(credential) && !result.stderr.includes(credential));
    assert.equal(git(overlaySource, 'rev-parse', 'HEAD'), sourceHead);
    assert.equal(git(overlayMirror, 'rev-parse', 'HEAD'), mirrorHead);
    assert.equal(git(overlaySource, 'status', '--porcelain'), '');
    assert.equal(git(overlayMirror, 'status', '--porcelain'), '');
    assert.equal(git(overlayMirror, 'tag', '-l'), '');
    assert.ok(existsSync(join(overlayMirror, 'hosted/analytics.js')));
    assert.equal(readFileSync(join(overlaySource, 'src/example.ts'), 'utf8'), jsPrivate);
  });

  check('snapshots strip all supported wrappers, remove old hosted files, and preserve binary bytes, line endings and modes', () => {
    const result = run('--source', overlaySource, '--mirror', overlayMirror, '--version', 'v1.0.0');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(overlayMirror, 'src/example.ts'), 'utf8'), jsPublic);
    assert.equal(readFileSync(join(overlayMirror, 'index.html'), 'utf8'), '<head>\n</head>\n');
    assert.equal(readFileSync(join(overlayMirror, 'config.yml'), 'utf8'), 'public: true\nafter: true\n');
    assert.equal(readFileSync(join(overlayMirror, 'bin/run.sh'), 'utf8'), '#!/bin/sh\necho public\n');
    assert.equal(statSync(join(overlayMirror, 'bin/run.sh')).mode & 0o777, statSync(join(overlaySource, 'bin/run.sh')).mode & 0o777);
    assert.match(git(overlayMirror, 'ls-files', '-s', 'bin/run.sh'), /^100755 /);
    assert.deepEqual(readFileSync(join(overlayMirror, 'assets/binary.bin')), binary);
    assert.deepEqual(readFileSync(join(overlayMirror, 'assets/non-utf8.bin')), nonUtf8);
    assert.deepEqual(readFileSync(join(overlayMirror, 'scripts/release-snapshot.mjs')), readFileSync(script));
    assert.ok(!existsSync(join(overlayMirror, 'hosted')));
    assert.doesNotMatch(git(overlayMirror, 'ls-files'), /^hosted\//m);
    assert.equal(git(overlayMirror, 'status', '--porcelain'), '');
    assert.equal(git(overlaySource, 'status', '--porcelain'), '');
    assert.equal(readFileSync(join(overlaySource, 'src/example.ts'), 'utf8'), jsPrivate);
  });

  check('hosted-only edits leave public snapshot unchanged and do not create another release', () => {
    write(overlaySource, 'src/example.ts', jsPrivate.replace('const privateKey', 'const changedPrivateKey'));
    write(overlaySource, 'hosted/analytics.js', 'new private implementation\n');
    commit(overlaySource, 'Only hosted behavior changed');
    const mirrorHead = git(overlayMirror, 'rev-parse', 'HEAD');
    for (const flags of [[], ['--check']]) {
      const result = run('--source', overlaySource, '--mirror', overlayMirror, '--version', 'v1.0.1', ...flags);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /^release-snapshot: Nothing changed since the last snapshot$/m);
      assert.equal(git(overlayMirror, 'rev-parse', 'HEAD'), mirrorHead);
      assert.equal(git(overlayMirror, 'tag', '-l'), 'v1.0.0');
      assert.equal(git(overlayMirror, 'status', '--porcelain'), '');
    }
  });

  check('malformed, nested, unclosed and stray markers fail before any mirror changes', () => {
    const sourceHead = git(overlaySource, 'rev-parse', 'HEAD');
    const mirrorHead = git(overlayMirror, 'rev-parse', 'HEAD');
    const cases = [
      [`// ${begin}\n// ${begin}\n// ${end}\n// ${end}\n`, /nests a hosted-only block/],
      [`// ${end}\n`, /closes a hosted-only block that was not opened/],
      [`// ${begin}\nprivateCode();\n`, /unclosed hosted-only block/],
      [`const x = 1; // ${begin}\n`, /malformed hosted-only marker/],
      [`// ${begin} trailing text\n`, /malformed hosted-only marker/],
      [`<!-- ${begin}\n`, /malformed hosted-only marker/],
      [`// ${begin}\n# ${end}\n`, /different comment wrapper/],
      [`// ${begin.toLowerCase()}\n`, /malformed hosted-only marker/],
      [`const marker = '${begin}';\n`, /malformed hosted-only marker/],
      [`// ${marker}_BEGN\n`, /malformed hosted-only marker/],
      [`// ${begin}\nconst marker = '${end}';\n// ${end}\n`, /malformed hosted-only marker/],
    ];
    for (const [content, error] of cases) {
      write(overlaySource, 'README.md', '# A public change that must not be written\n');
      write(overlaySource, 'src/invalid.ts', content);
      commit(overlaySource, 'Invalid marker fixture');
      const result = run('--source', overlaySource, '--mirror', overlayMirror, '--version', 'v1.0.1');
      assert.equal(result.status, 1, content);
      assert.match(result.stderr, error);
      assert.match(result.stderr, /src\/invalid\.ts:\d+/);
      assert.equal(git(overlayMirror, 'rev-parse', 'HEAD'), mirrorHead);
      assert.equal(git(overlayMirror, 'status', '--porcelain'), '');
      assert.equal(git(overlayMirror, 'tag', '-l'), 'v1.0.0');
      assert.equal(readFileSync(join(overlayMirror, 'README.md'), 'utf8'), '# Public overlay fixture\n');
      assert.ok(!existsSync(join(overlayMirror, 'src/invalid.ts')));
    }
    git(overlaySource, 'reset', '-q', '--hard', sourceHead);
  });

  check('credentials retained in public bytes are still refused after hosted-block stripping', () => {
    write(overlaySource, 'src/public-secret.ts', hostedBlock('//', 'privateCode();') + `const publicKey = "${credential}";\n`);
    commit(overlaySource, 'Public credential fixture');
    const mirrorHead = git(overlayMirror, 'rev-parse', 'HEAD');
    const result = run('--source', overlaySource, '--mirror', overlayMirror, '--version', 'v1.0.1');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/public-secret\.ts matches the sk_live_ key pattern/);
    assert.ok(!result.stdout.includes(credential) && !result.stderr.includes(credential));
    assert.equal(git(overlayMirror, 'rev-parse', 'HEAD'), mirrorHead);
    assert.equal(git(overlayMirror, 'status', '--porcelain'), '');
    assert.ok(!existsSync(join(overlayMirror, 'src/public-secret.ts')));
  });

  console.log(`Release snapshot checks passed: ${count}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
