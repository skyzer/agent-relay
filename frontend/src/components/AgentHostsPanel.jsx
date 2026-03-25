import { Laptop, Server } from "lucide-react";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { AgentHelpPopover } from "./AgentHelpPopover";
import { workerDevice, workerLocation } from "../lib/utils";

function statusVariant(worker, health) {
  if (!worker.enabled) {
    return "outline";
  }
  return health && health.ok ? "success" : "destructive";
}

function statusLabel(worker, health) {
  if (!worker.enabled) {
    return "disabled";
  }
  return health && health.ok ? "healthy" : "unavailable";
}

export function AgentHostsPanel({ agentsData, onToggleAgent }) {
  const groups = new Map([
    ["MacBook Pro", []],
    ["Mac mini", []],
  ]);

  for (const [id, agent] of Object.entries(agentsData?.agents || {})) {
    const device = workerDevice(id, agent);
    if (!groups.has(device)) {
      groups.set(device, []);
    }
    groups.get(device).push({ id, agent, health: agentsData.health[id] });
  }

  return (
    <Card className="border-border/80 bg-card/95 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.65)]">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle>Agent Hosts</CardTitle>
          <AgentHelpPopover />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from(groups.entries()).map(([device, items]) => {
          if (items.length === 0) {
            return null;
          }

          const Icon = device === "MacBook Pro" ? Laptop : Server;

          return (
            <section key={device} className="space-y-3 rounded-xl border border-border/70 bg-background/60 p-4">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold">{device}</h3>
              </div>
              <div className="space-y-3">
                {items.map(({ id, agent, health }) => (
                  <div
                    key={id}
                    className={`rounded-lg border border-border bg-card/70 p-3 ${
                      agent.enabled ? "" : "opacity-65"
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm font-medium">
                          <Checkbox checked={agent.enabled} onCheckedChange={(checked) => onToggleAgent(id, Boolean(checked))} />
                          <span>{agent.label}</span>
                        </label>
                        <Badge variant={statusVariant(agent, health)}>{statusLabel(agent, health)}</Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span>{id}</span>
                        <span>{workerLocation(agent)}</span>
                      </div>
                      {agent.enabled && health && !health.ok ? (
                        <p className="text-xs text-muted-foreground">{health.reason || "Agent unavailable"}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </CardContent>
    </Card>
  );
}
