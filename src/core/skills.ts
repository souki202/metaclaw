import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';

const log = createLogger('skills');

export interface Skill {
  name: string;
  description: string;
  instructions: string;
  source: string;
}

/**
 * Parses a SKILL.md file to extract the YAML frontmatter and the markdown instructions.
 */
function parseSkillFile(filePath: string, content: string): Skill | null {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  
  if (!frontmatterMatch) {
    // Try to find raw name/description if there's no strict frontmatter
    return null;
  }

  const yamlPart = frontmatterMatch[1];
  const instructions = frontmatterMatch[2].trim();

  let name = '';
  let description = '';

  for (const line of yamlPart.split('\n')) {
    const nMatch = line.match(/^name:\s*(.*?)\s*$/);
    if (nMatch) name = nMatch[1];
    
    const dMatch = line.match(/^description:\s*(.*?)\s*$/);
    if (dMatch) description = dMatch[1];
  }

  if (!name) return null;

  return {
    name,
    description,
    instructions,
    source: filePath
  };
}

/**
 * Synchronously crawls a directory up to `maxDepth` looking for SKILL.md files.
 */
function findSkillFiles(dir: string, currentDepth: number, maxDepth: number, files: string[] = []) {
  if (currentDepth > maxDepth) return files;
  if (!fs.existsSync(dir)) return files;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          findSkillFiles(fullPath, currentDepth + 1, maxDepth, files);
        } else if (stat.isFile() && entry.name.toUpperCase() === 'SKILL.MD') {
          files.push(fullPath);
        }
      } catch (e) {
        // Ignore stat errors (e.g., broken symlinks)
      }
    }
  } catch (e) {
    // Ignore permissions errors etc.
  }
  return files;
}

/**
 * Discovers and loads skills from common agent directories.
 */
export function loadSkills(baseDirs: string[]): Skill[] {
  const loadedSkills: Skill[] = [];
  const processedFiles = new Set<string>();

  for (const base of baseDirs) {
    // Look in common agent skill locations
    const searchPaths = [
      path.join(base, '.agents', 'skills'),
      path.join(base, 'skills'),
      path.join(base, '.agent', 'skills'),
      path.join(base, '.claude', 'skills')
    ];

    for (const sp of searchPaths) {
      if (!fs.existsSync(sp)) continue;

      const skillFiles = findSkillFiles(sp, 0, 3); // max depth 3
      for (const file of skillFiles) {
        if (processedFiles.has(file)) continue;
        processedFiles.add(file);

        try {
          const content = fs.readFileSync(file, 'utf-8');
          const skill = parseSkillFile(file, content);
          if (skill) {
            loadedSkills.push(skill);
            log.info(`Loaded skill "${skill.name}" from ${file}`);
          }
        } catch (e) {
          log.warn(`Failed to read skill file ${file}:`, e);
        }
      }
    }
  }

  // Deduplicate by name (later loaded overrides earlier if they share a name)
  const uniqueSkills = new Map<string, Skill>();
  for (const s of loadedSkills) {
    uniqueSkills.set(s.name, s);
  }

  return Array.from(uniqueSkills.values());
}

/**
 * Returns a formatted prompt string representing all loaded skills.
 */
export function buildSkillsPromptText(baseDirs: string[]): string {
  const skills = loadSkills(baseDirs);
  if (skills.length === 0) return '';

  let text = `## Enhanced Action Skills\nYou have the following specialized skills available to you. Follow these instructions when you recognize a relevant task:\n\n`;

  for (const skill of skills) {
    text += `### Skill: ${skill.name}\n`;
    if (skill.description) {
      text += `**Description:** ${skill.description}\n\n`;
    }
    text += `**Instructions:**\n${skill.instructions}\n\n---\n\n`;
  }

  return text.trim();
}
