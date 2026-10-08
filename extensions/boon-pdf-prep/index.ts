import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { PLUGIN_ID, registerBoonPdfPrep } from "./src/register.js";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Boon PDF Prep",
  description:
    "Queues inbound PDFs for background text preparation with pdf-index and adds a short preparation status note to the model input.",
  register: (api) => registerBoonPdfPrep(api),
});
