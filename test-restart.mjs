import fetch from "node-fetch";

async function run() {
  const result = await fetch("http://localhost:3000/api/tools", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "dev-key",
      "x-session-id": "default",
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content:
            "AIの自己改変テストです。self_restartツールを理由「手動テスト」で呼び出してください。",
        },
      ],
    }),
  });
  console.log(await result.json());
}
run();
