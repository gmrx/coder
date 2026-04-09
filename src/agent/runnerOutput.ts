import { stripJsonBlocks } from './prompt';

export function requiresMermaidDiagram(query: string): boolean {
  const value = (query || '').toLowerCase();
  return /схем|diagram|mermaid|нарис|service map|architecture diagram|flow/.test(value);
}

export function cleanupFinalAnswer(text: string, needMermaid: boolean): string {
  let output = stripJsonBlocks(text || '').trim();

  output = output
    .replace(/\n[“"]?(format|reasoning|tool|args)[”"]?\s*:\s*[\s\S]*$/i, '')
    .replace(/\n\}\s*$/g, '')
    .trim();

  if (needMermaid) {
    if (!/```mermaid/i.test(output) && /\nmermaid\s*\n/i.test(output)) {
      output = output.replace(/\nmermaid\s*\n/i, '\n```mermaid\n');
      const tail = output.split(/```mermaid/i)[1] || '';
      if (!/```/.test(tail)) output += '\n```';
    }

    if (!/```mermaid/i.test(output) && /(sequenceDiagram|flowchart|graph\s+[A-Z]|classDiagram|erDiagram|stateDiagram|journey|gantt|pie|mindmap|timeline)/i.test(output)) {
      const lines = output.split('\n');
      const diagramStart = lines.findIndex((line) => /(sequenceDiagram|flowchart|graph\s+[A-Z]|classDiagram|erDiagram|stateDiagram|journey|gantt|pie|mindmap|timeline)/i.test(line));
      if (diagramStart >= 0) {
        const head = lines.slice(0, diagramStart).join('\n').trimEnd();
        const body = lines.slice(diagramStart).join('\n').trim();
        output = `${head}\n\n\`\`\`mermaid\n${body}\n\`\`\``.trim();
      }
    }
  }

  return output;
}
