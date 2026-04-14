import { useState, useEffect } from 'react';
import { 
  GitBranch, 
  History, 
  RefreshCw, 
  Upload, 
  FileJson, 
  Network, 
  CheckCircle2, 
  Star,
  Sparkles,
  Plus,
  ArrowLeftRight,
  ShieldCheck
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  fetchXgProjects, 
  fetchXgTimelines, 
  fetchXgRead, 
  writeXgAndInfer, 
  rollbackXgVersion,
  fetchXgDiff,
  initXgProject,
  setOfficialRecommend,
  fetchProbabilityReason,
  type XgProject,
  type XgTimeline
} from '@/lib/api';
import { toast } from 'sonner';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';

export function XiaoGuGitDashboard() {
  const [projects, setProjects] = useState<XgProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [timelines, setTimelines] = useState<XgTimeline[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [fileContent, setFileContent] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  
  // Write form state
  const [writeFilename, setWriteFilename] = useState('');
  const [writeData, setWriteData] = useState('');
  const [writeMessage, setWriteMessage] = useState('');
  const [writing, setWriting] = useState(false);

  // Probability state
  const [probInput, setProbInput] = useState('');
  const [probResult, setProbResult] = useState<{ probability: number; reason: string } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // New Project State
  const [newProjectId, setNewProjectId] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);

  // Diff State
  const [diffData, setDiffData] = useState<any>(null);
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState('');

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadTimelines(selectedProjectId);
    }
  }, [selectedProjectId]);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const data = await fetchXgProjects();
      setProjects(data);
      if (data.length > 0 && !selectedProjectId) {
        setSelectedProjectId(data[0].id);
      }
    } catch (e) {
      toast.error('获取项目列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTimelines = async (pid: string) => {
    try {
      const data = await fetchXgTimelines(pid);
      setTimelines(data);
      if (data.length > 0 && !selectedFile) {
        setSelectedFile(data[0].filename);
        loadContent(pid, data[0].filename);
      }
    } catch (e) {
      // toast.error('获取时间线失败');
    }
  };

  const loadContent = async (pid: string, filename: string) => {
    try {
      const data = await fetchXgRead(pid, filename);
      setFileContent(data);
      setWriteFilename(filename);
      setWriteData(JSON.stringify(data, null, 2));
    } catch (e) {
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
    } catch (e) {
      toast.error('写入失败: ' + (e instanceof Error ? e.message : '未知错误'));
    } finally {
      setWriting(false);
    }
  };

  const handleProbAnalysis = async () => {
    if (!probInput) return;
    setAnalyzing(true);
    try {
      const result = await fetchProbabilityReason(JSON.parse(probInput));
      setProbResult(result);
    } catch (e) {
      toast.error('推理失败: JSON 格式错误');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleRollback = async (commitId: string) => {
    if (!selectedProjectId) return;
    if (!confirm(`确定要回滚到版本 ${commitId.slice(0, 7)} 吗？这将生成一个新的补偿提交。`)) return;

    try {
      await rollbackXgVersion(selectedProjectId, commitId);
      toast.success('回滚成功');
      loadTimelines(selectedProjectId);
      if (selectedFile) loadContent(selectedProjectId, selectedFile);
    } catch (e) {
      toast.error('回滚失败: ' + (e instanceof Error ? e.message : '未知错误'));
    }
  };

  const handleInitProject = async () => {
    if (!newProjectId) return;
    try {
      await initXgProject({ 
        project_id: newProjectId, 
        name: newProjectName || newProjectId 
      });
      toast.success('项目初始化完成');
      setIsNewProjectOpen(false);
      setNewProjectId('');
      setNewProjectName('');
      loadProjects();
    } catch (e) {
      toast.error('初始化失败');
    }
  };

  const handleSetOfficial = async (versionId: string) => {
    if (!selectedProjectId || !selectedFile) return;
    try {
      await setOfficialRecommend(selectedProjectId, selectedFile, versionId);
      toast.success('已设置为官方推荐版本');
    } catch (e) {
      toast.error('设置失败');
    }
  };

  const handleViewDiff = async (baseId: string) => {
    if (!selectedProjectId || !selectedFile) return;
    setCompareTarget(baseId);
    try {
      const data = await fetchXgDiff(selectedProjectId, selectedFile, baseId, 'HEAD');
      setDiffData(data);
      setIsDiffOpen(true);
    } catch (e) {
      toast.error('获取差异失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Sidebar: Projects & Files */}
        <div className="lg:col-span-3 space-y-6">
          <Card className="border-slate-200">
            <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-blue-500" />
                所有项目
              </CardTitle>
              <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>新建本体项目</DialogTitle>
                    <DialogDescription>
                      创建一个新的 Git 存储库用于管理本体版本。
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">项目 ID (唯一标识)</label>
                      <Input 
                        placeholder="my-new-project" 
                        value={newProjectId} 
                        onChange={e => setNewProjectId(e.target.value)} 
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">项目名称 (显示名)</label>
                      <Input 
                        placeholder="智能引擎本体项目" 
                        value={newProjectName} 
                        onChange={e => setNewProjectName(e.target.value)} 
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleInitProject} disabled={!newProjectId}>初始化项目</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="px-2">
              <ScrollArea className="h-48">
                <div className="space-y-1">
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProjectId(p.id)}
                      className={`w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors ${
                        selectedProjectId === p.id ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span>{p.name || p.id}</span>
                      {selectedProjectId === p.id && <CheckCircle2 className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              </ScrollArea>
              <Button variant="outline" size="sm" className="w-full mt-4 gap-2" onClick={loadProjects} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                刷新列表
              </Button>
            </CardContent>
          </Card>

          <Card className="border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <History className="h-4 w-4 text-purple-500" />
                文件列表
              </CardTitle>
            </CardHeader>
            <CardContent className="px-2">
              <ScrollArea className="h-64">
                <div className="space-y-1">
                  {timelines.map((t) => (
                    <button
                      key={t.filename}
                      onClick={() => {
                        setSelectedFile(t.filename);
                        loadContent(selectedProjectId, t.filename);
                      }}
                      className={`w-full flex flex-col items-start px-3 py-2 text-sm rounded-lg transition-colors ${
                        selectedFile === t.filename ? 'bg-purple-50 text-purple-700' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <FileJson className="h-3.5 w-3.5" />
                        <span className="font-medium">{t.filename}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground mt-1">
                        {t.commits.length} 个版本记录
                      </span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Main Workspace */}
        <div className="lg:col-span-9 space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Read / Content Area */}
            <Card className="border-slate-200 overflow-hidden flex flex-col h-[600px]">
              <CardHeader className="bg-slate-50 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    当前内容
                    <Badge variant="outline" className="font-mono text-[10px]">{selectedFile || '未选择文件'}</Badge>
                  </CardTitle>
                  <CardDescription>读取 XiaoGuGit 存储的最新版本</CardDescription>
                </div>
                <div className="flex gap-2">
                   <Button variant="ghost" size="icon" onClick={() => loadContent(selectedProjectId, selectedFile)}>
                     <RefreshCw className="h-4 w-4 text-muted-foreground" />
                   </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 p-0 bg-slate-900 overflow-hidden">
                <ScrollArea className="h-full w-full">
                  <pre className="p-4 text-xs text-blue-400 font-mono leading-relaxed">
                    {fileContent ? JSON.stringify(fileContent, null, 2) : '// 选择文件以查看内容'}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Write / Edit Area */}
            <Card className="border-slate-200 flex flex-col h-[600px]">
              <CardHeader className="bg-slate-50 border-b">
                <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4 text-green-500" />
                入库同步
                </CardTitle>
                <CardDescription>将更改同步到中心仓库并触发概率推理</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">项目 ID</label>
                    <Input disabled value={selectedProjectId} size={1} className="h-8 text-xs bg-slate-50" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium">文件名</label>
                    <Input 
                      placeholder="ontology.json" 
                      value={writeFilename} 
                      onChange={(e) => setWriteFilename(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="space-y-1.5 flex-1 flex flex-col min-h-0">
                  <label className="text-xs font-medium">JSON 内容</label>
                  <Textarea 
                    value={writeData}
                    onChange={(e) => setWriteData(e.target.value)}
                    className="flex-1 font-mono text-xs resize-none"
                    placeholder='{ "id": "001", ... }'
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">提交备注</label>
                  <Input 
                    placeholder="例如：更新了实体属性定义" 
                    value={writeMessage}
                    onChange={(e) => setWriteMessage(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <Button 
                  className="w-full bg-green-600 hover:bg-green-700 gap-2" 
                  onClick={handleWrite} 
                  disabled={writing || !selectedProjectId}
                >
                  {writing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  执行写入并推理 (Write & Infer)
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
             {/* Timeline / Commit History */}
            <Card className="border-slate-200 h-80 flex flex-col">
              <CardHeader className="pb-3 border-b bg-slate-50/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="h-4 w-4" />
                  版本时间线 (Git Commits)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-4 space-y-4">
                    {selectedFile && timelines.find(t => t.filename === selectedFile)?.commits.map((c, idx) => (
                      <div key={c.id} className="relative pl-6 pb-4 group">
                        {idx !== (timelines.find(t => t.filename === selectedFile)?.commits.length ?? 0) - 1 && (
                          <div className="absolute left-[9px] top-2 bottom-0 w-[1px] bg-slate-200" />
                        )}
                        <div className="absolute left-0 top-1.5 h-4.5 w-4.5 rounded-full border-2 border-slate-200 bg-white group-hover:border-purple-500 transition-colors" />
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-bold text-purple-600">{c.id.slice(0, 7)}</span>
                            <span className="text-[10px] text-muted-foreground">{new Date(c.timestamp).toLocaleString()}</span>
                          </div>
                          <p className="text-xs leading-relaxed">{c.message}</p>
                          <div className="flex items-center gap-3 mt-1">
                             <Badge variant="outline" className="text-[9px] px-1 py-0">{c.author}</Badge>
                             <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => handleViewDiff(c.id)}
                                className="text-[10px] text-slate-500 hover:text-slate-900 flex items-center gap-0.5"
                              >
                                <ArrowLeftRight className="h-2.5 w-2.5" />
                                对比差异
                              </button>
                              <button 
                                onClick={() => handleSetOfficial(c.id)}
                                className="text-[10px] text-orange-600 hover:underline flex items-center gap-0.5"
                              >
                                <ShieldCheck className="h-2.5 w-2.5" />
                                设为推荐
                              </button>
                              <button 
                                onClick={() => handleRollback(c.id)}
                                className="text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                              >
                                回滚至此
                              </button>
                             </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {!selectedFile && <div className="text-center text-xs text-muted-foreground py-10">选择一个文件以查看时间线</div>}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>

            {/* Probability Reasoner */}
            <Card className="border-slate-200 h-80 flex flex-col">
              <CardHeader className="pb-3 border-b bg-slate-50/50">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-orange-500" />
                  API 概率推理实验室 (Reasoner)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 flex flex-col gap-3 flex-1 overflow-hidden">
                 <div className="flex-1 flex flex-col gap-2 min-h-0">
                    <Textarea 
                      className="flex-1 font-mono text-[11px] resize-none border-slate-200 bg-slate-50"
                      placeholder='{ "name": "发动机", "type": "topic", ... }'
                      value={probInput}
                      onChange={(e) => setProbInput(e.target.value)}
                    />
                    <Button 
                      variant="secondary" 
                      size="sm" 
                      className="w-full gap-2 border-orange-200 hover:bg-orange-50"
                      onClick={handleProbAnalysis}
                      disabled={analyzing}
                    >
                      {analyzing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
                      分析知识点置信度
                    </Button>
                 </div>
                 {probResult && (
                   <div className="rounded-xl border border-orange-100 bg-orange-50/50 p-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-orange-800">推理概率 (Confidence)</span>
                        <Badge className="bg-orange-600">{(probResult.probability * 100).toFixed(1)}%</Badge>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-700 italic border-l-2 border-orange-300 pl-2">
                        "{probResult.reason}"
                      </p>
                   </div>
                 )}
              </CardContent>
            </Card>
          </div>

          {/* Recommendation System */}
          <Card className="border-slate-200 bg-gradient-to-r from-slate-900 to-indigo-950 text-white">
            <CardContent className="p-6">
               <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                  <div className="space-y-2 text-center md:text-left">
                    <h3 className="text-lg font-bold flex items-center gap-2 justify-center md:justify-start">
                      <Star className="h-5 w-5 text-yellow-400" />
                      本体推荐与分发系统
                    </h3>
                    <p className="text-xs text-slate-400 max-w-md">
                      支持官方权威版本锁定与社区活跃推荐。点击下方的“获取快照”，我们可以为您提取 XiaoGuGit 当前项目最受认可的结构化快照。
                    </p>
                  </div>
                  <div className="flex gap-4">
                    <Button className="bg-white text-slate-900 hover:bg-slate-200 gap-2">
                      官方推荐快照
                    </Button>
                    <Button className="bg-white text-slate-900 hover:bg-slate-200 gap-2">
                      社会化推荐排行
                    </Button>
                  </div>
               </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {/* Diff Dialog */}
      <Dialog open={isDiffOpen} onOpenChange={setIsDiffOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              版本差异对比 
              <Badge variant="outline" className="font-mono">{compareTarget.slice(0, 7)} vs HEAD</Badge>
            </DialogTitle>
            <DialogDescription>
              显示目标版本与当前工作区版本之间的属性变更。
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden mt-4">
            <ScrollArea className="h-full bg-slate-900 rounded-lg p-4">
               {diffData ? (
                 <div className="space-y-1 font-mono text-xs">
                    {typeof diffData.diff === 'string' && diffData.diff.split('\n').map((line: string, i: number) => (
                      <div key={i} className={`${
                        line.startsWith('+') ? 'text-green-400 bg-green-950/30' : 
                        line.startsWith('-') ? 'text-red-400 bg-red-950/30' : 
                        'text-slate-400'
                      }`}>
                        {line}
                      </div>
                    ))}
                    {(!diffData.diff || diffData.diff === "") && <div className="text-slate-500 italic">两个版本之间内容一致。</div>}
                 </div>
               ) : (
                 <div className="flex items-center justify-center h-full text-slate-500">正在计算差异...</div>
               )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
