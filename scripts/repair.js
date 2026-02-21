const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");

async function main() {
  const errorLogPath = process.argv[2];
  if (!errorLogPath || !fs.existsSync(errorLogPath)) {
    console.error("[repair] No error log provided or file not found.");
    process.exit(1);
  }

  const errorLog = fs.readFileSync(errorLogPath, "utf-8");
  console.log(`[repair] Analyzing crash log (${errorLog.length} bytes)...`);

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error("[repair] config.json not found. Cannot initialize OpenAI.");
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  const sessionConfig =
    config.sessions?.default || Object.values(config.sessions || {})[0];
  const providerConfig = sessionConfig?.provider;

  if (!providerConfig || !providerConfig.apiKey) {
    console.error("[repair] No OpenAI API key found in config.json.");
    process.exit(1);
  }

  const openai = new OpenAI({
    baseURL:
      providerConfig.endpoint === "https://api.openai.com/v1"
        ? undefined
        : providerConfig.endpoint,
    apiKey: providerConfig.apiKey,
  });

  const model = providerConfig.model || "gpt-4o";

  // Extract potential file paths from the error log to provide context
  const srcFiles = findSrcFilesInLog(errorLog);
  let fileContexts = "";
  for (const file of srcFiles) {
    const fullPath = path.resolve(ROOT, file);
    if (fs.existsSync(fullPath)) {
      fileContexts += `\n--- ${file} ---\n${fs.readFileSync(fullPath, "utf-8")}\n`;
    }
  }

  const prompt = `You are an expert TypeScript developer and auto-repair agent.
The mini-claw application just crashed on startup or execution. Here is the stderr log:

<error_log>
${errorLog}
</error_log>

Relevant files involved in the crash (if any):
<files>
${fileContexts}
</files>

Your task:
Analyze the error and the files.
If there is a clear code error (e.g. syntax error, undefined variable, import error), fix the code.
Return ONLY valid JSON that containing the file path and the complete new file content.
Do NOT use markdown code blocks like \`\`\`json. Just the raw JSON object.
Format:
{
  "file": "src/path/to/broken/file.ts",
  "content": "new full content of the file"
}
If you cannot determine how to fix it, return exactly: { "error": "Cannot fix" }`;

  console.log("[repair] Sending repair request to OpenAI...");

  try {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    const resultText = response.choices[0]?.message?.content?.trim() || "";

    // Attempt to parse JSON
    let parsed = null;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      // In case the AI still wraps in markdown
      const match = resultText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (match) {
        parsed = JSON.parse(match[1]);
      }
    }

    if (!parsed || parsed.error || !parsed.file || !parsed.content) {
      console.error(
        "[repair] AI could not provide a fix or returned invalid format.",
      );
      process.exit(1);
    }

    const targetFile = path.resolve(ROOT, parsed.file);
    if (!targetFile.startsWith(path.join(ROOT, "src"))) {
      console.error(
        "[repair] AI attempted to write outside of src/. Aborting. Target:",
        targetFile,
      );
      process.exit(1);
    }

    fs.writeFileSync(targetFile, parsed.content, "utf-8");
    console.log(
      `[repair] Successfully applied fix to ${parsed.file}. It will be restarted.`,
    );
    process.exit(0);
  } catch (err) {
    console.error("[repair] Error calling OpenAI API:", err.message);
    process.exit(1);
  }
}

function findSrcFilesInLog(log) {
  // Simple regex to find paths like src/something.ts or src\something.ts
  const regex = /src[/\\][a-zA-Z0-9_./\\]+\.ts/g;
  const matches = log.match(regex) || [];
  return [...new Set(matches)]; // Unique paths
}

main().catch(console.error);
