import http from "node:http";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 4311;
const UPSTREAM_HOST = "127.0.0.1";
const UPSTREAM_PORT = 4310;
const PREFIX = "/agent-relay";
const ASSET_VERSION = "agent-relay=20260325a";

function sendText(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function mapUpstreamPath(urlString) {
  const url = new URL(urlString, `http://${LISTEN_HOST}:${LISTEN_PORT}`);

  if (url.pathname === "/") {
    return {
      redirectTo: `${PREFIX}/`,
      statusCode: 302,
    };
  }

  if (url.pathname === PREFIX) {
    return {
      redirectTo: `${PREFIX}/${url.search}`,
      statusCode: 302,
    };
  }

  if (!url.pathname.startsWith(`${PREFIX}/`)) {
    return null;
  }

  return {
    pathname: url.pathname,
    upstreamPath: `${url.pathname.slice(PREFIX.length) || "/"}${url.search}`,
  };
}

function rewriteHtml(body) {
  const rewritten = body
    .replaceAll('href="/', `href="${PREFIX}/`)
    .replaceAll('src="/', `src="${PREFIX}/`);

  return rewritten.replace(/(src|href)="(\/agent-relay\/app\.js)"/g, `$1="$2?${ASSET_VERSION}"`);
}

function rewriteJs(body) {
  return body
    .replaceAll('"/api/', `"${PREFIX}/api/`)
    .replaceAll("'/api/", `'${PREFIX}/api/`)
    .replaceAll("`/api/", `\`${PREFIX}/api/`);
}

function rewriteBody(pathname, contentType, body) {
  if (contentType.includes("text/html")) {
    return rewriteHtml(body);
  }
  if (
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/x-javascript")
  ) {
    return rewriteJs(body);
  }
  return body;
}

function shouldRewrite(contentType = "") {
  return (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/x-javascript")
  );
}

function cacheControlFor(contentType = "") {
  if (
    contentType.includes("text/html") ||
    contentType.includes("text/javascript") ||
    contentType.includes("application/javascript") ||
    contentType.includes("application/x-javascript")
  ) {
    return "no-store";
  }
  return null;
}

function filterProxyHeaders(headers) {
  return {
    ...headers,
    host: `${UPSTREAM_HOST}:${UPSTREAM_PORT}`,
    "accept-encoding": "identity",
    connection: "close",
  };
}

const server = http.createServer((req, res) => {
  const mapped = mapUpstreamPath(req.url ?? "/");

  if (!mapped) {
    sendText(res, 404, "Not found\n");
    return;
  }

  if (mapped.redirectTo) {
    res.writeHead(mapped.statusCode, { Location: mapped.redirectTo });
    res.end();
    return;
  }

  const upstreamReq = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: mapped.upstreamPath,
      headers: filterProxyHeaders(req.headers),
    },
    (upstreamRes) => {
      const contentType = upstreamRes.headers["content-type"] ?? "";
      if (!shouldRewrite(contentType)) {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
        return;
      }

      const chunks = [];
      upstreamRes.on("data", (chunk) => chunks.push(chunk));
      upstreamRes.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const rewrittenBody = rewriteBody(mapped.pathname, contentType, body);
      const headers = { ...upstreamRes.headers };
      delete headers["content-length"];
      delete headers["content-encoding"];
      const cacheControl = cacheControlFor(contentType);
      if (cacheControl) {
        headers["cache-control"] = cacheControl;
      }
      headers["content-length"] = Buffer.byteLength(rewrittenBody);
      res.writeHead(upstreamRes.statusCode ?? 502, headers);
      res.end(rewrittenBody);
      });
    }
  );

  upstreamReq.on("error", (error) => {
    sendText(res, 502, `Agent Relay upstream is unavailable: ${error.message}\n`);
  });

  req.pipe(upstreamReq);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `[agent-relay-proxy] listening on http://${LISTEN_HOST}:${LISTEN_PORT}${PREFIX}/ -> http://${UPSTREAM_HOST}:${UPSTREAM_PORT}/`
  );
});
