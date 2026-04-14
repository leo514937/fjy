import { useMemo, useState, type ChangeEvent } from "react";
import { AlertCircle, CheckCircle, FileText, Loader2, Upload, X } from "lucide-react";

import { uploadKnowledgeDocument, type KnowledgeUploadResponse } from "../lib/api";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";

const DEFAULT_TARGET_CHUNK_TOKENS = 400;
const DEFAULT_CHUNK_OVERLAP_TOKENS = 80;
const DEFAULT_MAX_CHUNK_TOKENS = 600;
const DEFAULT_COLLECTION_NAME = "ontology_audit_chunks_v2";
const SUPPORTED_FILE_ACCEPT =
  ".md,.markdown,.txt,.pdf,.docx,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const SUPPORTED_FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".pdf", ".docx"]);
const SUPPORTED_FILE_MIME_TYPES = new Set([
  "text/markdown",
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function IngestionPanel() {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<KnowledgeUploadResponse[]>([]);

  const totalChunks = useMemo(
    () => results.reduce((sum, item) => sum + item.chunk_count, 0),
    [results],
  );

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    if (nextFiles.length === 0) {
      return;
    }
    const supportedFiles = nextFiles.filter(isSupportedKnowledgeFile);
    const rejectedFiles = nextFiles.filter((file) => !isSupportedKnowledgeFile(file));

    setSuccess(null);
    if (rejectedFiles.length > 0) {
      setError(buildUnsupportedFileMessage(rejectedFiles));
    } else {
      setError(null);
    }

    if (supportedFiles.length === 0) {
      event.target.value = "";
      return;
    }

    setFiles((current) => {
      const existing = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const merged = [...current];
      for (const file of supportedFiles) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!existing.has(key)) {
          existing.add(key);
          merged.push(file);
        }
      }
      return merged;
    });
    event.target.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleIngest = async () => {
    if (files.length === 0) {
      return;
    }

    setLoading(true);
    setSuccess(null);
    setError(null);
    setResults([]);

    try {
      const uploaded: KnowledgeUploadResponse[] = [];
      for (const file of files) {
        const result = await uploadKnowledgeDocument(file, {
          collectionName: DEFAULT_COLLECTION_NAME,
          targetChunkTokens: DEFAULT_TARGET_CHUNK_TOKENS,
          chunkOverlapTokens: DEFAULT_CHUNK_OVERLAP_TOKENS,
          maxChunkTokens: DEFAULT_MAX_CHUNK_TOKENS,
          chunkStrategy: "semantic_token_v1",
          indexProfile: "semantic_token_v1",
        });
        uploaded.push(result);
      }
      setResults(uploaded);
      const chunkTotal = uploaded.reduce((sum, item) => sum + item.chunk_count, 0);
      setSuccess(`Indexed ${uploaded.length} document(s) into Qdrant with ${chunkTotal} chunk(s).`);
      setFiles([]);
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Knowledge ingestion failed."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full py-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div className="text-center space-y-4 mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 text-primary mb-2 shadow-inner">
          <Upload className="w-8 h-8" />
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-zinc-900 to-zinc-500 dark:from-zinc-100 dark:to-zinc-500">
          Knowledge Upload
        </h2>
        <p className="text-muted-foreground text-sm max-w-xl mx-auto leading-relaxed">
          Upload Markdown, TXT, PDF, or DOCX files, split them into token-aware chunks, and store the resulting vectors in Qdrant for grounded RAG.
        </p>
      </div>

      <div className="grid gap-8">
        <div className="bg-white dark:bg-zinc-900 border rounded-3xl p-8 shadow-xl shadow-zinc-200/50 dark:shadow-none space-y-6">
          <div className="grid gap-5">
            <div className="grid gap-3">
              <label className="text-xs font-bold text-zinc-400 uppercase tracking-widest px-1">Knowledge files</label>
              <div className="relative group">
                <input
                  title="Upload knowledge files"
                  type="file"
                  accept={SUPPORTED_FILE_ACCEPT}
                  multiple
                  onChange={handleFileChange}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className="flex flex-col items-center justify-center gap-3 p-8 rounded-3xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/10 group-hover:bg-primary/[0.02] group-hover:border-primary/30 transition-all duration-500 ease-out">
                  <div className="w-14 h-14 rounded-2xl bg-white dark:bg-zinc-900 shadow-sm border border-zinc-100 dark:border-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-primary group-hover:scale-110 transition-all duration-300">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 group-hover:text-primary transition-colors">
                      Click to choose files or drag here
                    </p>
                    <p className="text-xs text-zinc-400">
                      Supports Markdown, TXT, PDF, and DOCX formats
                    </p>
                  </div>
                </div>
              </div>
            </div>


            <div className="min-h-[120px] p-4 bg-zinc-50/50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-100 dark:border-zinc-800 flex flex-col gap-2">
              {files.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center opacity-40 mt-2 text-center">
                  <FileText className="w-8 h-8 mb-2" />
                  <span className="text-xs italic">No Markdown, TXT, PDF, or DOCX files selected yet.</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {files.map((file, index) => (
                    <Badge
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      variant="secondary"
                      className="bg-white dark:bg-zinc-800 border shadow-sm flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg group animate-in zoom-in-95"
                    >
                      <span className="text-[11px] font-medium max-w-[420px] truncate">
                        {file.name}
                      </span>
                      <button
                        onClick={() => removeFile(index)}
                        className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-md transition-colors text-zinc-400 hover:text-red-500"
                        type="button"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <Button
            onClick={handleIngest}
            disabled={loading || files.length === 0}
            className="w-full h-14 text-base font-bold bg-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 rounded-2xl shadow-2xl transition-all disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Uploading knowledge to Qdrant...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 mr-2" />
                Upload to knowledge collection
              </>
            )}
          </Button>
        </div>

        {(success || error) && (
          <div className="animate-in slide-in-from-top-4">
            {success && (
              <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 text-green-600 rounded-2xl">
                <CheckCircle className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium">{success}</span>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 text-red-600 rounded-2xl">
                <AlertCircle className="h-5 w-5 shrink-0" />
                <span className="text-sm font-medium">{error}</span>
              </div>
            )}
          </div>
        )}

        <div className="relative group">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent rounded-3xl -m-1 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative p-6 bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-zinc-100 dark:border-zinc-800 space-y-4">
            <h4 className="text-[11px] font-bold text-zinc-400 flex items-center gap-2 uppercase tracking-widest">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              Latest indexing results
            </h4>
            {results.length === 0 ? (
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                The upload endpoint now writes directly to Qdrant with semantic token chunking and OpenAI-compatible embeddings.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] text-muted-foreground leading-relaxed">
                  Uploaded {results.length} file(s), created {totalChunks} chunk(s), and stored them in vector collections ready for `/qa/answer`.
                </p>
                <div className="space-y-2">
                  {results.map((result) => (
                    <div
                      key={`${result.collection_name}:${result.source_id}`}
                      className="rounded-2xl border bg-white/70 dark:bg-zinc-950/50 px-4 py-3 text-sm"
                    >
                      <div className="font-semibold">{result.filename}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        collection={result.collection_name} | chunks={result.chunk_count} | profile={result.index_profile} | embedding={result.embedding_model}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const candidate = error as { response?: { data?: { message?: string } } };
    return candidate.response?.data?.message || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function isSupportedKnowledgeFile(file: File): boolean {
  const extension = getFileExtension(file.name);
  if (SUPPORTED_FILE_EXTENSIONS.has(extension)) {
    return true;
  }
  const mimeType = file.type.toLowerCase();
  return mimeType !== "" && SUPPORTED_FILE_MIME_TYPES.has(mimeType);
}

function getFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex < 0) {
    return "";
  }
  return filename.slice(lastDotIndex).toLowerCase();
}

function buildUnsupportedFileMessage(rejectedFiles: File[]): string {
  const legacyWord = rejectedFiles.find((file) => getFileExtension(file.name) === ".doc");
  if (legacyWord) {
    return "Legacy Word .doc files are not supported yet. Please save the file as .docx.";
  }

  const labels = rejectedFiles.map((file) => file.name).join(", ");
  return `Unsupported file type: ${labels}. Supported formats: Markdown, TXT, PDF (text-based), DOCX.`;
}
