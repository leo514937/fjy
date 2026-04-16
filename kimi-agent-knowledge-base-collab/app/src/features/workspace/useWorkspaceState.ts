import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  fetchHealth,
  fetchRoutes,
  deleteXgProject,
  fetchProbabilityReason,
  fetchXgDiff,
  fetchXgProjects,
  fetchXgRead,
  fetchXgTimelines,
  initXgProject,
  rollbackXgVersion,
  setOfficialRecommend,
  writeXgAndInfer,
  type ProbabilityResult,
  type XgProject,
  type XgTimeline,
} from '@/features/workspace/api';
import {
  pickSelectedFile,
  pickSelectedProjectId,
  syncEditorStateFromContent,
} from '@/features/workspace/state';

export function useWorkspaceState() {
  const [projects, setProjects] = useState<XgProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [timelines, setTimelines] = useState<XgTimeline[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [writeFilename, setWriteFilename] = useState('');
  const [writeData, setWriteData] = useState('');
  const [writeMessage, setWriteMessage] = useState('');
  const [writing, setWriting] = useState(false);
  const [probInput, setProbInput] = useState('');
  const [probResult, setProbResult] = useState<ProbabilityResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [newProjectId, setNewProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [diffData, setDiffData] = useState<unknown>(null);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState('');

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      void loadTimelines(selectedProjectId);
    }
  }, [selectedProjectId]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await fetchXgProjects();
      setProjects(data);
      setSelectedProjectId((current) => pickSelectedProjectId(data, current));
    } catch {
      toast.error('获取项目列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTimelines = async (projectId: string) => {
    try {
      const data = await fetchXgTimelines(projectId);
      setTimelines(data);
      const nextFile = pickSelectedFile(data, selectedFile);
      setSelectedFile(nextFile);
      if (nextFile) {
        await loadContent(projectId, nextFile);
      }
    } catch {
      // 保持与旧实现一致。
    }
  };

  const loadContent = async (projectId: string, filename: string) => {
    try {
      const data = await fetchXgRead(projectId, filename);
      setFileContent(data);
      const nextEditorState = syncEditorStateFromContent(filename, data);
      setWriteFilename(nextEditorState.writeFilename);
      setWriteData(nextEditorState.writeData);
    } catch {
      toast.error('读取内容失败');
    }
  };

  const handleWrite = async () => {
    if (!selectedProjectId || !writeFilename || !writeData) {
      toast.error('请填写完整信息');
      return;
    }

    setWriting(true);
    try {
      const activeTimeline = timelines.find((timeline) => timeline.filename === writeFilename);
      const commits = activeTimeline?.commits;
      const basevision = (commits && commits.length > 0) ? commits[commits.length - 1].versionId : 0;
      const result = await writeXgAndInfer({
        project_id: selectedProjectId,
        filename: writeFilename,
        data: JSON.parse(writeData),
        message: writeMessage || 'Web UI Update',
        agent_name: 'Web UI',
        committer_name: 'Web UI',
        basevision,
        inference_message: 'Web UI inference update',
        inference_agent_name: 'Web UI',
        inference_committer_name: 'Web UI',
      });
      toast.success(result.commit_id ? `写入成功: ${result.commit_id.slice(0, 7)}` : '写入成功');
      await loadTimelines(selectedProjectId);
      if (writeFilename) {
        setSelectedFile(writeFilename);
        await loadContent(selectedProjectId, writeFilename);
      }
    } catch (error) {
      toast.error('写入失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setWriting(false);
    }
  };

  const handleProbAnalysis = async () => {
    if (!probInput) {
      return;
    }

    setAnalyzing(true);
    try {
      const result = await fetchProbabilityReason(JSON.parse(probInput));
      setProbResult(result);
    } catch {
      toast.error('推理失败: JSON 格式错误');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRollback = async (commitId: string) => {
    if (!selectedProjectId) {
      return;
    }
    if (!confirm(`确定要回滚到版本 ${commitId.slice(0, 7)} 吗？这将生成一个新的补偿提交。`)) {
      return;
    }

    try {
      await rollbackXgVersion(selectedProjectId, commitId);
      toast.success('回滚成功');
      await loadTimelines(selectedProjectId);
      if (selectedFile) {
        await loadContent(selectedProjectId, selectedFile);
      }
    } catch (error) {
      toast.error('回滚失败: ' + (error instanceof Error ? error.message : '未知错误'));
    }
  };

  const handleInitProject = async () => {
    if (!newProjectId) {
      return;
    }

    try {
      await initXgProject({ project_id: newProjectId, name: newProjectName || newProjectId });
      toast.success('项目初始化完成');
      setIsNewProjectOpen(false);
      setNewProjectId('');
      setNewProjectName('');
      await loadProjects();
    } catch {
      toast.error('初始化失败');
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm(`确定要彻底删除项目 ${projectId} 吗？此操作不可撤销且会清除所有 Git 历史。`)) {
      return;
    }

    try {
      await deleteXgProject(projectId);
      toast.success('项目已成功删除');
      if (selectedProjectId === projectId) {
        setSelectedProjectId('');
      }
      await loadProjects();
    } catch {
      toast.error('删除项目失败');
    }
  };

  const handleSetOfficial = async (versionId: string) => {
    if (!selectedProjectId || !selectedFile) {
      return;
    }

    try {
      await setOfficialRecommend(selectedProjectId, selectedFile, versionId);
      toast.success('已设置为官方推荐版本');
    } catch {
      toast.error('设置失败');
    }
  };

  const handleViewDiff = async (baseId: string) => {
    if (!selectedProjectId || !selectedFile) {
      return;
    }

    setCompareTarget(baseId);
    try {
      const data = await fetchXgDiff(selectedProjectId, selectedFile, baseId, 'HEAD');
      setDiffData(data);
      setIsDiffOpen(true);
    } catch {
      toast.error('获取差异失败');
    }
  };

  return {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    timelines,
    selectedFile,
    setSelectedFile,
    fileContent,
    loading,
    writeFilename,
    setWriteFilename,
    writeData,
    setWriteData,
    writeMessage,
    setWriteMessage,
    writing,
    probInput,
    setProbInput,
    probResult,
    analyzing,
    newProjectId,
    setNewProjectId,
    newProjectName,
    setNewProjectName,
    isNewProjectOpen,
    setIsNewProjectOpen,
    diffData,
    isDiffOpen,
    setIsDiffOpen,
    compareTarget,
    loadProjects,
    loadContent,
    handleWrite,
    handleProbAnalysis,
    handleRollback,
    handleInitProject,
    handleSetOfficial,
    handleViewDiff,
    handleDeleteProject,
  };
}

