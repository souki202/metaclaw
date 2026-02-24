/**
 * Experience-Driven Lifelong Learning (ELL) Types
 *
 * Defines types for experience analysis, skill abstraction, and knowledge internalization.
 */

/**
 * Experience entry extracted from history
 */
export interface Experience {
  id: string;
  sessionId: string;
  timestamp: string;
  type: 'task_completion' | 'tool_use' | 'problem_solving' | 'error_recovery';
  context: string;
  actions: Action[];
  outcome: Outcome;
  duration: number; // milliseconds
}

/**
 * Action taken during an experience
 */
export interface Action {
  toolName: string;
  arguments: Record<string, unknown>;
  result: {
    success: boolean;
    output: string;
  };
}

/**
 * Outcome of an experience
 */
export interface Outcome {
  success: boolean;
  summary: string;
  errorType?: string;
  errorResolution?: string;
}

/**
 * Abstracted skill created from experiences
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  category: 'automation' | 'problem_solving' | 'data_processing' | 'research' | 'communication';
  sourceExperiences: string[]; // Experience IDs
  pattern: SkillPattern;
  effectiveness: SkillEffectiveness;
  usage: SkillUsage;
  createdAt: string;
  lastUsedAt?: string;
  version: number;
}

/**
 * Pattern extracted from experiences
 */
export interface SkillPattern {
  trigger: TriggerCondition;
  actions: ActionTemplate[];
  expectedOutcome: string;
  prerequisites?: string[];
  warnings?: string[];
}

/**
 * Trigger condition for a skill
 */
export interface TriggerCondition {
  type: 'task_keyword' | 'context_match' | 'error_pattern' | 'manual';
  pattern: string | RegExp;
  examples: string[];
}

/**
 * Action template for skill execution
 */
export interface ActionTemplate {
  toolName: string;
  argumentsTemplate: Record<string, string>; // Variables use {{variable}} syntax
  description: string;
}

/**
 * Skill effectiveness metrics
 */
export interface SkillEffectiveness {
  totalUses: number;
  successfulUses: number;
  failedUses: number;
  averageDuration: number;
  successRate: number; // 0-1
  confidence: number; // 0-1, based on usage count and success rate
}

/**
 * Skill usage tracking
 */
export interface SkillUsage {
  contexts: string[]; // Contexts where skill was successfully applied
  commonParameters: Record<string, unknown>;
  lastParameters?: Record<string, unknown>;
}

/**
 * Experience cluster - grouped similar experiences
 */
export interface ExperienceCluster {
  id: string;
  centroid: string; // Representative description
  experiences: string[]; // Experience IDs
  similarity: number; // 0-1, average similarity within cluster
  pattern: string; // Common pattern description
}

/**
 * ELL State for a session
 */
export interface ELLState {
  sessionId: string;
  enabled: boolean;
  lastAnalysisAt?: string;
  experiences: Experience[];
  skills: Skill[];
  clusters: ExperienceCluster[];
  metrics: ELLMetrics;
}

/**
 * ELL Metrics
 */
export interface ELLMetrics {
  totalExperiences: number;
  totalSkills: number;
  skillsUsed: number;
  averageSkillEffectiveness: number;
  experiencesAnalyzed: number;
  knowledgeInternalized: number; // Count of internalized patterns
}

/**
 * ELL Configuration
 */
export interface ELLConfig {
  enabled: boolean;
  minSuccessThreshold: number; // Minimum successes before creating skill (default: 3)
  analyzeInterval: number; // Hours between analyses
  maxExperiencesPerAnalysis: number; // Limit processing
  minSimilarityForClustering: number; // 0-1, threshold for grouping experiences
  autoGenerateSkills: boolean; // Automatically create skills from patterns
}

/**
 * Skill generation request
 */
export interface SkillGenerationRequest {
  experiences: Experience[];
  suggestedName?: string;
  suggestedCategory?: Skill['category'];
}

/**
 * Skill file format (saved as SKILL.md)
 */
export interface SkillFile {
  name: string;
  description: string;
  instructions: string; // Markdown formatted
  metadata: {
    skillId: string;
    version: number;
    createdAt: string;
    effectiveness: SkillEffectiveness;
  };
}
