export type I18nText = Record<string, string>;

export type CurriculumMode =
  | 'interpretive_listening'
  | 'interpersonal_speaking'
  | 'presentational_speaking';

export type SupportDomain =
  | 'comprehension'
  | 'comprehensibility'
  | 'vocabulary_usage'
  | 'language_control'
  | 'communication_strategies'
  | 'cultural_awareness';

export interface SourceRef {
  docId: string;
  locator: string;
  unitNumber?: number;
  section?: string;
  notes?: string;
}

export interface Unit {
  id: string;
  title: I18nText;
  ap: {
    unitNumber: number;
    title: string;
    primaryTheme?: string;
  };
  essentialQuestions: I18nText[];
  contextTags: string[];
  moduleIds: string[];
  sourceRefs: SourceRef[];
}

export interface SituationSeedConstraints {
  timeLimitSec?: number;
  minTurns?: number;
  maxTurns?: number;
  maxReplays?: number;
}

export interface SituationSeed {
  setting: string;
  roles: string[];
  contextTags: string[];
  register: 'informal' | 'formal' | 'mixed';
  constraints?: SituationSeedConstraints;
  notes?: string;
}

export interface Situation {
  id: string;
  kind: CurriculumMode;
  seed: SituationSeed;
  objectiveIds: string[];
}

export interface SupportTarget {
  id: string;
  label: I18nText;
  notes?: string;
  examples?: string[];
}

export interface ModuleSupportTargets {
  comprehension: SupportTarget[];
  comprehensibility: SupportTarget[];
  vocabulary_usage: SupportTarget[];
  language_control: SupportTarget[];
  communication_strategies: SupportTarget[];
  cultural_awareness: SupportTarget[];
}

export interface Capstone {
  mode: CurriculumMode;
  taskModel: string;
  situationId: string;
}

export interface Module {
  id: string;
  unitId: string;
  title: I18nText;
  moduleGoal: I18nText;
  capstone?: Capstone;
  situations: {
    interpretive_listening: Situation[];
    interpersonal_speaking: Situation[];
    presentational_speaking: Situation[];
  };
  supportTargets: ModuleSupportTargets;
  objectiveIds: string[];
  sourceRefs: SourceRef[];
}

export interface Objective {
  id: string;
  unitId: string;
  moduleId: string;
  mode: CurriculumMode;
  canDo: I18nText;
  contextTags: string[];
  communicativeFunctions: string[];
  discourseMoves: string[];
  foundationDomains: SupportDomain[];
  register: 'informal' | 'formal' | 'mixed';
  mastery: {
    rubricId: string;
    threshold: number;
  };
  evidenceModel: {
    taskModel: string;
    timeLimitSec?: number;
    minTurns?: number;
  };
  templateRefs: string[];
  sourceRefs: SourceRef[];
}

export interface ActivityTemplateDefinition {
  id: string;
  title: I18nText;
  mode: CurriculumMode | string;
  assistantRole: string;
  interactionPattern: {
    openingMoves: string[];
    sustainMoves: string[];
    closingMoves: string[];
    completionRule: string;
  };
  promptCues: string[];
}

export interface CurriculumPackageV1 {
  schemaVersion: 'lingual.curriculum_package.v1';
  curriculum: {
    id: string;
    title: I18nText;
    learningLocale: string;
    levelBand: string;
    version: string;
    createdAt: string;
    source: {
      type: 'import' | 'native';
      name: string;
      effective: string;
      docIds: string[];
    };
    license: {
      owner: string;
      notes: string;
    };
    sortOrder?: number;
  };
  taxonomies: {
    contextTags: string[];
    communicativeFunctions: string[];
    discourseMoves: string[];
    taskModels: string[];
    foundationDomains: SupportDomain[];
  };
  rubrics: Array<{
    id: string;
    title: I18nText;
    scale: { min: number; max: number; step?: number };
    dimensions: Array<{
      id: string;
      title: I18nText;
      description: I18nText;
    }>;
    notes?: string;
  }>;
  units: Unit[];
  modules: Module[];
  objectives: Objective[];
  templates: {
    activityTemplateIds: string[];
    activityTemplates: ActivityTemplateDefinition[];
  };
  glossary?: Record<string, unknown>;
}
