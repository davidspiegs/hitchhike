#!/usr/bin/env node
// Publish one squashed snapshot of this private checkout into the public release mirror.
// Only tracked public files are exported: the hosted/ overlay and explicitly
// marked hosted-only blocks are omitted. Ignored paths such as private/, handoff/,
// wrangler.production.jsonc, *.local.jsonc and .dev.vars never leave this repository,
// and forbidden paths or credential patterns stop the run before anything is written.
// The mirror receives a "Release vX.Y.Z" commit plus an annotated vX.Y.Z tag. Nothing is
// pushed and no network is used; the push and deploy commands are printed instead.
//   node scripts/release-snapshot.mjs --mirror <path-to-public-clone> --version vX.Y.Z [--check] [--source <path>]
import { execFileSync } from 'node:child_process';
import { isUtf8 } from 'node:buffer';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node scripts/release-snapshot.mjs --mirror <path-to-public-clone> --version vX.Y.Z [--check] [--source <path>]';
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenPrefixes = ['private/', 'handoff/', 'evidence/', 'operator-notes/', 'artifacts/', '.claude/'];
const forbiddenNames = new Set(['wrangler.production.jsonc', 'PLAN.md', 'MIGRATION.md', '.dev.vars']);
// Assemble the marker name so this public exporter does not contain a stray marker itself.
const hostedMarker = ['HOSTED', 'ONLY'].join('_');
const hostedMarkerOccurrence = new RegExp(hostedMarker, 'i');
const hostedMarkerForms = [
  ['javascript', new RegExp(`^[\\t ]*//[\\t ]*(${hostedMarker}_(BEGIN|END))[\\t ]*$`)],
  ['html', new RegExp(`^[\\t ]*<!--[\\t ]*(${hostedMarker}_(BEGIN|END))[\\t ]*-->[\\t ]*$`)],
  ['yaml', new RegExp(`^[\\t ]*#[\\t ]*(${hostedMarker}_(BEGIN|END))[\\t ]*$`)],
];
// Labels are printed on failure; the matched text never is.
const credentialPatterns = [
  ['sk_live_ key', /sk_live_[A-Za-z0-9]{8,}/],
  ['pk_live_ key', /pk_live_[A-Za-z0-9+/=]{16,}/],
  ['whsec_ secret', /whsec_[A-Za-z0-9+/=]{20,}/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  // Real tokens mix lower-case letters and digits; the synthetic fixtures in the test suite are upper-case words.
  ['sk-ant- token', /sk-ant-(?:api|oat)\d\d-(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/],
];

class SnapshotError extends Error {}
const fail = (reason) => { throw new SnapshotError(reason); };
const firstLine = (text) => String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
const shellWord = (value) => (/^[A-Za-z0-9_.~/:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`);

function runGit(cwd, args) {
  try {
    return { status: 0, stdout: execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }), stderr: '' };
  } catch (error) {
    if (typeof error.status !== 'number') fail(`git could not run in ${cwd}: ${error.message}`);
    return { status: error.status, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

function git(cwd, args) {
  const result = runGit(cwd, args);
  if (result.status !== 0) fail(`git ${args[0]} failed in ${cwd}: ${firstLine(result.stderr) || `exit status ${result.status}`}`);
  return result.stdout;
}

function parseArguments(argv) {
  const options = { mirror: '', version: '', source: repositoryRoot, check: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--check') { options.check = true; continue; }
    if (argument === '--mirror' || argument === '--version' || argument === '--source') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`${argument} needs a value. ${usage}`);
      options[argument.slice(2)] = value;
      index++;
      continue;
    }
    fail(`unknown argument ${argument}. ${usage}`);
  }
  if (!options.mirror) fail(`--mirror is required. ${usage}`);
  if (!options.version) fail(`--version is required. ${usage}`);
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(options.version)) fail(`--version must be a tag like v0.1.0 or v0.1.0-rc.1, not ${options.version}`);
  return options;
}

function openRepository(label, path) {
  let real;
  try { real = realpathSync(path); } catch { fail(`${label} path ${path} does not exist`); }
  if (!statSync(real).isDirectory()) fail(`${label} path ${path} is not a directory`);
  const inside = runGit(real, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') fail(`${label} path ${path} is not inside a git work tree`);
  const top = realpathSync(git(real, ['rev-parse', '--show-toplevel']).trim());
  if (top !== real) fail(`${label} path ${path} must be the top-level directory of its repository (${top})`);
  const origin = runGit(real, ['remote', 'get-url', 'origin']);
  return { label, path: real, origin: origin.status === 0 ? origin.stdout.trim() : null };
}

function requireClean(repository) {
  const dirty = git(repository.path, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((line) => line.slice(3));
  if (dirty.length) fail(`${repository.label} work tree has uncommitted changes: ${dirty.join(', ')}`);
}

// Same repository behind different spellings: scheme, user, case, trailing "/" or ".git".
function remoteIdentity(url) {
  const value = url.trim();
  const scp = value.match(/^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.*)$/);
  const bare = scp ? `${scp[1]}/${scp[2]}` : value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]+@/, '');
  return bare.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function isForbiddenPath(path) {
  if (forbiddenPrefixes.some((prefix) => path.startsWith(prefix))) return true;
  const name = posix.basename(path);
  return forbiddenNames.has(name) || name.endsWith('.local.jsonc');
}

function scanContent(path, content) {
  if (content.subarray(0, 8192).includes(0)) return; // binary
  const text = content.toString('utf8');
  for (const [label, pattern] of credentialPatterns) {
    if (pattern.test(text)) fail(`${path} matches the ${label} pattern; remove it before taking a snapshot`);
  }
}

function publicContent(path, content) {
  // Binary files are copied byte-for-byte. Files without markers also retain their exact bytes.
  if (content.includes(0) || !isUtf8(content)) return content;
  const text = content.toString('utf8');
  if (!hostedMarkerOccurrence.test(text)) return content;
  const output = [];
  let opened = null;
  const lines = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!hostedMarkerOccurrence.test(line)) {
      if (!opened) output.push(line);
      continue;
    }
    const body = line.replace(/(?:\r\n|\n|\r)$/, '');
    const found = hostedMarkerForms.map(([style, pattern]) => ({ style, match: body.match(pattern) })).find(({ match }) => match);
    const location = `${path}:${index + 1}`;
    if (!found) fail(`${location} has a malformed hosted-only marker; use a complete comment line`);
    if (found.match[2] === 'BEGIN') {
      if (opened) fail(`${location} nests a hosted-only block opened at line ${opened.line}`);
      opened = { style: found.style, line: index + 1 };
    } else {
      if (!opened) fail(`${location} closes a hosted-only block that was not opened`);
      if (found.style !== opened.style) fail(`${location} uses a different comment wrapper from the hosted-only block opened at line ${opened.line}`);
      opened = null;
    }
  }
  if (opened) fail(`${path}:${opened.line} has an unclosed hosted-only block`);
  return Buffer.from(output.join(''), 'utf8');
}

function readMirrorFile(root, path) {
  const absolute = join(root, path);
  try {
    return { content: readFileSync(absolute), executable: Boolean(statSync(absolute).mode & 0o100) };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'EISDIR') fail(`mirror has a directory at ${path} where the snapshot needs a file`);
    throw error;
  }
}

function pruneEmptyDirectories(root, path) {
  for (let directory = posix.dirname(path); directory !== '.' && directory !== '.git' && !directory.startsWith('.git/'); directory = posix.dirname(directory)) {
    const absolute = join(root, directory);
    if (readdirSync(absolute).length) return;
    rmdirSync(absolute);
  }
}

function snapshot({ mirror: mirrorArgument, version, source: sourceArgument, check }) {
  const source = openRepository('source', sourceArgument);
  requireClean(source);
  const mirror = openRepository('mirror', mirrorArgument);
  if (mirror.path === source.path || mirror.path.startsWith(source.path + sep) || source.path.startsWith(mirror.path + sep)) {
    fail('mirror must be a separate checkout outside the source repository');
  }
  if (source.origin && mirror.origin && remoteIdentity(source.origin) === remoteIdentity(mirror.origin)) {
    fail(`mirror origin ${mirror.origin} is the source repository itself; point --mirror at a clone of the public repository`);
  }
  requireClean(mirror);
  if (git(mirror.path, ['tag', '-l', version]).trim()) fail(`tag ${version} already exists in the mirror`);
  const branchResult = runGit(mirror.path, ['symbolic-ref', '--short', 'HEAD']);
  if (branchResult.status !== 0) fail('mirror has no branch checked out');
  const branch = branchResult.stdout.trim();

  const tracked = git(source.path, ['ls-files', '-z']).split('\0').filter(Boolean);
  if (!tracked.length) fail('source repository has no tracked files');
  const forbidden = tracked.filter(isForbiddenPath);
  if (forbidden.length) fail(`forbidden path${forbidden.length > 1 ? 's' : ''} in the export: ${forbidden.join(', ')}`);
  const exported = tracked.filter((path) => !path.startsWith('hosted/'));
  if (!exported.length) fail('source repository has no public tracked files');

  const plan = { added: [], updated: [], unchanged: [], deleted: [] };
  const files = new Map();
  for (const path of exported) {
    const absolute = join(source.path, path);
    const stats = lstatSync(absolute);
    if (stats.isSymbolicLink()) fail(`${path} is a symbolic link; the snapshot exports regular files only`);
    if (stats.isDirectory()) fail(`${path} is a submodule; the snapshot does not export submodules`);
    const content = publicContent(path, readFileSync(absolute));
    scanContent(path, content);
    files.set(path, { content, mode: stats.mode & 0o777 });
    const existing = readMirrorFile(mirror.path, path);
    if (!existing) plan.added.push(path);
    else if (existing.content.equals(content) && existing.executable === Boolean(stats.mode & 0o100)) plan.unchanged.push(path);
    else plan.updated.push(path);
  }
  const exportSet = new Set(exported);
  plan.deleted = git(mirror.path, ['ls-files', '-z']).split('\0').filter(Boolean).filter((path) => !exportSet.has(path));

  const sourceSha = git(source.path, ['rev-parse', '--short', 'HEAD']).trim();
  console.log(`Snapshot ${version} from ${sourceSha}: ${plan.added.length} added, ${plan.updated.length} updated, ${plan.unchanged.length} unchanged, ${plan.deleted.length} deleted`);
  for (const path of plan.added) console.log(`A ${path}`);
  for (const path of plan.updated) console.log(`M ${path}`);
  for (const path of plan.deleted) console.log(`D ${path}`);
  if (!plan.added.length && !plan.updated.length && !plan.deleted.length) fail('Nothing changed since the last snapshot');
  if (check) { console.log('Snapshot check passed'); return; }

  // Deletions first so a path can change between file and directory; then write exactly the
  // transformed bytes already compared and scanned, preserving the original file permissions.
  for (const path of plan.deleted) {
    unlinkSync(join(mirror.path, path));
    pruneEmptyDirectories(mirror.path, path);
  }
  for (const path of exported) {
    const to = join(mirror.path, path), file = files.get(path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, file.content);
    chmodSync(to, file.mode);
  }
  git(mirror.path, ['add', '-A']);
  const staged = runGit(mirror.path, ['diff', '--cached', '--quiet']);
  if (staged.status === 0) fail('Nothing changed since the last snapshot');
  if (staged.status !== 1) fail(`git diff failed in ${mirror.path}: ${firstLine(staged.stderr) || `exit status ${staged.status}`}`);
  git(mirror.path, ['commit', '--quiet', '-m', `Release ${version}`, '-m', `Snapshot of the maintainer's working repository at ${sourceSha}.`]);
  git(mirror.path, ['tag', '-a', version, '-m', `Hitchhike ${version}`]);
  const mirrorSha = git(mirror.path, ['rev-parse', '--short', 'HEAD']).trim();
  console.log(`Committed Release ${version} (${mirrorSha}) and tagged ${version} in ${mirror.path}`);
  console.log(`Next: review with  git -C ${shellWord(mirrorArgument)} show --stat`);
  console.log(`Push with         git -C ${shellWord(mirrorArgument)} push origin ${branch} ${version}`);
  console.log(`Then set HITCHHIKE_RELEASE=${version} in the Vercel project and redeploy, and deploy the Worker with --var HITCHHIKE_RELEASE:${version}`);
}

try {
  snapshot(parseArguments(process.argv.slice(2)));
} catch (error) {
  console.error(`release-snapshot: ${error.message}`);
  process.exitCode = 1;
}
