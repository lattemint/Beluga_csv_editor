/**
 * Zero-dependency static file server for dist/.
 *
 * Why this exists instead of `http-server`:
 *   - the offline path should not require anything installed globally,
 *   - and hitting a busy port should print a sentence, not a stack trace.
 *
 * Busy-port behaviour:
 *   - if the occupant is this same server, print the URL and exit quietly,
 *   - otherwise step to the next free port (up to +10).
 *
 * Usage:
 *   node scripts/serve.mjs            # 默认 5178
 *   node scripts/serve.mjs 5199       # 指定端口
 *   PORT=5199 node scripts/serve.mjs  # 或环境变量
 *   HOST=0.0.0.0 node scripts/serve.mjs   # 需要局域网访问时
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(projectRoot, 'dist');
/**
 * Where the self-check probes POST their assertion reports.
 *
 * Screenshots are useless to a text-only reader, so the probes send their report
 * here as plain text: `POST /__report?name=probe-h` with the report as the body
 * writes `.report/probe-h.txt`. Dev-only; the server is loopback by default.
 */
const reportRoot = join(projectRoot, '.report');
const host = process.env.HOST ?? '127.0.0.1';
const basePort = Number(process.argv[2] ?? process.env.PORT ?? 5178);
const SERVER_TAG = 'csv-editor-offline';

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  // Identity probe, used to tell "our server" apart from a stranger on the port.
  if (url.pathname === '/__alive') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'x-served-by': SERVER_TAG,
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify({ ok: true, root: distRoot }));
    return;
  }

  // Report sink for the self-check probes (dev only).
  if (req.method === 'POST' && url.pathname === '/__report') {
    const name = (url.searchParams.get('name') ?? 'report').replace(/[^A-Za-z0-9_-]/g, '');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        mkdirSync(reportRoot, { recursive: true });
        writeFileSync(join(reportRoot, `${name}.txt`), Buffer.concat(chunks).toString('utf8'), 'utf8');
        console.log(`[report] .report/${name}.txt`);
        res.writeHead(204, { 'cache-control': 'no-store' });
        res.end();
      } catch (error) {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(String(error));
      }
    });
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = normalize(join(distRoot, pathname));
  if (target !== distRoot && !target.startsWith(distRoot + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('403 forbidden');
    return;
  }

  let info;
  try {
    info = statSync(target);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`404 not found: ${pathname}`);
    return;
  }

  if (info.isDirectory()) {
    res.writeHead(301, { location: `${url.pathname}/` });
    res.end();
    return;
  }

  res.writeHead(200, {
    'content-type': MIME.get(extname(target).toLowerCase()) ?? 'application/octet-stream',
    'content-length': info.size,
    // Same intent as http-server's `-c-1`: a rebuild must be visible on refresh.
    'cache-control': 'no-store',
    'x-served-by': SERVER_TAG,
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const server = createServer(handle);
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

/** 'ours' | 'other' | 'unknown' */
async function probePort(port) {
  try {
    const response = await fetch(`http://${host}:${port}/__alive`, {
      signal: AbortSignal.timeout(900),
    });
    return response.headers.get('x-served-by') === SERVER_TAG ? 'ours' : 'other';
  } catch {
    return 'unknown';
  }
}

function banner(port) {
  console.log('');
  console.log('  Beluga CSV Editor · 本地预览');
  console.log(`  地址 : http://${host}:${port}/`);
  console.log(`  目录 : ${distRoot}`);
  console.log('  停止 : Ctrl+C');
  console.log('');
}

async function main() {
  if (!existsSync(join(distRoot, 'index.html'))) {
    console.error(`找不到 ${join(distRoot, 'index.html')}`);
    console.error('请先构建：node scripts/build-offline.mjs（或直接 npm start）');
    process.exit(1);
  }

  for (let offset = 0; offset <= 10; offset += 1) {
    const port = basePort + offset;
    try {
      await listen(port);
      banner(port);
      return;
    } catch (error) {
      if (!error || error.code !== 'EADDRINUSE') {
        console.error(`启动失败：${error ? error.message : String(error)}`);
        process.exit(1);
      }

      const occupant = await probePort(port);
      if (occupant === 'ours') {
        console.log('');
        console.log(`  端口 ${port} 上已经有一个本项目的预览服务在运行，没有重复启动。`);
        console.log(`  直接打开 : http://${host}:${port}/`);
        console.log('  （要重启就先关掉原来那个窗口；或用 PORT=5199 换一个端口）');
        console.log('');
        return;
      }

      console.log(
        `端口 ${port} 被${occupant === 'other' ? '其它程序' : '某个进程'}占用，改用 ${port + 1} …`,
      );
    }
  }

  console.error(`端口 ${basePort}–${basePort + 10} 都不可用。请用 PORT=xxxx 指定一个空闲端口。`);
  process.exit(1);
}

main();
