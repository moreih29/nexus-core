#!/usr/bin/env bun

import path from 'node:path';
import { readFile, writeFile, mkdir, readdir, rm, rename, stat } from 'node:fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { execSync } from 'node:child_process';
import { glob } from 'tinyglobby';
import { parseFrontmatter } from './lib/frontmatter.ts';

// Neutral layer allowed fields (bridge §2.1)
const AGENT_ALLOW_FIELDS = new Set([
  'id', 'name', 'alias_ko', 'description', 'task',
  'category', 'capabilities', 'resume_tier', 'model_tier',
]);
const SKILL_ALLOW_FIELDS = new Set([
  'id', 'name', 'description', 'triggers', 'alias_ko', 'manual_only',
]);

// Explicitly known drop list (warn + drop)
const AGENT_DROP_FIELDS = new Set(['maxTurns', 'tags', 'disallowedTools', 'model']);
// 'disable-model-invocation' is NOT in this set — it is mapped to manual_only below.
const SKILL_DROP_FIELDS = new Set(['trigger_display', 'purpose']);

// model name → model_tier abstraction
const MODEL_TIER_MAP: Record<string, 'high' | 'standard'> = {
  opus: 'high',
  sonnet: 'standard',
  haiku: 'standard',
};

interface ImportOptions {
  source: string;
  apply: boolean;
  agentsOnly: boolean;
  skillsOnly: boolean;
}

function parseCli(): ImportOptions {
  const args = process.argv.slice(2);
  let source = process.env['NEXUS_CLAUDE_NEXUS_PATH'] ?? path.resolve('..', 'claude-nexus');
  let apply = false;
  let agentsOnly = false;
  let skillsOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) { source = path.resolve(args[++i]!); }
    else if (args[i] === '--apply') { apply = true; }
    else if (args[i] === '--agents-only') { agentsOnly = true; }
    else if (args[i] === '--skills-only') { skillsOnly = true; }
  }
  if (agentsOnly && skillsOnly) {
    throw new Error('--agents-only and --skills-only are mutually exclusive');
  }
  return { source, apply, agentsOnly, skillsOnly };
}

async function verifySourceIsClaudeNexus(source: string): Promise<void> {
  const pkgPath = path.join(source, 'package.json');
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { name?: string };
    if (pkg.name !== 'claude-nexus') {
      throw new Error(`source package.json.name='${pkg.name}', expected 'claude-nexus'`);
    }
  } catch (err) {
    throw new Error(`Failed to verify source at ${source}: ${(err as Error).message}`);
  }
}

function gitWorkingTreeClean(root: string, scopes: string[]): boolean {
  try {
    const out = execSync(`git status --porcelain ${scopes.join(' ')}`, { cwd: root, encoding: 'utf8' });
    return out.trim().length === 0;
  } catch {
    return true; // directory not yet created, treat as clean
  }
}

