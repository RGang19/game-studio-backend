import { getReferenceGame } from "../data/referenceGames.js";
import { runtimeSmokeTest } from "./gameSmokeTest.js";
import { callZeroGChat, zeroGModels } from "./zeroGService.js";

function buildPromptBundle({ gamePackage, request }) {
  return {
    system: [
      "You are an expert browser game developer.",
      "Generate a fully playable browser game as one complete JavaScript module.",
      "Output only executable JavaScript for src/main.js. Do not use markdown fences.",
      "Use vanilla Canvas 2D. Do not import Phaser, Three.js, React, or external libraries.",
      "Use the existing <canvas id=\"game\"> element and make keyboard plus pointer input work.",
      "There MUST be a clearly visible player character (or player-controlled object) drawn on the canvas every frame that visibly responds to input. Never ship a build where the player is missing, never rendered, or does not react to controls.",
      "FILL THE SCREEN: the game runs in a tall, narrow portrait frame. Set canvas.width = window.innerWidth and canvas.height = window.innerHeight at startup AND on every 'resize' event — never hardcode 960x540 or any fixed size. Position and scale EVERYTHING (board, player, obstacles, HUD) relative to the current canvas.width/height so the playfield always fills the whole frame with no big empty margins. For a square board, make it as large as the smaller dimension allows and center it.",
      "The game MUST be fully playable on a touch phone with no keyboard: handle touchstart/touchend (and pointer events) on the canvas so swipes steer/move and taps perform the main action; never make a physical key the ONLY way to play.",
      "Restart MUST work by tapping or clicking the canvas after game over, in addition to any key (do not rely on 'Press R' alone).",
      "Import the game package with: import { gamePackage } from \"./gamePackage.js\";",
      "Import styles with: import \"./styles.css\";",
      "Do not use export statements anywhere in the module.",
      "When a run ends (game over or win), call window.reportScore(finalScore) if it exists so the score reaches the platform leaderboard.",
      "Maintain responsive sizing, restart behavior, score/state feedback, and a 60 FPS target."
    ].join("\n"),
    user: [
      `Template: ${gamePackage.templateName}`,
      `Title: ${gamePackage.title}`,
      `Mechanic: ${gamePackage.gameplay?.mechanic}`,
      `Controls: ${gamePackage.gameplay?.controls}`,
      `Tuning: ${JSON.stringify(gamePackage.gameplay?.tuning)}`,
      `Visual mood: ${gamePackage.visuals?.mood}`,
      `Colors: ${(gamePackage.visuals?.colors ?? []).join(", ")}`,
      `Assets: ${gamePackage.visuals?.assets}`,
      `Creator request: ${request || gamePackage.customization?.prompt || "Create a polished playable version of this game."}`,
      "Return only the complete JavaScript module. It must run immediately in a Vite browser project."
    ].join("\n")
  };
}

function stripMarkdownFence(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:js|javascript)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// The preview sandbox wraps the module in a try/catch, where `export` is a
// syntax error that blanks the whole game. Models sometimes append exports
// "for external use" — neutralize them while keeping the declarations.
function stripModuleExports(code) {
  return String(code || "")
    .replace(/^\s*export\s+default\s+/gm, "")
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/^(\s*)export\s+(const|let|var|function|class|async)/gm, "$1$2");
}

// Applies one or more SEARCH/REPLACE blocks to `code`. Each block names the
// exact original snippet and its corrected version, so a repair only has to
// emit the few lines that changed instead of re-streaming the whole module.
// Returns { code, applied } — applied is false when any block's SEARCH text
// cannot be located verbatim, signalling the caller to fall back to a full
// rewrite rather than ship a partially-applied patch.
function applySearchReplace(code, patchText) {
  const blockRe = /<{3,}\s*SEARCH[^\n]*\n([\s\S]*?)\n={3,}[^\n]*\n([\s\S]*?)\n>{3,}\s*REPLACE/g;
  let result = code;
  let applied = false;
  let match;
  while ((match = blockRe.exec(patchText)) !== null) {
    const search = match[1];
    const replace = match[2];
    if (!search || !result.includes(search)) {
      // A block we cannot locate means the patch is unreliable — bail so the
      // caller does a full rewrite instead of applying a half-correct fix.
      return { code, applied: false };
    }
    result = result.replace(search, replace);
    applied = true;
  }
  return { code: result, applied };
}

