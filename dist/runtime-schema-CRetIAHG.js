import "./agent-scope-XIomFVd1.js";
import { c as resolveDefaultAgentId, o as resolveAgentWorkspaceDir } from "./agent-scope-config-DrIvffiJ.js";
import { a as resolvePluginMetadataSnapshot } from "./plugin-metadata-snapshot-LFbHtBWe.js";
import { D as collectChannelSchemaMetadata, O as collectPluginSchemaMetadata, i as getRuntimeConfig, u as readConfigFileSnapshot } from "./io-T6HZMVrs.js";
import "./config-Dft2iRNk.js";
import { t as buildConfigSchema } from "./schema-DbUEA1tc.js";
//#region src/config/runtime-schema.ts
function loadManifestRegistry(config, env) {
	const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
	return resolvePluginMetadataSnapshot({
		config,
		env: env ?? process.env,
		workspaceDir,
		allowWorkspaceScopedCurrent: true
	}).manifestRegistry;
}
/** Builds the config schema from the active runtime config and plugin metadata. */
function loadGatewayRuntimeConfigSchema() {
	const registry = loadManifestRegistry(getRuntimeConfig());
	return buildConfigSchema({
		plugins: collectPluginSchemaMetadata(registry),
		channels: collectChannelSchemaMetadata(registry)
	});
}
async function readBestEffortRuntimeConfigSchema() {
	const snapshot = await readConfigFileSnapshot();
	const registry = loadManifestRegistry(snapshot.valid ? snapshot.config : { plugins: { enabled: true } });
	return buildConfigSchema({
		plugins: snapshot.valid ? collectPluginSchemaMetadata(registry) : [],
		channels: collectChannelSchemaMetadata(registry)
	});
}
//#endregion
export { readBestEffortRuntimeConfigSchema as n, loadGatewayRuntimeConfigSchema as t };
