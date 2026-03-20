import type { CliContext, SetupOptions } from '../types'
import { output } from '../output'

export async function runSetup(ctx: CliContext, opts: SetupOptions): Promise<number> {
  const { runSetup: runSetupImpl } = await import('../../setup')
  const result = await runSetupImpl(opts.fromEnv ? { fromEnv: opts.fromEnv } : undefined)
  output(ctx.format, { status: 'success', saved: result.saved })
  return 0
}
