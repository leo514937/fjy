import { WorkspaceDashboard } from '@/features/workspace/WorkspaceDashboard';
import { useWorkspaceState } from '@/features/workspace/useWorkspaceState';

export function XiaoGuGitDashboard() {
  const workspace = useWorkspaceState();
  return <WorkspaceDashboard workspace={workspace} />;
}
