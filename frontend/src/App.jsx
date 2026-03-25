import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import { Activity, SendHorizontal } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Textarea } from "./components/ui/textarea";
import { Separator } from "./components/ui/separator";
import { JobCard } from "./components/JobCard";
import { AgentHostsPanel } from "./components/AgentHostsPanel";
import { api, hasLogContent } from "./lib/utils";

function useRelayData() {
  const [jobs, setJobs] = useState([]);
  const [agentsData, setAgentsData] = useState({ agents: {}, health: {} });
  const [logsByJob, setLogsByJob] = useState({});
  const sourcesRef = useRef(new Map());

  const refreshJobs = useEffectEvent(async () => {
    const nextJobs = (await api("/api/reviews")).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    startTransition(() => {
      setJobs(nextJobs);
    });
  });

  const refreshAgents = useEffectEvent(async () => {
    const nextAgents = await api("/api/agents");
    startTransition(() => {
      setAgentsData(nextAgents);
    });
  });

  const loadLogs = useEffectEvent(async (jobId) => {
    const logs = await api(`/api/reviews/${jobId}/logs`).catch(() => ({}));
    startTransition(() => {
      setLogsByJob((current) => ({ ...current, [jobId]: logs }));
    });
  });

  useEffect(() => {
    refreshJobs().catch(console.error);
    refreshAgents().catch(console.error);

    const jobsTimer = setInterval(() => {
      refreshJobs().catch(() => {});
    }, 2500);
    const workersTimer = setInterval(() => {
      refreshAgents().catch(() => {});
    }, 5000);

    return () => {
      clearInterval(jobsTimer);
      clearInterval(workersTimer);
    };
  }, []);

  useEffect(() => {
    jobs
      .filter((job) => job.status === "running" || hasLogContent(job, logsByJob))
      .forEach((job) => {
        loadLogs(job.id).catch(() => {});
      });
  }, [jobs]);

  useEffect(() => {
    const activeIds = new Set(jobs.filter((job) => job.status === "queued" || job.status === "running").map((job) => job.id));

    for (const jobId of activeIds) {
      if (sourcesRef.current.has(jobId)) {
        continue;
      }

      const source = new EventSource(`/api/reviews/${jobId}/stream`);
      source.addEventListener("worker_log", (event) => {
        const payload = JSON.parse(event.data);
        startTransition(() => {
          setLogsByJob((current) => {
            const jobLogs = current[jobId] || {};
            return {
              ...current,
              [jobId]: {
                ...jobLogs,
                [payload.workerId]: (jobLogs[payload.workerId] || "") + payload.chunk,
              },
            };
          });
        });
      });

      const syncJobState = () => {
        refreshJobs().catch(() => {});
      };

      source.addEventListener("worker_started", syncJobState);
      source.addEventListener("worker_finished", syncJobState);
      source.addEventListener("job_completed", syncJobState);
      source.addEventListener("job_failed", syncJobState);

      sourcesRef.current.set(jobId, source);
    }

    for (const [jobId, source] of sourcesRef.current.entries()) {
      if (activeIds.has(jobId)) {
        continue;
      }
      source.close();
      sourcesRef.current.delete(jobId);
    }
  }, [jobs]);

  useEffect(() => {
    return () => {
      for (const source of sourcesRef.current.values()) {
        source.close();
      }
      sourcesRef.current.clear();
    };
  }, []);

  return {
    jobs,
    agentsData,
    logsByJob,
    refreshJobs,
    refreshAgents,
  };
}

export function App() {
  const [prUrls, setPrUrls] = useState("");
  const [instructions, setInstructions] = useState("");
  const [submitStatus, setSubmitStatus] = useState("");
  const [openSections, setOpenSections] = useState({});

  const { jobs, agentsData, logsByJob, refreshJobs, refreshAgents } = useRelayData();

  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const pastJobs = jobs.filter((job) => job.status !== "queued" && job.status !== "running");

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitStatus("Submitting...");
    try {
      await api("/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          prUrls: prUrls
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          instructions: instructions.trim(),
        }),
      });
      setSubmitStatus("Queued.");
      setPrUrls("");
      setInstructions("");
      refreshJobs().catch(() => {});
    } catch (error) {
      setSubmitStatus(error.message);
    }
  }

  async function handleToggleAgent(agentId, enabled) {
    await api("/api/agents", {
      method: "PUT",
      body: JSON.stringify({
        enabledByAgentId: {
          [agentId]: enabled,
        },
      }),
    });
    refreshAgents().catch(() => {});
  }

  function setSectionOpen(jobId, sectionKey, open) {
    setOpenSections((current) => ({
      ...current,
      [jobId]: {
        ...(current[jobId] || {}),
        [sectionKey]: open,
      },
    }));
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(31,111,235,0.18),_transparent_38%),linear-gradient(180deg,#0b1020_0%,#0f172a_100%)] text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 md:px-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Agent Relay</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Route one request to your own agent fleet, see agent host and agent status, and watch each run live.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/80 bg-card/95 shadow-[0_24px_60px_-28px_rgba(0,0,0,0.65)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <SendHorizontal className="h-4 w-4 text-primary" />
                New run
              </CardTitle>
              <CardDescription>Paste one or more pull request URLs. One per line.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Pull request URLs</label>
                  <Textarea
                    placeholder={"https://github.com/owner/repo/pull/123\nhttps://github.com/owner/repo/pull/456"}
                    value={prUrls}
                    onChange={(event) => setPrUrls(event.target.value)}
                    required
                    className="min-h-[120px]"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Extra instructions</label>
                  <Textarea
                    placeholder="Optional focus: security, migrations, missing tests, API regressions..."
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                  />
                </div>
                <Button className="w-full">Run relay</Button>
                <p className="min-h-5 text-sm text-muted-foreground">{submitStatus}</p>
              </form>
            </CardContent>
          </Card>

          <AgentHostsPanel agentsData={agentsData} onToggleAgent={handleToggleAgent} />
        </div>

        <section className="space-y-6">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-lg font-semibold">Jobs</h2>
          </div>

          <div className="space-y-6">
            <section className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active jobs</h3>
                <Separator />
              </div>
              {activeJobs.length === 0 ? (
                <Card className="border-dashed bg-card/60">
                  <CardContent className="p-5 text-sm text-muted-foreground">No active jobs.</CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {activeJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      logs={logsByJob[job.id] || {}}
                      openSections={openSections[job.id] || {}}
                      onSectionChange={(sectionKey, open) => setSectionOpen(job.id, sectionKey, open)}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted-foreground">Past jobs</h3>
                <Separator />
              </div>
              {pastJobs.length === 0 ? (
                <Card className="border-dashed bg-card/60">
                  <CardContent className="p-5 text-sm text-muted-foreground">No past jobs yet.</CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {pastJobs.map((job) => (
                    <JobCard
                      key={job.id}
                      job={job}
                      logs={logsByJob[job.id] || {}}
                      openSections={openSections[job.id] || {}}
                      onSectionChange={(sectionKey, open) => setSectionOpen(job.id, sectionKey, open)}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
