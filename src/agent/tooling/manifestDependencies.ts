import * as path from 'path';

export type ManifestDependencyEntry = {
  name: string;
  version: string;
};

export function extractManifestDependencies(filePath: string, text: string): ManifestDependencyEntry[] {
  const fileName = path.basename(filePath).toLowerCase();

  if (fileName === 'requirements.txt' || fileName.endsWith('.txt')) {
    return parseRequirementsLike(text);
  }
  if (fileName === 'go.mod') {
    return parseGoModDependencies(text);
  }
  if (fileName === 'cargo.toml') {
    return parseCargoDependencies(text);
  }
  if (fileName === 'pyproject.toml') {
    return parsePyprojectDependencies(text);
  }
  if (fileName.endsWith('.json')) {
    return parseJsonDependencies(text);
  }
  if (fileName.endsWith('.toml')) {
    return parseGenericTomlDependencies(text);
  }

  return [];
}

function parseJsonDependencies(text: string): ManifestDependencyEntry[] {
  const data = safeParseJson(text);
  if (!data || typeof data !== 'object') return [];

  const rootPackage = data?.packages?.[''] && typeof data.packages[''] === 'object'
    ? data.packages['']
    : null;

  return collectDependencyEntries([
    data?.dependencies,
    data?.devDependencies,
    data?.peerDependencies,
    data?.optionalDependencies,
    rootPackage?.dependencies,
    rootPackage?.devDependencies,
    rootPackage?.peerDependencies,
    rootPackage?.optionalDependencies,
  ]);
}

function parseRequirementsLike(text: string): ManifestDependencyEntry[] {
  const entries: ManifestDependencyEntry[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('-r ') || line.startsWith('--')) continue;

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*(?:([<>=!~]{1,3})\s*(.+))?$/);
    if (!match) continue;
    const name = match[1];
    const version = match[2] && match[3] ? `${match[2]} ${match[3].trim()}` : 'declared';
    entries.push({ name, version });
  }
  return dedupeEntries(entries);
}

function parseGoModDependencies(text: string): ManifestDependencyEntry[] {
  const entries: ManifestDependencyEntry[] = [];
  const blockMatch = text.match(/^\s*require\s*\(([\s\S]*?)^\s*\)/m);
  if (blockMatch) {
    for (const rawLine of blockMatch[1].split('\n')) {
      const line = stripInlineComment(rawLine).trim();
      if (!line) continue;
      const match = line.match(/^([^\s]+)\s+([^\s]+)$/);
      if (match) {
        entries.push({ name: match[1], version: match[2] });
      }
    }
  }

  for (const rawLine of text.split('\n')) {
    const line = stripInlineComment(rawLine).trim();
    const match = line.match(/^require\s+([^\s]+)\s+([^\s]+)$/);
    if (match) {
      entries.push({ name: match[1], version: match[2] });
    }
  }

  return dedupeEntries(entries);
}

function parseCargoDependencies(text: string): ManifestDependencyEntry[] {
  const entries = [
    ...parseTomlSectionAssignments(text, 'dependencies'),
    ...parseTomlSectionAssignments(text, 'dev-dependencies'),
    ...parseTomlSectionAssignments(text, 'build-dependencies'),
    ...parseTomlSectionAssignments(text, 'workspace.dependencies'),
  ];
  return dedupeEntries(entries);
}

function parsePyprojectDependencies(text: string): ManifestDependencyEntry[] {
  const entries = [
    ...parseTomlArrayDependencySection(text, 'project', 'dependencies'),
    ...parseTomlSectionAssignments(text, 'tool.poetry.dependencies', ['python']),
  ];
  return dedupeEntries(entries);
}

function parseGenericTomlDependencies(text: string): ManifestDependencyEntry[] {
  const entries = [
    ...parseTomlSectionAssignments(text, 'dependencies'),
    ...parseTomlSectionAssignments(text, 'dev-dependencies'),
  ];
  return dedupeEntries(entries);
}

function parseTomlSectionAssignments(
  text: string,
  sectionName: string,
  skipKeys: string[] = [],
): ManifestDependencyEntry[] {
  const body = getTomlSectionBody(text, sectionName);
  if (!body) return [];

  const skipped = new Set(skipKeys.map((value) => value.toLowerCase()));
  const entries: ManifestDependencyEntry[] = [];
  for (const rawLine of body.split('\n')) {
    const line = stripInlineComment(rawLine).trim();
    if (!line || !line.includes('=')) continue;

    const match = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!match) continue;

    const name = match[1];
    if (skipped.has(name.toLowerCase())) continue;
    const version = extractTomlVersion(match[2]);
    entries.push({ name, version });
  }
  return entries;
}

function parseTomlArrayDependencySection(
  text: string,
  sectionName: string,
  key: string,
): ManifestDependencyEntry[] {
  const body = getTomlSectionBody(text, sectionName);
  if (!body) return [];

  const match = body.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm'));
  if (!match) return [];

  const entries: ManifestDependencyEntry[] = [];
  const itemPattern = /["']([^"']+)["']/g;
  for (const item of match[1].matchAll(itemPattern)) {
    const value = item[1].trim();
    if (!value) continue;
    const parsed = parseDependencySpec(value);
    entries.push(parsed);
  }
  return entries;
}

function getTomlSectionBody(text: string, sectionName: string): string | null {
  const lines = text.split('\n');
  let inSection = false;
  const body: string[] = [];

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      if (sectionMatch[1].trim() === sectionName) {
        inSection = true;
        continue;
      }
      if (inSection) break;
    }

    if (inSection) {
      body.push(line);
    }
  }

  return inSection ? body.join('\n') : null;
}

function parseDependencySpec(value: string): ManifestDependencyEntry {
  const match = value.match(/^([A-Za-z0-9_.-]+)\s*(.*)$/);
  if (!match) {
    return { name: value, version: 'declared' };
  }
  const version = match[2].trim();
  return {
    name: match[1],
    version: version || 'declared',
  };
}

function extractTomlVersion(rawValue: string): string {
  const value = rawValue.trim();

  const quoted = value.match(/^["']([^"']+)["']$/);
  if (quoted) return quoted[1];

  const versionMatch = value.match(/version\s*=\s*["']([^"']+)["']/);
  if (versionMatch) return versionMatch[1];

  if (/^\{.*\}$/.test(value)) return 'declared';
  return value || 'declared';
}

function collectDependencyEntries(values: unknown[]): ManifestDependencyEntry[] {
  const entries: ManifestDependencyEntry[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    for (const [name, version] of Object.entries(value as Record<string, unknown>)) {
      entries.push({ name, version: String(version) });
    }
  }
  return dedupeEntries(entries);
}

function dedupeEntries(entries: ManifestDependencyEntry[]): ManifestDependencyEntry[] {
  const deduped = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.name) continue;
    if (!deduped.has(entry.name)) {
      deduped.set(entry.name, entry.version || 'declared');
    }
  }
  return [...deduped.entries()]
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function stripInlineComment(line: string): string {
  return line.replace(/\s+#.*$/, '').replace(/\s+\/\/.*$/, '');
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(stripJsonComments(text));
  } catch {
    return null;
  }
}

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,\s*([}\]])/g, '$1');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
