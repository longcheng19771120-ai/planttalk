import { chmodSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const MIN_NODE = [20, 12, 0];
const envPath = resolve(".env");
const envExamplePath = resolve(".env.example");

function parseVersion(version) {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

function isNodeSupported() {
  const current = parseVersion(process.versions.node);
  for (let i = 0; i < MIN_NODE.length; i += 1) {
    if (current[i] > MIN_NODE[i]) return true;
    if (current[i] < MIN_NODE[i]) return false;
  }
  return true;
}

function hasConfiguredApiKey(contents) {
  const match = contents.match(/^OPENAI_API_KEY=(.*)$/m);
  if (!match) return false;
  const value = match[1].trim().replace(/^["']|["']$/g, "");
  return value.length > 0 && value !== "replace-me";
}

console.log("Plant Talk setup");

if (!isNodeSupported()) {
  console.error(`Node ${process.versions.node} is installed, but Plant Talk needs Node 20.12 or newer.`);
  console.error("Install a current Node.js LTS release, then run `npm run setup` again.");
  process.exit(1);
}

console.log(`Node ${process.versions.node} looks good.`);

if (!existsSync(envExamplePath)) {
  console.error("Could not find .env.example. Run this command from the Plant Talk repo root.");
  process.exit(1);
}

if (!existsSync(envPath)) {
  copyFileSync(envExamplePath, envPath);
  chmodSync(envPath, 0o600);
  console.log(`Created ${envPath}`);
} else {
  console.log(`Found existing ${envPath}; leaving it unchanged.`);
}

const envContents = readFileSync(envPath, "utf8");
const provider = readEnvValue(envContents, "AI_PROVIDER").toLowerCase() === "openai" ? "openai" : "local";

if (provider === "openai") {
  if (hasConfiguredApiKey(envContents)) {
    console.log("OpenAI API access appears configured. The key was not printed.");
  } else {
    console.log("OpenAI API access still needs to be added.");
    console.log("If you do not have a key yet, sign in at https://platform.openai.com/api-keys.");
    console.log(`Open ${envPath} and replace replace-me with your OpenAI API key.`);
    console.log("Do not paste the key into chat.");
  }
} else {
  await checkLocalModels(envContents);
}

function readEnvValue(contents, name) {
  const match = contents.match(new RegExp(`^${name}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

// Local mode: confirm the model server answers and the models are pulled.
async function checkLocalModels(contents) {
  const baseUrl = (readEnvValue(contents, "LOCAL_LLM_BASE_URL") || "http://127.0.0.1:11434/v1").replace(/\/$/, "");
  const visionModel = readEnvValue(contents, "LOCAL_VISION_MODEL") || "qwen2.5vl:7b";
  const chatModel = readEnvValue(contents, "LOCAL_CHAT_MODEL") || visionModel;
  console.log(`AI provider: local models at ${baseUrl}`);

  let modelIds;
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    modelIds = Array.isArray(data?.data) ? data.data.map((model) => String(model.id)) : [];
  } catch {
    console.log("The local model server is not reachable yet.");
    console.log("Install Ollama from https://ollama.com, make sure it is running, then run:");
    console.log(`  ollama pull ${visionModel}`);
    console.log("Then run `npm run setup` again.");
    return;
  }

  console.log("The local model server is running.");
  const matches = (wanted) =>
    modelIds.some((id) => id === wanted || id === `${wanted}:latest` || `${id}:latest` === wanted);
  for (const model of new Set([visionModel, chatModel])) {
    if (matches(model)) {
      console.log(`Model ${model} is available.`);
    } else {
      console.log(`Model ${model} is not downloaded yet. Run: ollama pull ${model}`);
    }
  }
}
