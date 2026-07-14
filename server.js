const { createServer } = require("node:http");
const path = require("node:path");

const next = require("./apps/landing/node_modules/next");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = "0.0.0.0";
const app = next({
  dev: false,
  dir: path.join(__dirname, "apps", "landing"),
  hostname,
  port,
});
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = createServer((request, response) => {
      handle(request, response);
    });

    server.listen(port, hostname, () => {
      console.log(`VercentLabs landing server listening on ${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error("Unable to start the VercentLabs landing server", error);
    process.exit(1);
  });
