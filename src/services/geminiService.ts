import { AnalysisResult } from "../types";

export async function analyzeText(text: string): Promise<AnalysisResult> {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Analysis failed");
  }

  return response.json();
}
