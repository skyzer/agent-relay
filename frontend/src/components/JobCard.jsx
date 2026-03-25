import { ChevronDown } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { compactSummary, extractSessionId, formatAbsoluteDate, formatRelativeDate, hasLogContent } from "../lib/utils";
import { MarkdownView } from "./MarkdownView";

function statusVariant(status) {
  switch (status) {
    case "done":
      return "success";
    case "running":
      return "default";
    case "queued":
      return "warning";
    default:
      return "destructive";
  }
}

function Section({ title, open, onOpenChange, children, className = "" }) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={`rounded-lg border border-border/70 bg-background/40 ${className}`}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium">
        <span>{title}</span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function JobCard({ job, logs = {}, openSections, onSectionChange }) {
  const stamp = job.status === "done" || job.status === "failed" ? job.updatedAt : job.createdAt;
  const stampLabel = job.status === "done" ? "done" : job.status === "failed" ? "failed" : "started";
  const title = job.prUrls && job.prUrls.length > 1 ? `${job.prUrls.length} PRs` : job.prUrl || job.id;
  const selectedAgents = (job.agentPlan || [])
    .map((entry) => entry.agentLabel || entry.agentId)
    .filter(Boolean);

  const logEntries = Object.entries(logs).filter(([, text]) => String(text || "").trim().length > 0);
  const showLogs = job.status === "running" || hasLogContent(job, { [job.id]: logs });
  const sessions = (job.results || [])
    .map((result) => ({
      agentId: result.agentId || result.workerId,
      agentLabel: result.agentLabel || result.workerLabel || result.agentId || result.workerId,
      sessionId: extractSessionId(result),
    }))
    .filter((entry) => entry.sessionId);

  return (
    <Card className={`border-border/80 bg-card/90 ${job.status === "running" || job.status === "queued" ? "ring-1 ring-primary/30" : ""}`}>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">{title}</h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                <time
                  className="inline-flex cursor-help border-b border-dotted border-muted-foreground/70"
                  dateTime={stamp}
                  title={formatAbsoluteDate(stamp)}
                >
                  {`${stampLabel} ${formatRelativeDate(stamp)}`}
                </time>
              </div>
              {selectedAgents.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="uppercase tracking-[0.14em]">Selected agents</span>
                  <span>{selectedAgents.join(" • ")}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {Array.isArray(job.prUrls) && job.prUrls.length > 1 ? (
          <Section
            title={`Targets (${job.prUrls.length})`}
            open={Boolean(openSections.targets)}
            onOpenChange={(next) => onSectionChange("targets", next)}
          >
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
              {job.prUrls.join("\n")}
            </pre>
          </Section>
        ) : null}

        {Array.isArray(job.results) && job.results.length > 0 ? (
          <Section
            title={`Agent results (${job.results.length})`}
            open={Boolean(openSections.results)}
            onOpenChange={(next) => onSectionChange("results", next)}
          >
            <div className="space-y-3">
              {job.results.map((result) => {
                const resultId = result.agentId || result.workerId;
                const resultLabel = result.agentLabel || result.workerLabel || resultId;
                const key = `result:${resultId}`;
                const summaryText = compactSummary(result.output?.summary || result.error || result.status || "No summary");
                const details =
                  typeof result.output?.details === "string" && result.output.details.trim()
                    ? result.output.details
                    : `## ${resultLabel}\n\n**Status:** ${result.output?.status || result.status || "unknown"}\n\n${summaryText}`;

                return (
                  <Section
                    key={resultId}
                    title={resultLabel}
                    open={Boolean(openSections[key])}
                    onOpenChange={(next) => onSectionChange(key, next)}
                    className="bg-card/60"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={statusVariant(result.status === "success" ? "done" : result.status === "skipped" ? "queued" : "failed")}>
                        {result.status || "unknown"}
                      </Badge>
                      <span>{summaryText}</span>
                    </div>
                    <MarkdownView markdown={details} />
                  </Section>
                );
              })}
            </div>
          </Section>
        ) : null}

        {job.status !== "running" && job.status !== "queued" && sessions.length > 0 ? (
          <div className="rounded-lg border border-border/70 bg-background/40 px-4 py-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Agent sessions</div>
            <div className="space-y-2">
              {sessions.map((entry) => (
                <div key={`${entry.agentId}-${entry.sessionId}`} className="flex flex-col gap-1 text-sm md:flex-row md:items-center md:justify-between">
                  <span>{entry.agentLabel}</span>
                  <code className="w-fit rounded bg-muted px-2 py-1 text-xs text-foreground">{entry.sessionId}</code>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {showLogs ? (
          <Section
            title={job.status === "running" ? "Agent logs (live)" : "Agent logs"}
            open={job.status === "running" ? openSections.logs ?? true : Boolean(openSections.logs)}
            onOpenChange={(next) => onSectionChange("logs", next)}
          >
            {logEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No agent logs captured yet.</p>
            ) : (
              <div className="space-y-3">
                {logEntries.map(([workerId, text]) => (
                  <div key={workerId} className="space-y-1">
                    <div className="text-xs text-muted-foreground">{workerId}</div>
                    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
                      {text}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </Section>
        ) : null}

        {job.aggregate?.body ? (
          <Section
            title="Saved summary"
            open={Boolean(openSections.savedSummary)}
            onOpenChange={(next) => onSectionChange("savedSummary", next)}
          >
            <MarkdownView markdown={job.aggregate.body} />
          </Section>
        ) : null}

        {Array.isArray(job.multiPrResults) && job.multiPrResults.length > 0 ? (
          <Section
            title={`Saved per-PR results (${job.multiPrResults.length})`}
            open={Boolean(openSections.savedPerPr)}
            onOpenChange={(next) => onSectionChange("savedPerPr", next)}
          >
            <div className="space-y-3">
              {job.multiPrResults.map((entry, index) => (
                <Section
                  key={`${job.id}-${index}`}
                  title={entry.prUrl}
                  open={Boolean(openSections[`savedPr:${index}`])}
                  onOpenChange={(next) => onSectionChange(`savedPr:${index}`, next)}
                  className="bg-card/60"
                >
                  <MarkdownView markdown={entry.aggregate ? entry.aggregate.body : "No saved result."} />
                </Section>
              ))}
            </div>
          </Section>
        ) : null}

        {job.error ? (
          <Section title="Job error" open={Boolean(openSections.error)} onOpenChange={(next) => onSectionChange("error", next)}>
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">{job.error}</pre>
          </Section>
        ) : null}
      </CardContent>
    </Card>
  );
}
