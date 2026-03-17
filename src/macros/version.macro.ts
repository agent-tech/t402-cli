import pkg from '../../package.json'

export function getVersion() {
  return {
    name: pkg.name as string,
    version: pkg.version as string,
  }
}
