import { OntologyAssistant } from '@/components/OntologyAssistant';
import type { ConversationExecutionStage, ConversationSession } from '@/components/assistant/types';

interface AssistantPageProps {
  activeSession: ConversationSession | null;
  businessPrompt: string;
  executionStages: ConversationExecutionStage[];
  isBusy: boolean;
  modelName: string;
  onAsk: (question?: string) => void;
  onBusinessPromptChange: (value: string) => void;
  onDraftChange: (value: string) => void;
  onModelNameChange: (value: string) => void;
  onUploadFile: (file: File) => Promise<void>;
  onStop: () => void;
  selectedEntityName?: string;
}

export function AssistantPage(props: AssistantPageProps) {
  return (
    <div className="h-full w-full overflow-hidden">
      <OntologyAssistant {...props} />
    </div>
  );
}
