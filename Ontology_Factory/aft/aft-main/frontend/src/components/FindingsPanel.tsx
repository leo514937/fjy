import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

interface AuditFinding {
  finding_type: string;
  severity: "critical" | "high" | "medium" | "low" | "info" | string;
  expected: string;
  found: string;
  evidence?: string;
}

export function FindingsPanel({ findings = [] }: { findings: AuditFinding[] }) {
  if (findings.length === 0) {
    return null;
  }

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case "critical":
      case "high":
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case "medium":
        return <AlertTriangle className="h-5 w-5 text-amber-500" />;
      case "low":
      case "info":
        return <Info className="h-5 w-5 text-blue-500" />;
      default:
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="px-1 text-lg font-semibold">Audit Findings ({findings.length})</h3>
      <div className="grid gap-3">
        {findings.map((finding, index) => (
          <Card
            key={`${finding.finding_type}-${index}`}
            className="border-l-4 shadow-sm"
            style={{
              borderLeftColor:
                finding.severity === "high" || finding.severity === "critical"
                  ? "hsl(var(--destructive))"
                  : finding.severity === "medium"
                    ? "#f59e0b"
                    : "#3b82f6",
            }}
          >
            <CardHeader className="flex flex-row items-start justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {getSeverityIcon(finding.severity)}
                <CardTitle className="text-sm font-medium leading-none">
                  {finding.finding_type}
                </CardTitle>
              </div>
              <Badge variant="outline" className="capitalize">
                {finding.severity}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4 pt-0 text-sm text-muted-foreground">
              <div>
                <strong className="text-foreground">Expected:</strong> {finding.expected}
              </div>
              <div>
                <strong className="text-foreground">Found:</strong> {finding.found}
              </div>
              {finding.evidence ? (
                <div className="rounded bg-muted/50 p-2 font-mono text-xs">{finding.evidence}</div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
