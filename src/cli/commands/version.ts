import type { CliContext } from '../types'
import { output } from '../output'
import { getVersion } from '../../macros/version.macro'

export async function runVersion(ctx: CliContext): Promise<number> {
  output(ctx.format, getVersion())
  return 0
}
