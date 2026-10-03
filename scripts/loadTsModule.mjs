import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRootUrl = new URL('../', import.meta.url)
const appRootUrl = new URL('../app/', import.meta.url)

registerHooks({
  resolve(specifier, context, nextResolve) {
    let fileUrl
    let isAlias = false
    if (specifier.startsWith('~~/')) {
      fileUrl = new URL(specifier.slice(3), repoRootUrl)
      isAlias = true
    }
    else if (specifier.startsWith('~/')) {
      fileUrl = new URL(specifier.slice(2), appRootUrl)
      isAlias = true
    }
    else if (context.parentURL && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      fileUrl = new URL(specifier, context.parentURL)
    }

    if (fileUrl) {
      if (!extname(fileUrl.pathname)) {
        const tsUrl = new URL(`${fileUrl.href}.ts`)
        if (existsSync(fileURLToPath(tsUrl)))
          return nextResolve(tsUrl.href, context)
      }
      if (isAlias)
        return nextResolve(fileUrl.href, context)
    }
    return nextResolve(specifier, context)
  },
})

export function loadTsModule(specifier, parentUrl) {
  return import(new URL(specifier, parentUrl).href)
}
