import { NextResponse } from "next/server";
import { runPipeline } from "@/server/pipeline/runPipeline";
import { getRecentPipelineRuns } from "@/server/db/pipelineRuns";

/** Manually trigger a pipeline run (dev/testing convenience - the worker
 * process is the normal cron-driven entry point). */
export async function POST() {
  const result = await runPipeline();
  return NextResponse.json(result);
}

export async function GET() {
  const runs = await getRecentPipelineRuns();
  return NextResponse.json({ runs });
}
