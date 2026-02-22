async function test() {
  const baseUrl = "http://localhost:3000/api";

  console.log("1. Creating a source session...");
  const sourceId = "test-source-" + Date.now();
  const sourceRes = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: sourceId,
      name: "Source Session",
      provider: {
        endpoint: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-4o",
      },
      tools: { exec: true, web: false, memory: true },
      discord: { enabled: true, token: "discord-test-token" },
    }),
  });

  if (!sourceRes.ok) {
    console.error("Failed to create source session", await sourceRes.text());
    return;
  }
  console.log("Source session created.");

  console.log("2. Creating a target session copied from source...");
  const targetId = "test-target-" + Date.now();
  const targetRes = await fetch(`${baseUrl}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: targetId,
      name: "Target Session",
      copyFrom: sourceId,
    }),
  });

  if (!targetRes.ok) {
    console.error("Failed to create target session", await targetRes.text());
    return;
  }
  const targetData = await targetRes.json();
  console.log("Target session created:", targetData.session);

  console.log("3. Verifying settings...");
  const session = targetData.session;
  let failed = false;

  if (session.provider.apiKey !== "test-key") {
    console.error("❌ Provider API key mismatch");
    failed = true;
  }
  if (session.tools.web !== false) {
    console.error("❌ Tools config mismatch");
    failed = true;
  }
  if (!session.discord || session.discord.token !== "discord-test-token") {
    console.error("❌ Discord config mismatch");
    failed = true;
  }

  if (!failed) {
    console.log("✅ Settings copied successfully!");
  }
}

test().catch(console.error);
