process.stdin.setEncoding("utf8");
let buf = "";
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method === "initialize") {
      respond(msg.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "echo", version: "1.0" } });
    } else if (msg.method === "tools/list") {
      respond(msg.id, { tools: [{ name: "echo", description: "回显输入文本", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } }] });
    } else if (msg.method === "tools/call") {
      respond(msg.id, { content: [{ type: "text", text: `echo: ${msg.params?.arguments?.text ?? "(空)"}` }] });
    } else if (msg.id !== undefined) {
      respond(msg.id, {});
    }
  }
});
