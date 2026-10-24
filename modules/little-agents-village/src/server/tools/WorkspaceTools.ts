import { readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const LIST_INPUT = z.object({ directory: z.string().default('src') });
const READ_INPUT = z.object({ path: z.string().min(1).max(300) });
const root = path.resolve(process.cwd(), 'modules/little-agents-village');
const allowed = new Set(['.ts', '.tsx', '.css', '.md']);

async function safePath(relative: string) {
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Path outside authorized workspace.');
  const actual = await realpath(target);
  if (actual !== root && !actual.startsWith(`${root}${path.sep}`)) throw new Error('Symlink escaped authorized workspace.');
  if (actual.split(path.sep).some((segment) => segment.startsWith('.') || segment === 'node_modules')) {
    throw new Error('Hidden paths and dependencies are not accessible.');
  }
  return actual;
}

export async function listWorkspaceFiles(input: unknown) {
  const { directory } = LIST_INPUT.parse(input);
  const target = await safePath(directory);
  const files: string[] = [];
  async function walk(current: string, depth: number): Promise<void> {
    if (depth > 4 || files.length >= 100) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolute = path.join(current, entry.name);
      if (entry.isFile() && allowed.has(path.extname(entry.name))) files.push(path.relative(root, absolute));
      else if (entry.isDirectory()) await walk(absolute, depth + 1);
      if (files.length >= 100) break;
    }
  }
  await walk(target, 0);
  return files.sort();
}

export async function readWorkspaceFile(input: unknown) {
  const { path: relative } = READ_INPUT.parse(input);
  const target = await safePath(relative);
  if (!allowed.has(path.extname(target))) throw new Error('File type is not readable.');
  const content = await readFile(target, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > 64 * 1024) throw new Error('File exceeds 64 KB read limit.');
  return { path: relative, content };
}

export const workspaceToolPermissions = {
  mochi: ['list_workspace_files'],
  luna: ['list_workspace_files'],
  foxy: ['list_workspace_files', 'read_workspace_file'],
  pip: ['list_workspace_files', 'read_workspace_file'],
  bobo: ['list_workspace_files', 'read_workspace_file'],
  ollie: ['list_workspace_files', 'read_workspace_file'],
} as const;

export const workspaceToolDefinitions = {
  list_workspace_files: {
    description: 'List authorized source files under a workspace directory.',
    parameters: { type: 'object', properties: { directory: { type: 'string', default: 'src' } }, additionalProperties: false },
  },
  read_workspace_file: {
    description: 'Read one authorized source, TypeScript, CSS, or Markdown file.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
  },
} as const;

export async function executeWorkspaceTool(name: string, input: unknown, allowedTools: readonly string[]) {
  if (!allowedTools.includes(name)) throw new Error(`Tool is not authorized for this agent: ${name}`);
  if (name === 'list_workspace_files') return listWorkspaceFiles(input);
  if (name === 'read_workspace_file') return readWorkspaceFile(input);
  throw new Error(`Unknown workspace tool: ${name}`);
}
