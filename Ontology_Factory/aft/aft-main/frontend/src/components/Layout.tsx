import React from "react"
import { Database, BookOpen, Layers } from "lucide-react"
import { ModeToggle } from "./mode-toggle"

export function Layout({
  children,
  currentPage,
  onPageChange,
}: {
  children: React.ReactNode;
  currentPage: string;
  onPageChange: (page: string) => void;
}) {
  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 overflow-hidden font-sans">
      {/* Activity Bar */}
      <div className="w-14 shrink-0 border-r bg-white dark:bg-zinc-900 flex flex-col items-center py-4 space-y-6">
        <div
          className={`p-2 rounded-xl transition-colors cursor-pointer ${currentPage === "qa" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          onClick={() => onPageChange("qa")}
          title="Question & Answer"
        >
          <Database className="w-5 h-5" />
        </div>
        <div
          className={`p-2 rounded-xl transition-colors cursor-pointer ${currentPage === "ingest" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          onClick={() => onPageChange("ingest")}
          title="Ingest Documents"
        >
          <BookOpen className="w-5 h-5" />
        </div>
        <div
          className={`p-2 rounded-xl transition-colors cursor-pointer ${currentPage === "graph" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          onClick={() => onPageChange("graph")}
          title="Knowledge Graph Explorer"
        >
          <Layers className="w-5 h-5" />
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b flex items-center px-4 bg-white/50 dark:bg-zinc-900/50 backdrop-blur shrink-0 justify-between">
          <div className="flex items-center gap-4">
            <h1 className="font-medium text-sm text-foreground">Ontology+Agent+RAG for TEST</h1>
            <div className="h-3 w-px bg-border"></div>
            <span className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">{currentPage.replace("-", " ")}</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500"></span> Backend Ready
            </span>
            <div className="h-4 w-px bg-border"></div>
            <ModeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-auto">
          <div className="h-full flex flex-col">{children}</div>
        </main>
      </div>
    </div>
  );
}
