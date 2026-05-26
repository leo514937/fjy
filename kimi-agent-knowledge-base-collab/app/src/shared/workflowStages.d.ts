export type WorkflowStageDefinition = {
  key: string;
  short: string;
  title: string;
  detail: string;
  retryable: boolean;
  entryCriteria: string[];
  exitCriteria: string[];
};

export declare const WORKFLOW_STAGE_DEFINITIONS: readonly WorkflowStageDefinition[];
export declare const WORKFLOW_STAGE_KEYS: readonly string[];
export declare function getWorkflowStageDefinition(stageKey: string): WorkflowStageDefinition | null;
