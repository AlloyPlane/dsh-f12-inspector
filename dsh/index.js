// dsh-f12-inspector: host half.
//
// Registers a small JSON API on the DSH web server that the client inspector
// uses to browse the workspace, read pages, and save edits. All file access
// goes through DSH's official `fs` service (resolve / listDir / stat /
// readText / writeText), so:
//   - '' or '.'        -> the fs default cwd (workspace root)
//   - 'a/b'            -> relative to the cwd
//   - '/abs/path'      -> absolute path (resolved as-is)
// which is exactly the resolution rule DSH's own file tools follow.
//
// Routes (web profile):
//   POST /api/f12-inspector
//     { op: 'list', path }            -> { ok, entries: [{ name, type, size }] }
//     { op: 'read', path }            -> { ok, path, content }
//     { op: 'write', path, content }  -> { ok: true }
//
// Remove the bundle row (dsh plugin remove / patch) to turn it off.

export const name = 'dsh-f12-inspector'

/** Services required before the route can be registered. */
export const inject = ['webServer', 'fs']

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => { data += c })
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')) } catch (e) { reject(e) }
    })
    req.on('error', reject)
  })
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

export function apply(ctx) {
  const webServer = ctx.webServer
  const fs = ctx.fs

  webServer.register({
    kind: 'exact',
    path: '/api/f12-inspector',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      let body
      try { body = await readBody(req) } catch { send(res, 400, { ok: false, error: 'invalid json body' }); return }

      try {
        if (body.op === 'list') {
          const p = (body.path && body.path !== '.') ? body.path : '.'
          const target = await fs.resolve(p)
          const entries = await fs.listDir(target)
          const out = entries.map((e) => ({
            name: e.name,
            type: e.type === 'directory' ? 'dir' : 'file',
            size: typeof e.size === 'number' ? e.size : 0,
          }))
          out.sort((a, b) =>
            a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1))
          send(res, 200, { ok: true, path: target.displayPath, entries: out })
          return
        }

        if (body.op === 'read') {
          if (!body.path || typeof body.path !== 'string') { send(res, 400, { ok: false, error: 'empty path' }); return }
          const target = await fs.resolve(body.path)
          const content = await fs.readText(target)
          send(res, 200, { ok: true, path: target.displayPath, content })
          return
        }

        if (body.op === 'write') {
          if (!body.path || typeof body.path !== 'string') { send(res, 400, { ok: false, error: 'empty path' }); return }
          const target = await fs.resolve(body.path)
          await fs.writeText(target, String(body.content ?? ''))
          send(res, 200, { ok: true })
          return
        }

        send(res, 400, { ok: false, error: 'unknown op' })
      } catch (err) {
        send(res, 400, { ok: false, error: String((err && err.message) || err) })
      }
    },
  })
}
