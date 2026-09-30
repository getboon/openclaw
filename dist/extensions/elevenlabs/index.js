import { t as definePluginEntry } from "../../plugin-entry-BZpzqykQ.js";
import { t as elevenLabsMediaUnderstandingProvider } from "../../media-understanding-provider-CAv9g1Ux.js";
import { t as buildElevenLabsRealtimeTranscriptionProvider } from "../../realtime-transcription-provider-ygrkUxQf.js";
import { t as buildElevenLabsSpeechProvider } from "../../speech-provider-DOccn0is.js";
//#region extensions/elevenlabs/index.ts
var elevenlabs_default = definePluginEntry({
	id: "elevenlabs",
	name: "ElevenLabs Speech",
	description: "Bundled ElevenLabs speech provider",
	register(api) {
		api.registerSpeechProvider(buildElevenLabsSpeechProvider());
		api.registerMediaUnderstandingProvider(elevenLabsMediaUnderstandingProvider);
		api.registerRealtimeTranscriptionProvider(buildElevenLabsRealtimeTranscriptionProvider());
	}
});
//#endregion
export { elevenlabs_default as default };