// ---- Body transformation ----
// <role>...</role> → ## Role ... (top-level section marker only)
// <constraints>...</constraints> → ## Constraints ...
// <guidelines>...</guidelines> → ## Guidelines ...
// inline <example>, <thinking> etc. sub-XML blocks are preserved
function transformBody(rawBody: string): string {
  const sections: Array<[RegExp, string]> = [
    [/<role>\s*\n?/g, '## Role\n\n'],
    [/<\/role>\s*\n?/g, '\n\n'],
    [/<constraints>\s*\n?/g, '## Constraints\n\n'],
    [/<\/constraints>\s*\n?/g, '\n\n'],
    [/<guidelines>\s*\n?/g, '## Guidelines\n\n'],
    [/<\/guidelines>\s*\n?/g, '\n\n'],
  ];
  let result = rawBody;
  for (const [re, replacement] of sections) {
    result = result.replace(re, replacement);
  }
  // Trim excessive blank lines
  return result.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---- Capability reverse mapping ----
// disallowedTools → capabilities reverse mapping
interface CapabilityEntry {
  id: string;
  harness_mapping: {
    claude_code: string[];
    opencode: string[];
  };
}

interface CapabilitiesFile {
  capabilities: CapabilityEntry[];
}

async function loadCapabilityMap(root: string): Promise<Map<string, string>> {
  const raw = await readFile(path.join(root, 'vocabulary/capabilities.yml'), 'utf8');
  const caps = parseYaml(raw) as CapabilitiesFile;
  const map = new Map<string, string>();
  for (const cap of caps.capabilities) {
    for (const tool of cap.harness_mapping.claude_code) {
      map.set(tool, cap.id);
    }
    for (const tool of cap.harness_mapping.opencode) {
      map.set(tool, cap.id);
    }
  }
  return map;
}

function reverseMapTools(disallowedTools: string[], capMap: Map<string, string>): string[] {
  const capabilitySet = new Set<string>();
  for (const tool of disallowedTools) {
    const cap = capMap.get(tool);
    if (cap) capabilitySet.add(cap);
  }
  return Array.from(capabilitySet).sort();
}

// ---- Agent transformation ----
interface TransformedAgent {
  id: string;
  meta: Record<string, unknown>;
  body: string;
}

async function transformAgent(
  sourcePath: string,
  capMap: Map<string, string>,
  warnings: string[]
): Promise<TransformedAgent | null> {
  const source = await readFile(sourcePath, 'utf8');
  const { data, content } = parseFrontmatter(source);
  const fileName = path.basename(sourcePath, '.md');

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (AGENT_ALLOW_FIELDS.has(key)) {
      if (key === 'capabilities') continue; // will be computed from disallowedTools
      meta[key] = value;
    } else if (AGENT_DROP_FIELDS.has(key)) {
      warnings.push(`  ${fileName}: dropping known field '${key}'`);
    } else {
      throw new Error(`${fileName}: unknown field '${key}' — add to allow list or drop list`);
    }
  }

  // model → model_tier
  if (typeof data['model'] === 'string') {
    const tier = MODEL_TIER_MAP[data['model']];
    if (!tier) throw new Error(`${fileName}: unknown model '${data['model']}'`);
    meta['model_tier'] = tier;
  }

  // disallowedTools → capabilities
  const disallowed = Array.isArray(data['disallowedTools']) ? data['disallowedTools'] : [];
  meta['capabilities'] = reverseMapTools(disallowed as string[], capMap);

  // Ensure id present (use filename if not in frontmatter)
  if (!meta['id']) meta['id'] = fileName;

  // name default to id
  if (!meta['name']) meta['name'] = meta['id'];

  const body = transformBody(content);

  return { id: meta['id'] as string, meta, body };
}

// ---- Skill transformation ----
interface TransformedSkill {
  id: string;
  meta: Record<string, unknown>;
  body: string;
}

async function transformSkill(
  sourceDir: string,
  warnings: string[]
): Promise<TransformedSkill | null> {
  const skillFile = path.join(sourceDir, 'SKILL.md');
  const source = await readFile(skillFile, 'utf8');
  const { data, content } = parseFrontmatter(source);
  const skillId = path.basename(sourceDir);

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SKILL_ALLOW_FIELDS.has(key)) {
      meta[key] = value;
    } else if (SKILL_DROP_FIELDS.has(key)) {
      warnings.push(`  ${skillId}: dropping known field '${key}'`);
    } else if (key === 'disable-model-invocation') {
      // Map to manual_only
      meta['manual_only'] = Boolean(value);
      warnings.push(`  ${skillId}: mapping disable-model-invocation → manual_only`);
    } else {
      throw new Error(`${skillId}: unknown field '${key}' — add to allow list or drop list`);
    }
  }

  // Normalize triggers: bracket strings → tag ids; slash commands → drop + manual_only
  if (Array.isArray(meta['triggers'])) {
    const rawTriggers = meta['triggers'] as string[];
    // Bracket triggers (e.g., [plan], [plan:auto]): strip brackets, split on ':' for parent id
    const bracketTriggers = rawTriggers
      .filter((t) => t.startsWith('[') && t.endsWith(']'))
      .map((t) => t.slice(1, -1).split(':')[0]!)
      .filter((t, i, arr) => arr.indexOf(t) === i); // dedupe
    // Slash command triggers (e.g., /claude-nexus:nx-init): harness-specific, drop them
    const slashTriggers = rawTriggers.filter((t) => t.startsWith('/'));
    if (slashTriggers.length > 0) {
      warnings.push(`  ${skillId}: slash command triggers detected (${slashTriggers.join(', ')}) → dropping + setting manual_only: true`);
      meta['manual_only'] = true;
    }
    if (bracketTriggers.length > 0) {
      meta['triggers'] = bracketTriggers;
    } else {
      delete meta['triggers'];
    }
  }

  if (!meta['id']) meta['id'] = skillId;
  if (!meta['name']) meta['name'] = meta['id'];

  const body = transformBody(content);

  return { id: meta['id'] as string, meta, body };
}

// ---- Staging + atomic rename ----
async function writeToStaging(
  root: string,
  kind: 'agents' | 'skills',
  items: Array<{ id: string; meta: Record<string, unknown>; body: string }>
): Promise<void> {
  const stagingDir = path.join(root, `${kind}.staging`);
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  for (const item of items) {
    const dir = path.join(stagingDir, item.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'meta.yml'), stringifyYaml(item.meta));
    await writeFile(path.join(dir, 'body.md'), item.body);
  }
}

