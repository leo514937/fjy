export type WorkflowV2StageDefinition = {
  key: string;
  short: string;
  title: string;
  detail: string;
  retryable: boolean;
  entryCriteria: string[];
  exitCriteria: string[];
};

export declare const WORKFLOW_V2_STAGE_DEFINITIONS: readonly WorkflowV2StageDefinition[];
export declare const WORKFLOW_V2_STAGE_KEYS: readonly string[];
export declare function getWorkflowV2StageDefinition(stageKey: string): WorkflowV2StageDefinition | null;
