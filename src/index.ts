#!/usr/bin/env node

import { runCli } from './cli/program'

export { runCli }

if (import.meta.main) {
  runCli(process.argv.slice(2))
}
