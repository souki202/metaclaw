import fs from 'fs';
import path from 'path';

export class QuickMemory {
  private filePath: string;

  constructor(workspace: string, filename: string = 'MEMORY.md') {
    this.filePath = path.join(workspace, filename);
  }

  read(): string {
    if (!fs.existsSync(this.filePath)) return '';
    return fs.readFileSync(this.filePath, 'utf-8');
  }

  write(content: string) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, content, 'utf-8');
  }

  append(text: string) {
    const existing = this.read();
    const timestamp = new Date().toISOString().slice(0, 10);
    const newContent = existing
      ? `${existing.trimEnd()}\n\n---\n_${timestamp}_\n${text.trim()}\n`
      : `${text.trim()}\n`;
    this.write(newContent);
  }
}

export class WorkspaceFiles {
  constructor(private workspace: string) {}

  read(filename: string): string {
    const p = path.join(this.workspace, filename);
    if (!fs.existsSync(p)) return '';
    return fs.readFileSync(p, 'utf-8');
  }

  write(filename: string, content: string) {
    const p = path.join(this.workspace, filename);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf-8');
  }

  exists(filename: string): boolean {
    return fs.existsSync(path.join(this.workspace, filename));
  }
}
