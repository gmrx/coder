import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type SkillSource = 'workspace' | 'user';

export interface DiscoveredSkill {
  name: string;
  slug: string;
  title: string;
  description: string;
  source: SkillSource;
  sourceLabel: string;
  rootPath: string;
  skillDirPath: string;
  skillFilePath: string;
  relativeDirPath: string;
  aliases: string[];
}

export interface SkillSearchMatch {
  skill: DiscoveredSkill;
  score: number;
  reasons: string[];
  exact: boolean;
}

function normalizeSlashes(value: string): string {
  return String(value || '').replace(/\\/g, '/');
}

function normalizeSkillQuery(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^[$/]+/, '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function candidateSkillRoots(workspaceRoot?: string): Array<{
  rootPath: string;
  source: SkillSource;
  sourceLabel: string;
}> {
  const home = os.homedir();
  const codeHome = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(home, '.codex');
  const candidates = [
    workspaceRoot ? { rootPath: path.join(workspaceRoot, '.codex', 'skills'), source: 'workspace' as const, sourceLabel: 'workspace/.codex/skills' } : null,
    workspaceRoot ? { rootPath: path.join(workspaceRoot, '.cursor', 'skills'), source: 'workspace' as const, sourceLabel: 'workspace/.cursor/skills' } : null,
    workspaceRoot ? { rootPath: path.join(workspaceRoot, '.cursorcoder', 'skills'), source: 'workspace' as const, sourceLabel: 'workspace/.cursorcoder/skills' } : null,
    workspaceRoot ? { rootPath: path.join(workspaceRoot, '.claude', 'skills'), source: 'workspace' as const, sourceLabel: 'workspace/.claude/skills' } : null,
    { rootPath: path.join(codeHome, 'skills'), source: 'user' as const, sourceLabel: `${path.basename(codeHome)}/skills` },
    { rootPath: path.join(home, '.cursor', 'skills'), source: 'user' as const, sourceLabel: '~/.cursor/skills' },
    { rootPath: path.join(home, '.cursorcoder', 'skills'), source: 'user' as const, sourceLabel: '~/.cursorcoder/skills' },
    { rootPath: path.join(home, '.claude', 'skills'), source: 'user' as const, sourceLabel: '~/.claude/skills' },
  ].filter(Boolean) as Array<{ rootPath: string; source: SkillSource; sourceLabel: string }>;

  const deduped = new Map<string, { rootPath: string; source: SkillSource; sourceLabel: string }>();
  for (const candidate of candidates) {
    deduped.set(path.resolve(candidate.rootPath), {
      rootPath: path.resolve(candidate.rootPath),
      source: candidate.source,
      sourceLabel: candidate.sourceLabel,
    });
  }
  return [...deduped.values()];
}

function stripFrontmatter(markdown: string): string {
  const value = String(markdown || '');
  if (!value.startsWith('---\n')) return value;
  const end = value.indexOf('\n---\n', 4);
  if (end < 0) return value;
  return value.slice(end + 5);
}

function firstHeading(markdown: string): string {
  const match = String(markdown || '').match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || '';
}

function firstParagraph(markdown: string): string {
  const stripped = stripFrontmatter(markdown);
  const lines = stripped.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^#/.test(line)) continue;
    if (/^[-*]\s+/.test(line)) continue;
    return line.replace(/\s+/g, ' ').trim();
  }
  return '';
}

function buildSkillAliases(name: string, slug: string, title: string): string[] {
  const values = [
    name,
    slug,
    title,
    `$${name}`,
    `$${slug}`,
    `/${name}`,
    `/${slug}`,
  ]
    .map((value) => normalizeSkillQuery(value))
    .filter(Boolean);
  return [...new Set(values)];
}

function scanSkillFiles(rootPath: string): string[] {
  if (!fs.existsSync(rootPath)) return [];

  const results: string[] = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        results.push(absolute);
      }
    }
  }

  return results;
}

