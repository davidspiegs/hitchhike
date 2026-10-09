import type { SubmitOutcome } from "./store";

export interface Described {
  status: number;
  code: string;
  message: string;
  errors?: string[];
}

/** What the relay tells a worker after it submits, worded for how it submitted (HTTP or MCP tools). */
export function describeSubmit(out: SubmitOutcome, via: "http" | "mcp" = "http"): Described {
  const again = via === "http" ? "POST again to the same URL" : "call submit_result again with the same claim_id";
  const recheck = via === "http" ? "Check for jobs again" : "Call get_next_job";
  switch (out.kind) {
    case "accepted":
      return {
        status: 200,
        code: "ACCEPTED",
        message:
          `Thanks. Your result for "${out.job.title}" is with ${out.job.from_agent}.` +
          (out.errors.length ? ` It was accepted with these problems flagged for them: ${out.errors.join(" ")}` : ""),
      };
    case "question_sent":
      return {
        status: 200,
        code: "QUESTION_SENT",
        message: `${out.job.from_agent} will see your question. The job comes back to you with their answer at a later check.`,
      };
    case "recorded_failure":
      return { status: 200, code: "RECORDED", message: "The job is marked as failed with your reason. Thanks for saying so." };
    case "already_done":
      return {
        status: 200,
        code: "ALREADY_DONE",
        message: `This job was already completed${out.job.result_by ? ` by ${out.job.result_by}` : ""}. Nothing more to do.`,
      };
    case "closed":
      return { status: 200, code: "CLOSED", message: `This job is ${out.job.status}, so your result isn't needed.` };
    case "stale":
      return {
        status: 409,
        code: "SENT_BACK",
        message: `This claim is no longer current: its lease expired, another worker took over, or the job changed. ${recheck} to obtain the current task and claim before submitting.`,
      };
    case "rejected":
      return {
        status: 422,
        code: "NOT_ACCEPTED",
        errors: out.errors,
        message:
          `Fix these and ${again}:\n${out.errors.map((e) => `- ${e}`).join("\n")}\n` +
          (out.triesLeft > 0
            ? `You have ${out.triesLeft} more ${out.triesLeft === 1 ? "try" : "tries"} before it's accepted as-is.`
            : "Your next submission will be accepted as-is, with these problems flagged for the requester."),
      };
    case "unknown":
      return {
        status: 404,
        code: "UNKNOWN",
        message: via === "http" ? "This submit URL isn't valid. Check for jobs again to get a fresh one." : "That claim_id isn't valid. Call get_next_job to get a fresh one.",
      };
  }
}
