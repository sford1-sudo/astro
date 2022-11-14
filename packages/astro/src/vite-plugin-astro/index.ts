import type { PluginContext, SourceDescription } from 'rollup';
import type * as vite from 'vite';
import type { AstroSettings } from '../@types/astro';
import type { LogOptions } from '../core/logger/core.js';
import type { PluginMetadata as AstroPluginMetadata } from './types';

import ancestor from 'common-ancestor-path';
import esbuild from 'esbuild';
import slash from 'slash';
import { fileURLToPath } from 'url';
import { cachedCompilation, CompileProps, getCachedSource } from '../core/compile/index.js';
import { isRelativePath, prependForwardSlash, startsWithForwardSlash } from '../core/path.js';
import { viteID } from '../core/util.js';
import { getFileInfo } from '../vite-plugin-utils/index.js';
import { handleHotUpdate } from './hmr.js';
import { parseAstroRequest, ParsedRequestResult } from './query.js';

const FRONTMATTER_PARSE_REGEXP = /^\-\-\-(.*)^\-\-\-/ms;
interface AstroPluginOptions {
	settings: AstroSettings;
	logging: LogOptions;
}

/** Transform .astro files for Vite */
export default function astro({ settings, logging }: AstroPluginOptions): vite.Plugin {
	const { config } = settings;
	function normalizeFilename(filename: string) {
		if (filename.startsWith('/@fs')) {
			filename = filename.slice('/@fs'.length);
		} else if (filename.startsWith('/') && !ancestor(filename, config.root.pathname)) {
			filename = new URL('.' + filename, config.root).pathname;
		}
		return filename;
	}
	function relativeToRoot(pathname: string) {
		const arg = startsWithForwardSlash(pathname) ? '.' + pathname : pathname;
		const url = new URL(arg, config.root);
		return slash(fileURLToPath(url)) + url.search;
	}

	let resolvedConfig: vite.ResolvedConfig;

	// Variables for determining if an id starts with /src...
	const srcRootWeb = config.srcDir.pathname.slice(config.root.pathname.length - 1);
	const isBrowserPath = (path: string) => path.startsWith(srcRootWeb) && srcRootWeb !== '/';
	const isFullFilePath = (path: string) =>
		path.startsWith(prependForwardSlash(slash(fileURLToPath(config.root))));

	function resolveRelativeFromAstroParent(id: string, parsedFrom: ParsedRequestResult): string {
		const filename = normalizeFilename(parsedFrom.filename);
		const resolvedURL = new URL(id, `file://${filename}`);
		const resolved = resolvedURL.pathname;
		if (isBrowserPath(resolved)) {
			return relativeToRoot(resolved + resolvedURL.search);
		}
		return slash(fileURLToPath(resolvedURL)) + resolvedURL.search;
	}

	return {
		name: 'astro:build',
		enforce: 'pre', // run transforms before other plugins can
		configResolved(_resolvedConfig) {
			resolvedConfig = _resolvedConfig;
		},
		// note: don’t claim .astro files with resolveId() — it prevents Vite from transpiling the final JS (import.meta.glob, etc.)
		async resolveId(id, from, opts) {
			// If resolving from an astro subresource such as a hoisted script,
			// we need to resolve relative paths ourselves.
			if (from) {
				const parsedFrom = parseAstroRequest(from);
				const isAstroScript = parsedFrom.query.astro && parsedFrom.query.type === 'script';
				if (isAstroScript && isRelativePath(id)) {
					return this.resolve(resolveRelativeFromAstroParent(id, parsedFrom), from, {
						custom: opts.custom,
						skipSelf: true,
					});
				}
			}

			// serve sub-part requests (*?astro) as virtual modules
			const { query } = parseAstroRequest(id);
			if (query.astro) {
				// Convert /src/pages/index.astro?astro&type=style to /Users/name/
				// Because this needs to be the id for the Vite CSS plugin to property resolve
				// relative @imports.
				if (query.type === 'style' && isBrowserPath(id)) {
					return relativeToRoot(id);
				}
				// Convert file paths to ViteID, meaning on Windows it omits the leading slash
				if (isFullFilePath(id)) {
					return viteID(new URL('file://' + id));
				}
				return id;
			}
		},
		async load(id, opts) {
			const parsedId = parseAstroRequest(id);
			const query = parsedId.query;
			if (!query.astro) {
				return null;
			}
			let filename = parsedId.filename;
			// For CSS / hoisted scripts we need to load the source ourselves.
			// It should be in the compilation cache at this point.
			let raw = await this.resolve(filename, undefined);
			if (!raw) {
				return null;
			}

			let source = getCachedSource(config, raw.id);
			if (!source) {
				return null;
			}

			const compileProps: CompileProps = {
				astroConfig: config,
				viteConfig: resolvedConfig,
				filename,
				source,
			};

			switch (query.type) {
				case 'style': {
					if (typeof query.index === 'undefined') {
						throw new Error(`Requests for Astro CSS must include an index.`);
					}

					const transformResult = await cachedCompilation(compileProps);
					const csses = transformResult.css;
					const code = csses[query.index];

					return {
						code,
						meta: {
							vite: {
								isSelfAccepting: true,
							},
						},
					};
				}
				case 'script': {
					if (typeof query.index === 'undefined') {
						throw new Error(`Requests for hoisted scripts must include an index`);
					}
					// HMR hoisted script only exists to make them appear in the module graph.
					if (opts?.ssr) {
						return {
							code: `/* client hoisted script, empty in SSR: ${id} */`,
						};
					}

					const transformResult = await cachedCompilation(compileProps);
					const scripts = transformResult.scripts;
					const hoistedScript = scripts[query.index];

					if (!hoistedScript) {
						throw new Error(`No hoisted script at index ${query.index}`);
					}

					if (hoistedScript.type === 'external') {
						const src = hoistedScript.src!;
						if (src.startsWith('/') && !isBrowserPath(src)) {
							const publicDir = config.publicDir.pathname.replace(/\/$/, '').split('/').pop() + '/';
							throw new Error(
								`\n\n<script src="${src}"> references an asset in the "${publicDir}" directory. Please add the "is:inline" directive to keep this asset from being bundled.\n\nFile: ${filename}`
							);
						}
					}

					let result: SourceDescription & { meta: any } = {
						code: '',
						meta: {
							vite: {
								lang: 'ts',
							},
						},
					};

					switch (hoistedScript.type) {
						case 'inline': {
							let { code, map } = hoistedScript;
							result.code = appendSourceMap(code, map);
							break;
						}
						case 'external': {
							const { src } = hoistedScript;
							result.code = `import "${src}"`;
							break;
						}
					}

					return result;
				}
				default:
					return null;
			}
		},
		async transform(this: PluginContext, source, id, opts) {
			const parsedId = parseAstroRequest(id);
			const query = parsedId.query;
			if (!id.endsWith('.astro') || query.astro) {
				return;
			}
			// if we still get a relative path here, vite couldn't resolve the import
			if (isRelativePath(parsedId.filename)) {
				return;
			}

			const filename = normalizeFilename(parsedId.filename);
			const compileProps: CompileProps = {
				astroConfig: config,
				viteConfig: resolvedConfig,
				filename,
				source,
			};

			try {
				const transformResult = await cachedCompilation(compileProps);
				const { fileId: file, fileUrl: url } = getFileInfo(id, config);

				for (const dep of transformResult.cssDeps) {
					this.addWatchFile(dep);
				}

				// Compile all TypeScript to JavaScript.
				// Also, catches invalid JS/TS in the compiled output before returning.
				const { code, map } = await esbuild.transform(transformResult.code, {
					loader: 'ts',
					sourcemap: 'external',
					sourcefile: id,
					// Pass relevant Vite options, if needed:
					define: config.vite?.define,
				});

				let SUFFIX = '';
				SUFFIX += `\nconst $$file = ${JSON.stringify(file)};\nconst $$url = ${JSON.stringify(
					url
				)};export { $$file as file, $$url as url };\n`;
				// Add HMR handling in dev mode.
				if (!resolvedConfig.isProduction) {
					let i = 0;
					while (i < transformResult.scripts.length) {
						SUFFIX += `import "${id}?astro&type=script&index=${i}&lang.ts";`;
						i++;
					}
				}

				// Prefer live reload to HMR in `.astro` files
				if (!resolvedConfig.isProduction) {
					SUFFIX += `\nif (import.meta.hot) { import.meta.hot.decline() }`;
				}

				const astroMetadata: AstroPluginMetadata['astro'] = {
					clientOnlyComponents: transformResult.clientOnlyComponents,
					hydratedComponents: transformResult.hydratedComponents,
					scripts: transformResult.scripts,
				};

				return {
					code: `${code}${SUFFIX}`,
					map,
					meta: {
						astro: astroMetadata,
						vite: {
							// Setting this vite metadata to `ts` causes Vite to resolve .js
							// extensions to .ts files.
							lang: 'ts',
						},
					},
				};
			} catch (err: any) {
				// Verify frontmatter: a common reason that this plugin fails is that
				// the user provided invalid JS/TS in the component frontmatter.
				// If the frontmatter is invalid, the `err` object may be a compiler
				// panic or some other vague/confusing compiled error message.
				//
				// Before throwing, it is better to verify the frontmatter here, and
				// let esbuild throw a more specific exception if the code is invalid.
				// If frontmatter is valid or cannot be parsed, then continue.
				const scannedFrontmatter = FRONTMATTER_PARSE_REGEXP.exec(source);
				if (scannedFrontmatter) {
					try {
						await esbuild.transform(scannedFrontmatter[1], {
							loader: 'ts',
							sourcemap: false,
							sourcefile: id,
						});
					} catch (frontmatterErr: any) {
						// Improve the error by replacing the phrase "unexpected end of file"
						// with "unexpected end of frontmatter" in the esbuild error message.
						if (frontmatterErr && frontmatterErr.message) {
							frontmatterErr.message = frontmatterErr.message.replace(
								'end of file',
								'end of frontmatter'
							);
						}
						throw frontmatterErr;
					}
				}

				// improve compiler errors
				if (err.stack && err.stack.includes('wasm-function')) {
					const search = new URLSearchParams({
						labels: 'compiler',
						title: '🐛 BUG: `@astrojs/compiler` panic',
						template: '---01-bug-report.yml',
						'bug-description': `\`@astrojs/compiler\` encountered an unrecoverable error when compiling the following file.

**${id.replace(fileURLToPath(config.root), '')}**
\`\`\`astro
${source}
\`\`\``,
					});
					err.url = `https://github.com/withastro/astro/issues/new?${search.toString()}`;
					err.message = `Error: Uh oh, the Astro compiler encountered an unrecoverable error!

    Please open
    a GitHub issue using the link below:
    ${err.url}`;

					if (logging.level !== 'debug') {
						// TODO: remove stack replacement when compiler throws better errors
						err.stack = `    at ${id}`;
					}
				}

				throw err;
			}
		},
		async handleHotUpdate(context) {
			if (context.server.config.isProduction) return;
			const compileProps: CompileProps = {
				astroConfig: config,
				viteConfig: resolvedConfig,
				filename: context.file,
				source: await context.read(),
			};
			const compile = () => cachedCompilation(compileProps);
			return handleHotUpdate(context, {
				config,
				logging,
				compile,
			});
		},
	};
}

function appendSourceMap(content: string, map?: string) {
	if (!map) return content;
	return `${content}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(
		map
	).toString('base64')}`;
}
