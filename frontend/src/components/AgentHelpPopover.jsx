import { CircleHelp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function AgentHelpPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="How to add an agent host or agent"
          className="inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-w-[calc(100vw-2rem)]">
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <h3 className="font-semibold">Add an agent on a host</h3>
            <p className="text-muted-foreground">
              In this UI, an agent host is the machine, and each row inside it is an agent entry such as Codex, Claude, or Kimi.
            </p>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>
              If the relay and your CLIs are on the same machine, use a local agent entry and skip the separate host process.
            </li>
            <li>
              Add the agent definition in <code className="rounded bg-muted px-1 py-0.5 text-foreground">config/agent-relay.local.json</code> under{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">agents</code>. The id, such as{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">codex-mini</code>, is just the unique key for that agent entry.
            </li>
            <li>
              Put host secrets in <code className="rounded bg-muted px-1 py-0.5 text-foreground">.env</code>, for example{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">AGENT_HOST_TOKEN</code>. Put the remote host URL directly in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">config/agent-relay.local.json</code>.
            </li>
            <li>
              Restart the relay with <code className="rounded bg-muted px-1 py-0.5 text-foreground">npm start</code>.
            </li>
          </ol>
          <div className="space-y-2">
            <p className="text-muted-foreground">Example local agent entry:</p>
            <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
{`"codex-mini": {
  // Name shown in the UI
  "label": "Codex on Mac mini",
  // Required today. Tells Relay how to launch it:
  // codex-local, claude-local, shell-json, or http-json
  "launcher": "codex-local",
  // Working directory used when the local CLI starts
  "cwd": "/path/to/your/workspace",
  // Executable to run
  "command": "codex",
  // Optional hard timeout in seconds. Omit it for no timeout.
  "timeoutSec": 3600
}`}
            </pre>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