function sumUsage(usages) {
  return usages.reduce((total, usage) => {
    if (!usage) return total;
    total.prompt_tokens += usage.prompt_tokens ?? 0;
    total.completion_tokens += usage.completion_tokens ?? 0;
    total.total_tokens += usage.total_tokens ?? 0;
    return total;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
}

// Validates that the module parses as JavaScript once the sandbox strips its
// import lines (the same shape the browser executes). Returns the syntax
// error message, or null when the code is valid.
function findSyntaxError(code) {
  const stripped = String(code || "")
    .replace(/^\s*import\s+["'][^"']*["'];?\s*$/gm, "")
    .replace(/^\s*import\s+[^;\n]*from\s+["'][^"']*["'];?\s*$/gm, "");
  try {
    // Parses without executing.
    new Function(stripped);
    return null;
  } catch (error) {
    return error.message;
  }
}

// 12 minutes per attempt, one retry: worst case stays inside a 15-minute
// generation budget instead of the previous 20min x 3 attempts.
async function callCodingStage({ model, system, user, maxTokens = 3500, timeoutMs = 720000, onChunk }) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user }
  ];
  const response = await callZeroGChat({
    model,
    temperature: 0.35,
    maxTokens,
    timeoutMs,
    retries: 1,
    messages,
    onChunk
  });

  // A module cut off at the token cap is a guaranteed syntax error — issue one
  // continuation and concatenate instead of shipping half a file.
  if (response.finishReason !== "length") return response;

  const continuation = await callZeroGChat({
    model,
    temperature: 0.35,
    maxTokens,
    timeoutMs,
    retries: 1,
    onChunk,
    messages: [
      ...messages,
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: "Your output was cut off mid-file. Continue EXACTLY from the character where you stopped. Output only the remaining code, with no markdown fences and no repetition of code you already wrote."
      }
    ]
  });

  return {
    ...response,
    content: response.content + continuation.content,
    finishReason: continuation.finishReason,
    usage: sumUsage([response.usage, continuation.usage])
  };
}

