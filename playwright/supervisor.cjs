const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { fork, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { ActivityDeadline, hash } = require('./watchdog.cjs');
const exec = promisify(execFile);
const root = __dirname, state = path.join(root, 'monitor-state');
fs.mkdirSync(state, { recursive: true });
const pipe = '\\\\.\\pipe\\GWPC-Quoting-' + hash(root.toLowerCase()).slice(0, 24);
const server = net.createServer(socket => socket.end('running'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'monitor-config.json')));
const paused = () => fs.existsSync(path.join(state, 'paused'));
let worker, stopping = false, lastStatus = 0;
function log(message) {
  const filename = path.join(state, 'monitor.log');
  if (fs.existsSync(filename) && fs.statSync(filename).size > 2097152) { fs.copyFileSync(filename, filename + '.previous'); fs.truncateSync(filename); }
  fs.appendFileSync(filename, new Date().toISOString() + ' ' + message + '\n');
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function cleanup() {
  await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'owned-browser.ps1')], { windowsHide: true });
}
async function stopWorker() {
  if (!worker) return;
  const child = worker;
  if (child.connected) child.send({ type: 'close' }, () => {});
  const until = Date.now() + config.closeGraceMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < until) await sleep(200);
  // Only our still-owned direct child PID; never kill by image name or port.
  if (child.exitCode === null && child.signalCode === null) await exec('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  await cleanup(); worker = null;
}
async function run() {
  log('Supervisor started');
  try {
    while (!stopping && !paused()) {
      await cleanup();
      const deadline = new ActivityDeadline(config.inactivityMs);
      let exited = false, browserReady = false;
      lastStatus = 0;
      worker = fork(path.join(root, 'launch.cjs'), ['--worker'], { cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      worker.once('exit', () => { exited = true; });
      worker.once('error', () => { exited = true; log('Worker could not start'); });
      worker.on('message', message => {
        if (message?.type === 'activity') deadline.observe(message.fingerprint);
        if (message?.type === 'ready') { browserReady = true; log('Browser connected; page monitoring active'); }
        if (message?.type === 'failure') log('Worker reported a browser/launch failure');
      });
      log('Worker started PID ' + worker.pid);
      while (!stopping && !paused() && !exited && !deadline.expired()) {
        if (Date.now() - lastStatus >= 5000) {
          fs.writeFileSync(path.join(state, 'status.json'), JSON.stringify({ supervisorPid: process.pid, workerPid: worker.pid, browserReady, checkedAt: new Date().toISOString(), unchangedSeconds: Math.floor((performance.now() - deadline.changedAt) / 1000) }));
          lastStatus = Date.now();
        }
        await sleep(500);
      }
      log(stopping || paused() ? 'Stopping by request' : exited ? 'Worker exited; restarting' : 'Foreground inactivity deadline reached; restarting');
      await stopWorker();
      if (!stopping && !paused()) await sleep(config.restartDelayMs);
    }
  } finally { await stopWorker(); log('Supervisor stopped'); server.close(); }
}
server.on('error', error => { if (error.code !== 'EADDRINUSE') { console.error(error.message); process.exitCode = 1; } });
server.listen(pipe, () => { run().catch(error => { log('Supervisor failure: ' + error.code); process.exitCode = 1; server.close(); }); });
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
