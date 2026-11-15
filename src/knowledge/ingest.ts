import type { IngestJob, WorkerStatus } from "./shapes";

export type IngestDisplay = "done" | "failed" | "queued" | "running" | "unknown";

export interface IngestDisplayOptions {
  /**
   * Whether the backend runs asynchronous ingest jobs. Default false: Prism's
   * ingest is synchronous until its jobs land, so a queued or running state is
   * not something this client can confirm.
   */
  jobsAvailable?: boolean;
}

/**
 * What one ingest job shows (owner's rule). Until jobs are available, only
 * `done` and `failed` are shown; everything else is `unknown`. With jobs,
 * `queued` and `running` show only while the worker's heartbeat is fresh
 * (`now - heartbeatAt <= staleAfterMs`). The client derives liveness itself and
 * never trusts a stored `running` on a stale heartbeat. `unknown` is never
 * rendered as `running`.
 *
 * `alarm` means nothing is processing: a job waiting on (queued) or claiming
 * (running) a worker whose heartbeat is stale or missing.
 */
export function deriveIngestDisplay(job: IngestJob, worker: WorkerStatus | null, now: number, options: IngestDisplayOptions = {}): { display: IngestDisplay; alarm: boolean } {
  if (job.state === "done" || job.state === "failed") return { display: job.state, alarm: false };
  if (!options.jobsAvailable) return { display: "unknown", alarm: false };
  const beat = worker?.heartbeatAt ? Date.parse(worker.heartbeatAt) : Number.NaN;
  const fresh = worker !== null && Number.isFinite(beat) && now - beat <= worker.staleAfterMs;
  if (fresh) return { display: job.state, alarm: false };
  return { display: "unknown", alarm: true };
}
