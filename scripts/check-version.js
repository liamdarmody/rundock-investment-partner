#!/usr/bin/env node
'use strict';
// A release tag and the manifest it carries must name the same version.
//
// Rundock's install card reads the version from rundock.json and the pin from
// the tag, and shows both side by side, so a tag whose manifest names another
// version produces a card that contradicts itself ("Install investment-partner 1.0.0?"
// beside "pinned to v1.0.1"). Tags are never moved once published, so the
// only fix after the fact is a new tag; this check is what stops the first.
//
//   node scripts/check-version.js           rundock.json against package.json,
//                                           and every tag on the current commit
//   node scripts/check-version.js v1.0.0    one tag: the manifest committed at
//                                           that tag, or, before the tag exists,
//                                           the working manifest it would carry
//   node scripts/check-version.js --all     every tag in the repository
//
// Exits non-zero, naming each disagreement, when any check fails.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');

// Tags whose manifest disagrees with them and which cannot be moved because
// they were published. Listed by name with the reason, never matched by
// pattern, and refused if the entry stops being true, so the list cannot
// quietly grow into a way of hiding a new mistake. Empty, and meant to stay so.
const KNOWN_MISMATCHES = {};

function versionOfTag(tag) {
  const match = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(String(tag));
  return match ? match[1] : null;
}

// One comparison, stated once: the reason is null when they agree.
function disagreement(tag, manifestVersion) {
  const expected = versionOfTag(tag);
  if (!expected) return `${tag} is not a version tag (expected vMAJOR.MINOR.PATCH)`;
  if (typeof manifestVersion !== 'string') return `${tag}: rundock.json has no version string`;
  if (manifestVersion !== expected) return `${tag}: rundock.json says ${manifestVersion}, the tag says ${expected}`;
  return null;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function isRepository() {
  try { return git(['rev-parse', '--is-inside-work-tree']) === 'true'; } catch (e) { return false; }
}

function tags() {
  const out = git(['tag', '--list']);
  return out ? out.split('\n') : [];
}

function tagsAtHead() {
  const out = git(['tag', '--points-at', 'HEAD']);
  return out ? out.split('\n') : [];
}

function manifestAt(tag) {
  return JSON.parse(git(['show', `${tag}:rundock.json`]));
}

function workingJson(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

// Every tag, judged against the known list: a known tag must still disagree
// (an entry that has become false is itself a failure), and every other tag
// must agree.
function checkAllTags(list = tags(), readManifest = manifestAt, known = KNOWN_MISMATCHES) {
  const problems = [];
  for (const tag of list) {
    let reason;
    try { reason = disagreement(tag, readManifest(tag).version); } catch (e) { reason = `${tag}: rundock.json could not be read (${e.message.split('\n')[0]})`; }
    if (Object.prototype.hasOwnProperty.call(known, tag)) {
      if (!reason) problems.push(`${tag} is listed as a known mismatch but agrees; remove it from KNOWN_MISMATCHES`);
    } else if (reason) {
      problems.push(reason);
    }
  }
  for (const tag of Object.keys(known)) {
    if (!list.includes(tag)) problems.push(`${tag} is listed as a known mismatch but no such tag exists`);
  }
  return problems;
}

function checkWorkingTree() {
  const problems = [];
  const manifest = workingJson('rundock.json');
  const pkg = workingJson('package.json');
  if (manifest.version !== pkg.version) {
    problems.push(`rundock.json says ${manifest.version}, package.json says ${pkg.version}`);
  }
  return problems;
}

function checkOneTag(tag) {
  const exists = tags().includes(tag);
  const version = exists ? manifestAt(tag).version : workingJson('rundock.json').version;
  const reason = disagreement(tag, version);
  return reason ? [reason] : [];
}

function main(argv) {
  const problems = [];
  const arg = argv[0];
  if (!isRepository() && arg) {
    console.error('not a git repository: tag checks need git');
    return 2;
  }
  problems.push(...checkWorkingTree());
  if (arg === '--all') problems.push(...checkAllTags());
  else if (arg) problems.push(...checkOneTag(arg));
  else if (isRepository()) {
    for (const tag of tagsAtHead()) {
      const reason = disagreement(tag, workingJson('rundock.json').version);
      if (reason) problems.push(reason);
    }
  }
  if (problems.length) {
    for (const p of problems) console.error(`version check failed: ${p}`);
    return 1;
  }
  console.log('version check passed');
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { KNOWN_MISMATCHES, versionOfTag, disagreement, checkAllTags, isRepository, tags, manifestAt };