async function atomicSwap(root: string, kind: 'agents' | 'skills'): Promise<void> {
  const live = path.join(root, kind);
  const staging = path.join(root, `${kind}.staging`);
  const backup = path.join(root, `${kind}.backup`);
  // If live exists, move it to backup
  try {
    await stat(live);
    await rm(backup, { recursive: true, force: true });
    await rename(live, backup);
  } catch {
    // live doesn't exist — first bootstrap
  }
  await rename(staging, live);
}

async function cleanupBackup(root: string, kind: 'agents' | 'skills'): Promise<void> {
  const backup = path.join(root, `${kind}.backup`);
  await rm(backup, { recursive: true, force: true });
}

async function restoreBackup(root: string, kind: 'agents' | 'skills'): Promise<void> {
  const live = path.join(root, kind);
  const backup = path.join(root, `${kind}.backup`);
  try {
    await rm(live, { recursive: true, force: true });
    await rename(backup, live);
  } catch {
    /* nothing to restore */
  }
}

// ---- Main ----
async function main(): Promise<void> {
  const opts = parseCli();
  const root = process.cwd();

  console.log('# nexus-core import-from-claude-nexus');
  console.log(`Source: ${opts.source}`);
  console.log(`Target: ${root}`);
  console.log(`Mode: ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('');

  // Verify source
  await verifySourceIsClaudeNexus(opts.source);

  // Git working tree dirty check
  if (opts.apply) {
    const scopes = ['agents/', 'skills/', 'manifest.json'];
    if (!gitWorkingTreeClean(root, scopes)) {
      throw new Error('Working tree has uncommitted changes in agents/, skills/, or manifest.json. Commit or stash first.');
    }
  }

  // Load capability map
  const capMap = await loadCapabilityMap(root);

  // Collect source files
  const agentFiles = opts.skillsOnly
    ? []
    : await glob(['agents/*.md'], { cwd: opts.source, absolute: true });
  const skillDirs = opts.agentsOnly
    ? []
    : await glob(['skills/*'], { cwd: opts.source, absolute: true, onlyDirectories: true });

  const warnings: string[] = [];
  const transformedAgents: TransformedAgent[] = [];
  const transformedSkills: TransformedSkill[] = [];

  // Transform agents
  for (const f of agentFiles) {
    const agent = await transformAgent(f, capMap, warnings);
    if (agent) transformedAgents.push(agent);
  }

  // Transform skills
  for (const d of skillDirs) {
    const skill = await transformSkill(d, warnings);
    if (skill) transformedSkills.push(skill);
  }

  console.log('# Transformation summary');
  console.log(`Agents: ${transformedAgents.length}`);
  console.log(`Skills: ${transformedSkills.length}`);
  if (warnings.length > 0) {
    console.log('# Warnings');
    for (const w of warnings) console.log(w);
  }
  console.log('');

  if (!opts.apply) {
    console.log('# Files that would be written (dry-run):');
    for (const a of transformedAgents) {
      console.log(`  agents/${a.id}/meta.yml`);
      console.log(`  agents/${a.id}/body.md`);
    }
    for (const s of transformedSkills) {
      console.log(`  skills/${s.id}/meta.yml`);
      console.log(`  skills/${s.id}/body.md`);
    }
    console.log('');
    console.log('Run with --apply to write.');
    return;
  }

  // Apply — all-or-nothing transaction via staging
  try {
    if (!opts.skillsOnly) {
      await writeToStaging(root, 'agents', transformedAgents);
      await atomicSwap(root, 'agents');
    }
    if (!opts.agentsOnly) {
      await writeToStaging(root, 'skills', transformedSkills);
      await atomicSwap(root, 'skills');
    }
  } catch (err) {
    console.error('Import failed during write phase. Attempting restore...');
    if (!opts.skillsOnly) await restoreBackup(root, 'agents');
    if (!opts.agentsOnly) await restoreBackup(root, 'skills');
    throw err;
  }

  // Cleanup backup on success
  if (!opts.skillsOnly) await cleanupBackup(root, 'agents');
  if (!opts.agentsOnly) await cleanupBackup(root, 'skills');

  console.log('');
  console.log('Import complete. Running validate...');
  // Auto-validate after apply — run validate via spawnSync
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync('bun', ['run', 'validate'], { cwd: root, stdio: 'inherit' });
  if (res.status !== 0) {
    throw new Error('Validation failed after import. Check output above.');
  }
  console.log('Import + validation complete.');
}

main().catch((err) => {
  console.error('Error:', (err as Error).message);
  process.exit(1);
});