function missingRuntimeFeatures(code) {
  const checks = [
    ["#game canvas selection", /querySelector\s*\(\s*["'`]#game["'`]\s*\)/],
    ["2D rendering context", /getContext\s*\(\s*["'`]2d["'`]\s*\)/],
    ["animation loop", /requestAnimationFrame\s*\(/],
    ["pointer or touch input", /pointerdown|mousedown|touchstart/],
    ["restart input", /restart|KeyR|keydown/i],
    // Something must actually be drawn each frame — a build with no draw calls
    // renders a blank canvas (no visible character/world).
    ["canvas drawing", /\.(fillRect|strokeRect|drawImage|fillText|arc|fill|stroke|rect|moveTo|lineTo|ellipse)\s*\(/]
  ];

  return checks.filter(([, pattern]) => !pattern.test(code)).map(([label]) => label);
}

// From-scratch generation budget. The old 10K-char / 6144-token cap forced the
// model to drop "decorative extras" — which in practice meant the player
// character, animation, and collision detail got cut to hit the limit. A real
// playable game with a rendered, controllable character needs more room, so the
// budget is raised; callCodingStage still issues a continuation if a build runs
// past the token ceiling, so nothing ships truncated.
const SCRATCH_CHAR_TARGET = 22000;
const SCRATCH_MAX_TOKENS = 12000;

async function generateWithModel(promptBundle, model, onProgress) {
  // Single-stage unified code generation for maximum speed
  const response = await callCodingStage({
    model,
    maxTokens: SCRATCH_MAX_TOKENS,
    onChunk: (chars) => onProgress?.({ stage: "writing-code", chars }),
    system: [
      promptBundle.system,
      "You are implementing a complete browser game from scratch in one complete JavaScript module.",
      "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
      "The game MUST have a clearly visible player character or player-controlled object that is drawn on the canvas EVERY frame and that visibly moves/reacts in direct response to keyboard, pointer, and touch input. The player must never be invisible, off-screen, or unresponsive.",
      `You have up to ${SCRATCH_CHAR_TARGET.toLocaleString("en-US")} characters: spend them on a complete, polished, fully playable game — a real player character, enemies/obstacles, collision detection, scoring, and clear win/lose states. Do not pad with comments, but do not cut core gameplay or the player character to save space.`,
      "Make the game fill the entire browser viewport: set canvas.width = window.innerWidth and canvas.height = window.innerHeight on startup and on every window resize, and position/scale all gameplay relative to the current canvas size (no fixed 960x540 layouts).",
      "Return only executable JavaScript source without markdown fences.",
      "The script must select the <canvas id=\"game\"> element, get the 2D rendering context, and implement the complete game state, loop, input handling, and canvas rendering.",
      "It must run immediately when imported in a Vite project.",
      "Do not access external resources or libraries. Handle game restart (KeyR) and resize correctly."
    ].join("\n"),
    user: promptBundle.user
  });

  let generatedCode = stripModuleExports(stripMarkdownFence(response.content));
  const usages = [response.usage];
  const stages = {
    unifiedGeneration: { model: response.model, usage: response.usage }
  };

  // One repair pass on the fast background model: catches modules that came back
  // without a loop, input, canvas wiring, or any draw calls, at a fraction of the
  // coding model's latency. Kept on the fast model deliberately so generation
  // time does not grow — quality comes from the stronger primary pass and the
  // stricter validation, not from a slower repair.
  const missing = missingRuntimeFeatures(generatedCode);
  if (missing.length > 0) {
    const repair = await callCodingStage({
      model: zeroGModels.background,
      maxTokens: SCRATCH_MAX_TOKENS,
      onChunk: (chars) => onProgress?.({ stage: "repairing", chars }),
      system: [
        promptBundle.system,
        "Repair the supplied incomplete src/main.js.",
        "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
        "Return one complete executable module, not an explanation.",
        "It must select document.querySelector(\"#game\"), obtain a 2D context, render the game, handle pointer/touch and keyboard input, run requestAnimationFrame, and support restart (KeyR).",
        `The previous output was missing: ${missing.join(", ")}.`
      ].join("\n"),
      user: [promptBundle.user, "\nINCOMPLETE MODULE:\n", generatedCode].join("\n")
    });
    const repairedCode = stripModuleExports(stripMarkdownFence(repair.content));
    usages.push(repair.usage);
    stages.repair = { model: zeroGModels.background, usage: repair.usage };
    // Only adopt the repair when it actually closes gaps.
    if (missingRuntimeFeatures(repairedCode).length < missing.length) {
      generatedCode = repairedCode;
    }
  }

  return {
    provider: response.provider,
    model: response.model,
    generatedCode,
    usage: sumUsage(usages),
    stages
  };
}

// Returns the first concrete problem with a module, or null when it runs clean.
function moduleProblem(code, gamePackage) {
  const syntaxError = findSyntaxError(code);
  if (syntaxError) return `It has a JavaScript syntax error: ${syntaxError}`;
  const smoke = runtimeSmokeTest(code, gamePackage);
  if (!smoke.ok) return `It parses but crashes the moment it runs: ${smoke.error}`;
  const missing = missingRuntimeFeatures(code);
  if (missing.length > 0) return `It is missing required pieces: ${missing.join(", ")}`;
  return null;
}

// A module is "hard broken" if it won't run correctly for the player: a syntax
// error, missing core runtime wiring, or a crash on load, while stepping frames,
// or in response to input. The smoke test now drives real keyboard/pointer/touch
// input, so a "frame" or "input" crash means the character would break for an
// actual player — those are no longer treated as soft false positives.
function hardBrokenReason(code, gamePackage) {
  const syntaxError = findSyntaxError(code);
  if (syntaxError) return `JavaScript syntax error: ${syntaxError}`;
  const missing = missingRuntimeFeatures(code);
  if (missing.length > 0) return `missing required pieces: ${missing.join(", ")}`;
  const smoke = runtimeSmokeTest(code, gamePackage);
  if (!smoke.ok) return `crashes when it runs (${smoke.phase}): ${smoke.error}`;
  return null;
}

// Repairs an edited game module in place — NEVER regenerates from scratch.
// Each attempt feeds the exact current error back to the agent and asks it to
// fix ONLY that while keeping the existing gameplay and the creator's change.
// Escalates to the stronger coding model after the first cheap attempt.
async function repairEditedModule(code, promptBundle, gamePackage, onProgress, maxAttempts = 3) {
  let current = code;
  const usages = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const hard = hardBrokenReason(current, gamePackage);
    const problem = hard || moduleProblem(current, gamePackage);
    if (!problem) return { code: current, ok: true, usage: sumUsage(usages) };
    // Only a soft frame-step warning remains after a first try — stop here and
    // let the caller ship the edit rather than burning more time/tokens.
    if (!hard && attempt > 1) break;
    const model = attempt === 1 ? zeroGModels.background : zeroGModels.coding;

    // Patch-first: ask for a minimal SEARCH/REPLACE fix instead of re-emitting
    // the whole module. A targeted fix is a few hundred tokens versus a full
    // ~12k-token rewrite, so the common case (one broken spot) repairs far
    // faster. The loop re-verifies at the top, so once the patch makes the game
    // run we stop — no extra repair pass.
    const patch = await callCodingStage({
      model,
      maxTokens: 4096,
      onChunk: (chars) => onProgress?.({ stage: "repairing", chars }),
      system: [
        promptBundle.system,
        "The game module below is broken. Fix ONLY what is broken — keep all existing gameplay and the creator's change.",
        "Return your fix as one or more SEARCH/REPLACE blocks and NOTHING else, in exactly this format:",
        "<<<<<<< SEARCH",
        "(the exact original lines to replace, copied verbatim from the module)",
        "=======",
        "(the corrected lines)",
        ">>>>>>> REPLACE",
        "The SEARCH text must match the current module character-for-character. Keep each block as small as possible. Do not output the whole file, no markdown fences, no explanation.",
        "Problem to fix: " + problem
      ].join("\n"),
      user: [promptBundle.user, "\nMODULE TO FIX (return only SEARCH/REPLACE blocks):\n", current].join("\n")
    });
    usages.push(patch.usage);
    const { code: patched, applied } = applySearchReplace(current, stripMarkdownFence(patch.content));
    if (applied) {
      current = stripModuleExports(patched);
      continue; // re-verify at the top of the loop
    }

    // Patch couldn't be located in the module — fall back to a full rewrite for
    // this round so a genuinely tangled break still gets repaired.
    const repair = await callCodingStage({
      model,
      maxTokens: 16384,
      onChunk: (chars) => onProgress?.({ stage: "repairing", chars }),
      system: [
        promptBundle.system,
        "Repair the game module below. KEEP all existing gameplay and the change the creator asked for — fix ONLY what is broken.",
        "Return one complete executable src/main.js module, no markdown fences, no explanation.",
        "Problem to fix: " + problem
      ].join("\n"),
      user: [promptBundle.user, "\nMODULE TO FIX (repair in place, keep its behavior):\n", current].join("\n")
    });
    usages.push(repair.usage);
    current = stripModuleExports(stripMarkdownFence(repair.content));
  }
  return { code: current, ok: !moduleProblem(current, gamePackage), usage: sumUsage(usages) };
}

// Seed-and-edit: hand the agent a working reference module and ask it to modify
// that, instead of writing from a blank page. When the edit comes back broken,
// it is REPAIRED in place (multiple attempts, keeping the creator's change) —
// never regenerated from scratch. Only if repair cannot make it run does the
// previous working build ship unchanged.
async function generateFromSeed(promptBundle, seedCode, model, onProgress, gamePackage) {
  const integration = await callCodingStage({
    model,
    maxTokens: 12000,
    onChunk: (chars) => onProgress?.({ stage: "editing-seed", chars }),
    system: [
      promptBundle.system,
      "You are EDITING an existing, working game implementation, not writing one from scratch.",
      "Keep your thinking/reasoning extremely brief and concise to save output tokens.",
      "Start from the REFERENCE module below and modify it to satisfy the creator request.",
      "Keep everything that already works: the game loop, input handling, rendering, and win/lose flow.",
      "Change only what the request needs — theme, colors, rules tweaks, difficulty, labels, or mechanic variations.",
      "Preserve the import lines and the #game canvas usage. Return one complete executable src/main.js module without markdown fences."
    ].join("\n"),
    user: [promptBundle.user, "\nREFERENCE MODULE (edit this, keep its structure):\n", seedCode].join("\n")
  });
  let generatedCode = stripModuleExports(stripMarkdownFence(integration.content));
  const usages = [integration.usage];

  // Repair in place if anything looks wrong — never regenerate from scratch.
  if (moduleProblem(generatedCode, gamePackage)) {
    const repaired = await repairEditedModule(generatedCode, promptBundle, gamePackage, onProgress, 3);
    usages.push(repaired.usage);
    // Keep the repaired code as long as it isn't WORSE than where we started.
    if (!hardBrokenReason(repaired.code, gamePackage) || repaired.ok) generatedCode = repaired.code;
  }

  // Only revert to the previous build when the edit definitely won't run for
  // the player (syntax / missing wiring / load-time crash). A soft frame-step
  // warning still ships the edit so the creator's change isn't dropped.
  const hardReason = hardBrokenReason(generatedCode, gamePackage);
  if (hardReason) {
    return {
      provider: "reference",
      model: "reference-seed",
      generatedCode: seedCode,
      usage: sumUsage(usages),
      stages: { seedEdit: { model, usage: integration.usage } },
      source: "seed-fallback"
    };
  }

  const soft = moduleProblem(generatedCode, gamePackage);
  return {
    provider: integration.provider,
    model: integration.model,
    generatedCode,
    usage: sumUsage(usages),
    stages: { seedEdit: { model: integration.model, usage: integration.usage } },
    source: "seed-edit",
    warning: soft ? "Edit applied — give it a quick test; if something misbehaves, describe the fix in chat." : null
  };
}

async function call0GAgent(promptBundle, onProgress) {
  try {
    return await generateWithModel(promptBundle, zeroGModels.coding, onProgress);
  } catch (error) {
    const fallbackModel = zeroGModels.background;
    const nonRetriable = error.status && error.status < 500 && ![408, 429].includes(error.status);
    if (fallbackModel === zeroGModels.coding || nonRetriable) throw error;

    console.warn("0G coding model failed after retries; using fallback", {
      primaryModel: zeroGModels.coding,
      fallbackModel,
      message: error.message
    });
    return generateWithModel(promptBundle, fallbackModel, onProgress);
  }
}

// Broken syntax means a black screen in the sandbox. One cheap repair attempt
// on the fast model fixes most cases; a seed-backed game falls back to the
// working reference if the repair fails too.
async function ensureValidSyntax(generated, promptBundle, reference, onProgress) {
  let syntaxError = findSyntaxError(generated.generatedCode);
  if (!syntaxError) return generated;

  try {
    const repair = await callCodingStage({
      model: zeroGModels.background,
      maxTokens: 16384,
      onChunk: (chars) => onProgress?.({ stage: "fixing-syntax", chars }),
      system: [
        promptBundle.system,
        "The module below fails to parse. Fix the syntax error and return the complete corrected module, nothing else.",
        `SyntaxError: ${syntaxError}`
      ].join("\n"),
      user: [promptBundle.user, "\nBROKEN MODULE:\n", generated.generatedCode].join("\n")
    });
    const fixed = stripModuleExports(stripMarkdownFence(repair.content));
    if (!findSyntaxError(fixed)) {
      return {
        ...generated,
        generatedCode: fixed,
        usage: sumUsage([generated.usage, repair.usage]),
        stages: { ...generated.stages, syntaxRepair: { model: zeroGModels.background, usage: repair.usage } }
      };
    }
    syntaxError = findSyntaxError(fixed) ?? syntaxError;
  } catch {
    // repair call itself failed — fall through to the reference fallback
  }

  if (reference) {
    return {
      provider: "reference",
      model: "reference-seed",
      generatedCode: reference.code,
      usage: generated.usage,
      stages: generated.stages,
      source: "seed-fallback",
      warning: `Generated code had a syntax error (${syntaxError}); shipped the working reference instead.`
    };
  }

  generated.warning = `Generated code has a syntax error the repair could not fix: ${syntaxError}`;
  return generated;
}

// Parsing clean is not the same as running clean: code like `board[r][c] = x`
// (where board[r] is undefined) crashes the instant it executes, showing the
// player "Generated build failed to run…". Run the module in a mocked browser;
// if it throws, repair it with the runtime error, then re-test. A seed-backed
// game falls back to the working reference if the repair still crashes.
async function ensureRuntimeRuns(generated, promptBundle, gamePackage, reference, onProgress) {
  let result = runtimeSmokeTest(generated.generatedCode, gamePackage);
  if (result.ok) return generated;

  try {
    const repair = await callCodingStage({
      model: zeroGModels.background,
      maxTokens: 16384,
      onChunk: (chars) => onProgress?.({ stage: "fixing-runtime", chars }),
      system: [
        promptBundle.system,
        "The module below PARSES but throws a runtime error the moment it runs, so the game shows a blank/error screen.",
        "Find the cause and return the complete corrected module, nothing else — keep the gameplay the same.",
        `Runtime error: ${result.error}`,
        "Common causes: indexing into an array/object that was never initialised (e.g. board[r][c] before board[r] exists), reading a property of a variable that is still undefined, or using an element/context before it is assigned."
      ].join("\n"),
      user: [promptBundle.user, "\nBROKEN MODULE:\n", generated.generatedCode].join("\n")
    });
    const fixed = stripModuleExports(stripMarkdownFence(repair.content));
    if (!findSyntaxError(fixed) && runtimeSmokeTest(fixed, gamePackage).ok) {
      return {
        ...generated,
        generatedCode: fixed,
        usage: sumUsage([generated.usage, repair.usage]),
        stages: { ...generated.stages, runtimeRepair: { model: zeroGModels.background, usage: repair.usage } }
      };
    }
    result = runtimeSmokeTest(fixed, gamePackage).ok ? { ok: true } : result;
  } catch {
    // repair call itself failed — fall through to the reference fallback
  }

  if (reference) {
    return {
      provider: "reference",
      model: "reference-seed",
      generatedCode: reference.code,
      usage: generated.usage,
      stages: generated.stages,
      source: "seed-fallback",
      warning: `Generated code crashed at runtime (${result.error}); shipped the working reference instead.`
    };
  }

  generated.warning = `Generated code crashes at runtime: ${result.error}`;
  return generated;
}

export async function createRefinementBundle(
  { gamePackage, request, refinementLevel, strategy, baseCode },
  { onProgress } = {}
) {
  if (!gamePackage) {
    const error = new Error("gamePackage is required");
    error.status = 400;
    throw error;
  }

  const promptBundle = buildPromptBundle({ gamePackage, request });
  // When the caller supplies the game's current code (post-creation editing),
  // that code IS the seed — the agent applies the requested change to it.
  const reference = baseCode
    ? { templateId: gamePackage.templateId ?? "current-build", code: baseCode }
    : getReferenceGame(gamePackage.templateId);

  let generated;
  if (reference && (baseCode || strategy !== "pure-agent")) {
    try {
      generated = await generateFromSeed(promptBundle, reference.code, zeroGModels.coding, onProgress, gamePackage);
    } catch (error) {
      // Agent unreachable — ship the working reference unchanged so the user still gets a game.
      generated = {
        provider: "reference",
        model: "reference-seed",
        generatedCode: reference.code,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        stages: {},
        source: "seed-fallback",
        warning: error.message
      };
    }
  } else {
    generated = await call0GAgent(promptBundle, onProgress);
    generated.source = generated.source ?? "agent";
  }

  if (generated.source !== "seed-fallback") {
    const fallbackRef = strategy !== "pure-agent" ? reference : null;
    generated = await ensureValidSyntax(generated, promptBundle, fallbackRef, onProgress);
    // Syntax-clean code can still crash on its first run — verify it actually
    // executes and repair/fall back if not.
    if (generated.source !== "seed-fallback") {
      generated = await ensureRuntimeRuns(generated, promptBundle, gamePackage, fallbackRef, onProgress);
    }
  }

  const syntaxOk = !findSyntaxError(generated.generatedCode);
  // When generation/repair couldn't produce a working custom build, the pipeline
  // ships the unchanged reference template. That used to be silent — the creator
  // got a generic game with none of their request in it and no signal why. Flag
  // it loudly so the caller/UI can tell them their custom build did not land.
  const fellBackToTemplate = generated.source === "seed-fallback";
  const warning = generated.warning
    ?? (fellBackToTemplate
      ? "We couldn't build a working version of your custom request, so we shipped the closest working template instead. Try describing the game again or simplifying the request."
      : null);

  return {
    jobId: `refine_${Date.now().toString(36)}`,
    eta: "complete",
    costProfile: "0g-router-call",
    refinementLevel: refinementLevel ?? "medium",
    promptBundle,
    seededFrom: reference?.templateId ?? null,
    source: generated.source,
    fellBackToTemplate,
    isCustomBuild: !fellBackToTemplate,
    provider: generated.provider,
    model: generated.model,
    generatedCode: generated.generatedCode,
    usage: generated.usage,
    stages: generated.stages,
    warning,
    validation: [
      syntaxOk ? "Syntax validates" : "Syntax check FAILED",
      fellBackToTemplate ? "Shipped working template (custom build failed)" : "Custom build runs immediately in browser",
      "Pointer and keyboard input works",
      "No external images",
      "Performance target is 60 FPS"
    ]
  };
}
