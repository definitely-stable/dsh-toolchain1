import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const [mode, ...args] = process.argv.slice(2)
const self = fileURLToPath(import.meta.url)

switch (mode) {
  case 'exit': {
    const [code = '0', stdout = '', stderr = ''] = args
    if (stdout.length > 0) process.stdout.write(stdout)
    if (stderr.length > 0) process.stderr.write(stderr)
    process.exit(Number.parseInt(code, 10))
    break
  }
  case 'sleep': {
    const [duration = '60000'] = args
    setTimeout(() => process.exit(0), Number.parseInt(duration, 10))
    break
  }
  case 'stdout': {
    const [bytes = '0'] = args
    process.stdout.write('x'.repeat(Number.parseInt(bytes, 10)))
    break
  }
  case 'stderr': {
    const [bytes = '0'] = args
    process.stderr.write('x'.repeat(Number.parseInt(bytes, 10)))
    break
  }
  case 'spawn-grandchild': {
    const child = spawn(process.execPath, [self, 'sleep', '60000'], {
      stdio: 'ignore',
    })
    if (child.pid === undefined) throw new Error('Grandchild process did not expose a pid.')
    process.stdout.write(`${child.pid}\n`)
    setTimeout(() => process.exit(0), 60000)
    break
  }
  default:
    throw new Error(`Unknown verification child mode: ${mode ?? '<missing>'}`)
}
