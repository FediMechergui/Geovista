/**
 * Build-time stub for `@spz-loader/core`.
 *
 * CesiumJS imports this package (an Emscripten module with its WebAssembly
 * binary inlined as a string) to decode Gaussian-splat glTFs. Turbopack's
 * minifier rewrites that binary string into an invalid template literal
 * ("Octal escape sequences are not allowed in template strings"), which
 * breaks the whole Cesium chunk. GeoVista never loads splat models, so the
 * package is aliased to this stub in `next.config.mjs`.
 */

export async function loadSpz(): Promise<never> {
  throw new Error('Gaussian-splat (SPZ) decoding is not enabled in GeoVista.');
}
