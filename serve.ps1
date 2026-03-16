param(
  [int]$Port = 8000,
  [string]$BindAddress = '192.168.122.59'
)

if (Get-Command node -ErrorAction SilentlyContinue) {
  $root = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
  $script = @'
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 8000);
const host = process.argv[4] || "192.168.122.59";
const requestHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
const moonbaseDir = path.join(root, "assets", "models", "Moonbase");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".obj": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function toWebPath(...segments) {
  return `./${segments.join("/").replace(/\\/g, "/")}`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleize(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function buildModelManifest() {
  const files = fs.readdirSync(moonbaseDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const imagePattern = /\.(png|jpe?g)$/i;
  const objFiles = files
    .filter((file) => /\.obj$/i.test(file))
    .sort((a, b) => a.localeCompare(b));
  const imageFiles = files
    .filter((file) => imagePattern.test(file))
    .sort((a, b) => a.localeCompare(b));

  const groundFile = imageFiles.find((file) => /^moonsurface\.(png|jpe?g)$/i.test(file)) || null;
  const moduleTextures = imageFiles.filter((file) => file !== groundFile);
  const texturePathLookup = new Map(
    moduleTextures.map((file) => [path.basename(file, path.extname(file)).toLowerCase(), file]),
  );

  const models = objFiles.map((file, index) => {
    const stem = path.basename(file, path.extname(file));
    const objText = fs.readFileSync(path.join(moonbaseDir, file), "utf8");
    const mtllibMatch = objText.match(/^\s*mtllib\s+(.+)$/m);
    const mtllibFile = mtllibMatch ? mtllibMatch[1].trim() : null;
    const mtlPath =
      mtllibFile && fs.existsSync(path.join(moonbaseDir, mtllibFile))
        ? toWebPath("assets", "models", "Moonbase", mtllibFile)
        : null;
    const matchedTexture =
      texturePathLookup.get(stem.toLowerCase()) ||
      (moduleTextures.length > 0 ? moduleTextures[index % moduleTextures.length] : null);

    return {
      id: slugify(stem),
      label: titleize(stem),
      note: mtlPath
        ? `MTL: ${path.basename(mtllibFile)}`
        : matchedTexture
          ? `Texture: ${path.basename(matchedTexture)}`
          : "Autoloaded moonbase module",
      mtlPath,
      objPath: toWebPath("assets", "models", "Moonbase", file),
      texturePath: matchedTexture ? toWebPath("assets", "models", "Moonbase", matchedTexture) : null
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    groundTexture: groundFile ? toWebPath("assets", "models", "Moonbase", groundFile) : null,
    models
  };
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${requestHost}:${port}`);
  let pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname === "/api/models") {
    try {
      const manifest = buildModelManifest();
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(JSON.stringify(manifest));
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const filePath = path.resolve(path.join(root, `.${pathname}`));
  const insideRoot = filePath === root || filePath.startsWith(`${root}${path.sep}`);

  if (!insideRoot) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`Serving ${root}`);
  console.log(`Local:   http://localhost:${port}`);

  if (host === "0.0.0.0" || host === "::") {
    const interfaces = os.networkInterfaces();
    const lanAddresses = [];

    for (const entries of Object.values(interfaces)) {
      for (const entry of entries || []) {
        if (!entry || entry.internal) {
          continue;
        }

        if (entry.family === "IPv4" || entry.family === 4) {
          lanAddresses.push(entry.address);
        }
      }
    }

    for (const address of [...new Set(lanAddresses)]) {
      console.log(`Network: http://${address}:${port}`);
    }
  } else {
    console.log(`Bound:   http://${host}:${port}`);
  }
});
'@

  $script | node - $root $Port $BindAddress
  exit $LASTEXITCODE
}

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -m http.server $Port --bind $BindAddress
  exit $LASTEXITCODE
}

if (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $Port --bind $BindAddress
  exit $LASTEXITCODE
}

Write-Error "Python was not found. Install Python or run any static file server from C:\Users\tskil\Documents\CorridorEditor."
