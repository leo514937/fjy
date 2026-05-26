import { FileContentPanel } from '@/features/workspace/components/FileContentPanel';
import { FileListPanel } from '@/features/workspace/components/FileListPanel';
import { GraphIngestPanel } from '@/features/workspace/components/GraphIngestPanel';
import { ProbabilityPanel } from '@/features/workspace/components/ProbabilityPanel';
import { ProjectListPanel } from '@/features/workspace/components/ProjectListPanel';
import { RecommendationPanel } from '@/features/workspace/components/RecommendationPanel';
import { TimelinePanel } from '@/features/workspace/components/TimelinePanel';
import { DiffDialog } from '@/features/workspace/components/DiffDialog';
import type { WorkspaceState } from '@/features/workspace/useWorkspaceState';

interface WorkspaceDashboardProps {
  workspace: WorkspaceState;
}

export function WorkspaceDashboard({ workspace }: WorkspaceDashboardProps) {

  const handleSelectFile = async (filename: string) => {
    workspace.setSelectedFile(filename);
    await workspace.loadContent(workspace.selectedProjectId, filename);
  };

  const handleSourceCommitted = async (projectId: string, filename: string) => {
    if (projectId !== workspace.selectedProjectId) {
      workspace.handleSelectProject(projectId);
      workspace.setSelectedFile(filename);
      return;
    }

    workspace.setSelectedFile(filename);
    await workspace.loadTimelines(projectId);
  };

  return (
    <div className="space-y-6">
      {workspace.errorMessage && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {workspace.errorMessage}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-3 flex flex-col space-y-6">
          <ProjectListPanel
            className="h-[600px]"
            projects={workspace.projects}
            selectedProjectId={workspace.selectedProjectId}
            loading={workspace.loading}
            switchingProjectId={workspace.switchingProject ? workspace.selectedProjectId : undefined}
            newProjectId={workspace.newProjectId}
            newProjectName={workspace.newProjectName}
            isNewProjectOpen={workspace.isNewProjectOpen}
            onSelectProject={workspace.handleSelectProject}
            onRefresh={workspace.loadProjects}
            onDeleteProject={workspace.handleDeleteProject}
            onRenameProject={workspace.handleRenameProject}
          />
          <FileListPanel 
            className="h-[545px]" 
            timelines={workspace.timelines} 
            selectedFile={workspace.selectedFile} 
            loading={workspace.switchingProject}
            onSelectFile={handleSelectFile} 
            fileSearch={workspace.fileSearch}
            onSearchChange={workspace.setFileSearch}
          />
        </div>
        <div className="lg:col-span-9 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <FileContentPanel 
              selectedFile={workspace.selectedFile} 
              fileContent={workspace.fileContent} 
              loading={workspace.switchingProject || workspace.loadingContent}
              onRefresh={() => workspace.loadContent(workspace.selectedProjectId, workspace.selectedFile)} 
              onNavigate={workspace.setFileSearch}
            />
            <GraphIngestPanel selectedProjectId={workspace.selectedProjectId} onSourceCommitted={handleSourceCommitted} />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <TimelinePanel selectedFile={workspace.selectedFile} timelines={workspace.timelines} loading={workspace.switchingProject} onViewDiff={workspace.handleViewDiff} onSetOfficial={workspace.handleSetOfficial} onRollback={workspace.handleRollback} />
            <ProbabilityPanel probInput={workspace.probInput} setProbInput={workspace.setProbInput} probResult={workspace.probResult} analyzing={workspace.analyzing} onAnalyze={workspace.handleProbAnalysis} />
          </div>
          <RecommendationPanel />
        </div>
      </div>
      <DiffDialog open={workspace.isDiffOpen} onOpenChange={workspace.setIsDiffOpen} diffData={workspace.diffData} compareTarget={workspace.compareTarget} />
    </div>
  );
}
