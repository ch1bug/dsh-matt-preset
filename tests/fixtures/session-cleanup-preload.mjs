/**
 * #154 scheduling fixture, loaded only in verify-session-cleanup's child.
 * Hold a REAL JSONL compression completion across cleanup enumeration. On the
 * unfixed caller, release it just before the final sessions rmdir and observe
 * real log publication before letting native rmdir run (no invented error).
 * A caller awaiting persistence instead joins the real write, which this gate
 * releases after a bounded window. Missing instrumentation is never a pass.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import zlib from 'node:zlib'
import { syncBuiltinESMExports } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

const held = new Set()
let released = false
let overlaps = 0
const compress = zlib.zstdCompress
zlib.zstdCompress = (...args) => {
  const persistenceWrite = new Error().stack.includes('session-persistence-jsonl')
  const callback = args.pop()
  return compress(...args, (...result) => {
    if (!persistenceWrite || released) return callback(...result)
    const release = () => {
      if (!held.delete(release)) return
      callback(...result)
    }
    held.add(release)
    console.log('[session-cleanup] real compression held')
    setTimeout(() => {
      if (!held.has(release)) return
      released = true
      console.log('[session-cleanup] completion released before cleanup')
      release()
    }, 400)
  })
}

const rmdir = fs.rmdir
const calls = new Map()
fs.rmdir = (...args) => {
  const path = String(args[0])
  if (!/dsh-matt-ws-[^\\/]+[\\/]data[\\/]sessions$/.test(path)) return rmdir(...args)
  const count = (calls.get(path) ?? 0) + 1
  calls.set(path, count)
  // Node rimraf tries rmdir first, enumerates on ENOTEMPTY, then tries again.
  if (count !== 2 || held.size === 0) return rmdir(...args)
  overlaps++
  released = true
  console.log('[session-cleanup] cleanup overlapped pending persistence')
  for (const release of [...held]) release()
  ;(async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const entries = await fsp.readdir(path, { recursive: true }).catch(error => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      if (entries.some(entry => /session\.v4\.jsonl\.zstd$/.test(entry))) {
        console.log('[session-cleanup] real log published after enumeration')
        return rmdir(...args)
      }
      await delay(10)
    }
    throw new Error('session-cleanup probe: real log publication was not observed')
  })().catch(error => {
    // Complete the intercepted callback as a failure, rather than leave a
    // top-level await unsettled or accidentally return exit 0.
    args.at(-1)(error)
  })
}
syncBuiltinESMExports()
process.on('exit', () => console.log(`[session-cleanup] pending=${held.size} overlaps=${overlaps}`))
