// Synchronous reservation happens before the first await; parallel submissions cannot overspend this process cap.
export class VisionBudget {
  reservedUsd = 0;
  calls = 0;
  active = 0;
  disabled = false;
  inputTokens = 0;
  outputTokens = 0;
  reserve(cap: number, estimate: number): boolean {
    if (
      this.disabled ||
      this.active >= 1 ||
      this.reservedUsd + estimate > cap + 1e-9
    )
      return false;
    this.reservedUsd += estimate;
    this.calls++;
    this.active++;
    return true;
  }
  finish(usage?: { input_tokens?: number; output_tokens?: number }) {
    this.active = Math.max(0, this.active - 1);
    this.inputTokens += Math.max(0, usage?.input_tokens ?? 0);
    this.outputTokens += Math.max(0, usage?.output_tokens ?? 0);
  }
}
export const visionBudget = new VisionBudget();
