import dotenv from "dotenv";
dotenv.config();
import { generateGameFromPrompt } from "./src/services/promptPipelineService.js";

const fmt = ms => (ms == null ? "—" : (ms/1000).toFixed(2) + "s");
const wall = Date.now();
console.log("Starting snake generation (strategy=hybrid, plan+code+image)...\n");
try {
  const r = await generateGameFromPrompt({
    prompt: "a classic snake game",
    strategy: "hybrid",
    includePlan: true,
    includeCode: true,
    includeAssets: true
  });
  const t = r.timings;
  console.log("=== RESULT ===");
  console.log("Title:        ", r.game.title);
  console.log("Template:     ", r.selection.templateId);
  console.log("Code source:  ", r.refinement?.source, r.refinement?.fellBackToTemplate ? "(FELL BACK TO TEMPLATE)" : "(custom build)");
  console.log("Code length:  ", r.refinement?.generatedCode?.length, "chars");
  console.log("Code warning: ", r.refinement?.warning ?? "none");
  console.log("Models:       ", JSON.stringify({route:r.game.generation.routingModel, code:r.game.generation.codeModel, plan:r.game.generation.planModel, image:r.game.generation.imageModel}));
  console.log("\n=== PER-PROCESS TIME ===");
  console.log("1. Routing+variation :", fmt(t.routing));
  console.log("   (parallel block below — plan, code, image run concurrently)");
  console.log("2. Plan/orchestrator :", fmt(t.plan));
  console.log("3. Code generation   :", fmt(t.code));
  console.log("4. Image/thumbnail   :", fmt(t.image));
  console.log("   Parallel block wall:", fmt(t.parallel));
  console.log("-----------------------------------------");
  console.log("TOTAL (function)     :", fmt(t.total));
  console.log("TOTAL (wall incl req):", fmt(Date.now() - wall));
  if (r.warnings?.length) console.log("\nWarnings:", r.warnings);
} catch (e) {
  console.error("Generation FAILED after", fmt(Date.now()-wall), "\n", e);
  process.exit(1);
}
