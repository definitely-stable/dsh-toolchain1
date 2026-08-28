import readline from 'node:readline'

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })

for await (const line of input) {
  const message = JSON.parse(line)
  if (message.type !== 'start') process.exitCode = 2
  process.stderr.write('provider adapter crashed\n')
  process.exitCode = 7
  break
}
