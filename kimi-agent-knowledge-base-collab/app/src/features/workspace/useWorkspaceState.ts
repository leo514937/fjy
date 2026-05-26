import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import {
  fetchProbabilityReason,
  fetchXgDiff,
  fetchXgProjects,
  fetchXgRead,
  fetchXgTimelines,
  initXgProject,
  rollbackXgVersion,
  setOfficialRecommend,
  softDeleteXgProject,
  updateXgProjectName,
  writeXgAndInfer,
  type ProbabilityResult,
  type XgProject,
  type XgTimeline,
} from '@/features/workspace/api';
import { formatWorkspaceError } from '@/features/workspace/errors';
import { subscribeRepositorySync } from '@/shared/events/repositorySync';
import {
  pickSelectedFile,
  pickSelectedProjectId,
  syncEditorStateFromContent,
} from '@/features/workspace/state';
import { getStoredSelectedProjectId, setStoredSelectedProjectId, subscribeSelectedProjectIdChange } from '@/features/workspace/selectedProject';

interface LoadTimelinesOptions {
  switchRequestId?: number;
}

interface LoadContentOptions {
  switchRequestId?: number;
}

export function useWorkspaceState() {
  const [projects, setProjects] = useState<XgProject[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<string>(getStoredSelectedProjectId);
  const [timelines, setTimelines] = useState<XgTimeline[]>([]);
  const [selectedFile, setSelectedFileState] = useState<string>('');
  const [fileContent, setFileContent] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
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
  const [fileSearch, setFileSearch] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const selectedProjectIdRef = useRef('');
  const selectedFileRef = useRef('');
  const projectSwitchRequestRef = useRef(0);
  const timelineRequestRef = useRef(0);
  const contentRequestRef = useRef(0);

  useEffect(() => {
    void loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      const switchRequestId = ++projectSwitchRequestRef.current;
      void loadTimelines(selectedProjectId, { switchRequestId });
    }
  }, [selectedProjectId]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) {
      setStoredSelectedProjectId(selectedProjectId);
    }
  }, [selectedProjectId]);

  useEffect(() => subscribeSelectedProjectIdChange((projectId) => {
    selectedProjectIdRef.current = projectId;
    setSelectedProjectIdState(projectId);
  }), []);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  const setSelectedProjectId = (projectId: string) => {
    const nextProjectId = projectId.trim();
    selectedProjectIdRef.current = nextProjectId;
    setSelectedProjectIdState(nextProjectId);
  };

  const setSelectedFile = (filename: string) => {
    selectedFileRef.current = filename;
    setSelectedFileState(filename);
  };

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await fetchXgProjects();
      const nextProjectId = pickSelectedProjectId(
        data,
        selectedProjectIdRef.current || getStoredSelectedProjectId(),
      );
      setProjects(data);
      selectedProjectIdRef.current = nextProjectId;
      setSelectedProjectIdState(nextProjectId);
      setErrorMessage('');
    } catch (error) {
      const message = formatWorkspaceError(
        error,
        '获取项目列表失败',
        '常见原因：demo 项目未初始化，或网关/下游服务暂时不可用',
      );
      setErrorMessage(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const loadTimelines = async (projectId: string, options: LoadTimelinesOptions = {}) => {
    const requestId = ++timelineRequestRef.current;
    const isProjectSwitch = typeof options.switchRequestId === 'number';
    const isCurrentProject = projectId === selectedProjectIdRef.current;

    if (isProjectSwitch || isCurrentProject) {
      setSwitchingProject(true);
    }

    try {
      const data = await fetchXgTimelines(projectId);
      if (requestId !== timelineRequestRef.current) {
        return;
      }

      if (typeof options.switchRequestId === 'number' && options.switchRequestId !== projectSwitchRequestRef.current) {
        return;
      }

      if (projectId !== selectedProjectIdRef.current) {
        return;
      }

      setTimelines(data);
      setErrorMessage('');
      const nextFile = pickSelectedFile(data, selectedFileRef.current);
      setSelectedFile(nextFile);
      if (nextFile) {
        await loadContent(projectId, nextFile, options);
        return;
      }

      setFileContent(null);
      setWriteFilename('');
      setWriteData('');
      setLoadingContent(false);
      setSwitchingProject(false);
    } catch (error) {
      if (requestId !== timelineRequestRef.current) {
        return;
      }

      if (typeof options.switchRequestId === 'number' && options.switchRequestId !== projectSwitchRequestRef.current) {
        return;
      }

      if (projectId !== selectedProjectIdRef.current) {
        return;
      }

      const message = formatWorkspaceError(
        error,
        '加载项目时间线失败',
        '请确认项目已初始化，且仓库可正常访问',
      );
      setErrorMessage(message);
      setTimelines([]);
      setSelectedFile('');
      setFileContent(null);
      setLoadingContent(false);
      toast.error(message);
    } finally {
      if (
        requestId === timelineRequestRef.current
        && projectId === selectedProjectIdRef.current
        && (!options.switchRequestId || options.switchRequestId === projectSwitchRequestRef.current)
      ) {
        setSwitchingProject(false);
      }
    }
  };

  const loadContent = async (projectId: string, filename: string, options: LoadContentOptions = {}) => {
    const requestId = ++contentRequestRef.current;
    setLoadingContent(true);

    try {
      const data = await fetchXgRead(projectId, filename);
      if (requestId !== contentRequestRef.current) {
        return;
      }

      if (typeof options.switchRequestId === 'number' && options.switchRequestId !== projectSwitchRequestRef.current) {
        return;
      }

      if (projectId !== selectedProjectIdRef.current || filename !== selectedFileRef.current) {
        return;
      }

      setFileContent(data);
      setErrorMessage('');
      const nextEditorState = syncEditorStateFromContent(filename, data);
      setWriteFilename(nextEditorState.writeFilename);
      setWriteData(nextEditorState.writeData);
    } catch (error) {
      if (requestId !== contentRequestRef.current) {
        return;
      }

      if (typeof options.switchRequestId === 'number' && options.switchRequestId !== projectSwitchRequestRef.current) {
        return;
      }

      if (projectId !== selectedProjectIdRef.current || filename !== selectedFileRef.current) {
        return;
      }

      const message = formatWorkspaceError(
        error,
        '读取内容失败',
        '请确认文件存在且当前项目仓库可访问',
      );
      setErrorMessage(message);
      setFileContent(null);
      toast.error(message);
    } finally {
      if (
        requestId === contentRequestRef.current
        && projectId === selectedProjectIdRef.current
        && filename === selectedFileRef.current
        && (!options.switchRequestId || options.switchRequestId === projectSwitchRequestRef.current)
      ) {
        setLoadingContent(false);
        setSwitchingProject(false);
      }
    }
  };

  const refreshProjectView = async (projectId: string, filename?: string) => {
    if (filename) {
      setSelectedFile(filename);
    }

    await loadTimelines(projectId);
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
      const basevision = Number(commits?.at(-1)?.versionId ?? 0);
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
      await refreshProjectView(selectedProjectId, writeFilename);
    } catch (error) {
      toast.error('写入失败: ' + (error instanceof Error ? error.message : '未知错误'));
    } finally {
      setWriting(false);
    }
  };

  const handleSelectProject = (projectId: string) => {
    const nextProjectId = projectId.trim();
    if (!nextProjectId || nextProjectId === selectedProjectId) {
      return;
    }

    selectedProjectIdRef.current = nextProjectId;
    selectedFileRef.current = '';
    contentRequestRef.current += 1;
    setFileSearch('');
    setErrorMessage('');
    setCompareTarget('');
    setDiffData(null);
    setIsDiffOpen(false);
    setTimelines([]);
    setSelectedFile('');
    setFileContent(null);
    setWriteFilename('');
    setWriteData('');
    setLoadingContent(false);
    setSwitchingProject(true);
    setSelectedProjectId(nextProjectId);
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
      await refreshProjectView(selectedProjectId, selectedFile);
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
      setErrorMessage('');
      setIsNewProjectOpen(false);
      setNewProjectId('');
      setNewProjectName('');
      await loadProjects();
    } catch (error) {
      const message = formatWorkspaceError(error, '初始化失败');
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    const confirmationText = `I CHOOSE DELETE PROJECT ${projectId}`;
    const typedConfirmation = window.prompt(
      `即将软删除项目 ${projectId}。\n项目不会被物理清除，但会从当前项目列表中隐藏。\n请输入以下文本确认：\n${confirmationText}`,
      '',
    );

    if (typedConfirmation === null) {
      return;
    }

    if (typedConfirmation.trim() !== confirmationText) {
      toast.error('确认文本不匹配，已取消删除');
      return;
    }

    try {
      softDeleteXgProject(projectId);
      toast.success('项目已软删除');
      setErrorMessage('');
      if (selectedProjectId === projectId) {
        setSelectedProjectId('');
      }
      await loadProjects();
    } catch (error) {
      const message = formatWorkspaceError(error, '软删除项目失败');
      setErrorMessage(message);
      toast.error(message);
    }
  };

  const handleRenameProject = async (projectId: string, name: string): Promise<boolean> => {
    const nextName = name.trim();
    if (!nextName) {
      toast.error('项目名称不能为空');
      return false;
    }

    try {
      await updateXgProjectName(projectId, nextName);
      toast.success('项目名称已更新');
      await loadProjects();
      return true;
    } catch (error) {
      toast.error('更新项目名称失败: ' + (error instanceof Error ? error.message : '未知错误'));
      return false;
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

  useEffect(() => {
    return subscribeRepositorySync((detail) => {
      void loadProjects();

      const currentProjectId = selectedProjectIdRef.current;
      const projectId = detail.projectId || currentProjectId;
      if (!projectId) {
        return;
      }

      if (detail.projectId && currentProjectId && detail.projectId !== currentProjectId) {
        return;
      }

      void (async () => {
        await refreshProjectView(projectId, detail.filename);
      })();
    });
  }, []);

  return {
    projects,
    selectedProjectId,
    setSelectedProjectId,
    handleSelectProject,
    timelines,
    selectedFile,
    setSelectedFile,
    fileContent,
    loading,
    switchingProject,
    loadingContent,
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
    fileSearch,
    setFileSearch,
    errorMessage,
    loadProjects,
    loadTimelines,
    loadContent,
    handleWrite,
    handleProbAnalysis,
    handleRollback,
    handleInitProject,
    handleSetOfficial,
    handleViewDiff,
    handleDeleteProject,
    handleRenameProject,
  };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