export function listAvailableSkillsSync(workspaceRoot?: string): DiscoveredSkill[] {
  const rawEntries: Array<{
    source: SkillSource;
    sourceLabel: string;
    rootPath: string;
    skillDirPath: string;
    skillFilePath: string;
    relativeDirPath: string;
    baseName: string;
    title: string;
    description: string;
  }> = [];

  for (const root of candidateSkillRoots(workspaceRoot)) {
    for (const skillFilePath of scanSkillFiles(root.rootPath)) {
      const skillDirPath = path.dirname(skillFilePath);
      const relativeDirPath = normalizeSlashes(path.relative(root.rootPath, skillDirPath)) || path.basename(skillDirPath);

      let content = '';
      try {
        content = fs.readFileSync(skillFilePath, 'utf8');
      } catch {
        continue;
      }

      const baseName = normalizeSlashes(path.basename(skillDirPath));
      const title = firstHeading(content) || baseName;
      const description = firstParagraph(content);
      rawEntries.push({
        source: root.source,
        sourceLabel: root.sourceLabel,
        rootPath: root.rootPath,
        skillDirPath,
        skillFilePath,
        relativeDirPath,
        baseName,
        title,
        description,
      });
    }
  }

  const basenameCounts = rawEntries.reduce<Map<string, number>>((acc, entry) => {
    acc.set(entry.baseName.toLowerCase(), (acc.get(entry.baseName.toLowerCase()) || 0) + 1);
    return acc;
  }, new Map());

  return rawEntries
    .map((entry) => {
      const basenameKey = entry.baseName.toLowerCase();
      const slug = entry.relativeDirPath;
      const name = (basenameCounts.get(basenameKey) || 0) > 1 ? slug : entry.baseName;
      return {
        name,
        slug,
        title: entry.title,
        description: entry.description,
        source: entry.source,
        sourceLabel: entry.sourceLabel,
        rootPath: entry.rootPath,
        skillDirPath: entry.skillDirPath,
        skillFilePath: entry.skillFilePath,
        relativeDirPath: entry.relativeDirPath,
        aliases: buildSkillAliases(name, slug, entry.title),
      } satisfies DiscoveredSkill;
    })
    .sort((left, right) => {
      if (left.source !== right.source) return left.source === 'workspace' ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
}

function tokenizeQuery(query: string): string[] {
  return [...new Set(
    normalizeSkillQuery(query)
      .split(/[^a-zа-я0-9]+/i)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3),
  )];
}

export function searchAvailableSkillsSync(
  query: string,
  workspaceRoot?: string,
  limit = 6,
): SkillSearchMatch[] {
  const normalizedQuery = normalizeSkillQuery(query);
  if (!normalizedQuery) return [];

  const terms = tokenizeQuery(normalizedQuery);
  return listAvailableSkillsSync(workspaceRoot)
    .map((skill) => {
      const searchable = [skill.name, skill.slug, skill.title, skill.description, ...skill.aliases].join(' ').toLowerCase();
      let score = 0;
      const reasons = new Set<string>();
      const exact = skill.aliases.includes(normalizedQuery);

      if (exact) {
        score += 120;
        reasons.add('точное имя навыка');
      }

      for (const term of terms) {
        if (skill.name.toLowerCase() === term) {
          score += 40;
          reasons.add('имя навыка');
          continue;
        }
        if (skill.name.toLowerCase().includes(term)) {
          score += 20;
          reasons.add('имя навыка');
        }
        if (skill.slug.toLowerCase().includes(term)) {
          score += 18;
          reasons.add('путь навыка');
        }
        if (skill.title.toLowerCase().includes(term)) {
          score += 12;
          reasons.add('заголовок навыка');
        }
        if (skill.description.toLowerCase().includes(term)) {
          score += 10;
          reasons.add('описание навыка');
        }
      }

      if (score === 0 || !searchable) return null;

      if (/[$/]/.test(String(query || '').trim())) {
        score += 8;
      }
      if (skill.source === 'workspace') {
        score += 4;
      }
      return {
        skill,
        score,
        reasons: [...reasons].slice(0, 3),
        exact,
      } satisfies SkillSearchMatch;
    })
    .filter((item): item is SkillSearchMatch => !!item)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, Math.max(1, limit));
}

export function resolveSkillByNameSync(rawName: string, workspaceRoot?: string): {
  skill: DiscoveredSkill | null;
  suggestions: DiscoveredSkill[];
} {
  const normalized = normalizeSkillQuery(rawName);
  if (!normalized) {
    return { skill: null, suggestions: [] };
  }

  const skills = listAvailableSkillsSync(workspaceRoot);
  const exact = skills.filter((skill) => skill.aliases.includes(normalized));
  if (exact.length === 1) {
    return { skill: exact[0], suggestions: exact };
  }
  if (exact.length > 1) {
    const sorted = exact.sort((left, right) => {
      if (left.source !== right.source) return left.source === 'workspace' ? -1 : 1;
      return left.slug.length - right.slug.length;
    });
    return { skill: sorted[0], suggestions: sorted };
  }

  const suggestions = searchAvailableSkillsSync(normalized, workspaceRoot, 5).map((match) => match.skill);
  return { skill: null, suggestions };
}

export function readSkillContentSync(skill: DiscoveredSkill): string {
  return fs.readFileSync(skill.skillFilePath, 'utf8');
}
