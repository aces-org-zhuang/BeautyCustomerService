import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const server = createServer(createApp(config));

server.listen(config.port, () => {
  console.log(JSON.stringify({ ok: true, service: "beauty-customer-service", port: config.port, dataFile: config.dataFile }));
});
