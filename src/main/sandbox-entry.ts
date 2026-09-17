/**
 * Entry point of the isolated sandbox child processes (pm.* scripts and user
 * plugins). Built as its own bundle, `out/main/sandbox.js`.
 *
 * Why it exists: the children run the Electron binary as plain Node
 * (`ELECTRON_RUN_AS_NODE=1`), and in that mode the built-in `electron` module
 * does NOT exist. The app used to re-fork its own main bundle, whose first lines
 * `require('electron')` — which resolves in development only because the
 * `electron` npm package is on disk there. In a packaged app the require throws,
 * the child dies before reading its message, and every script fails with
 * «Script sandbox stopped». This entry pulls in the sandbox hosts and nothing
 * that touches Electron.
 *
 * The child's role comes from the environment, the same way the main bundle used
 * to branch on it.
 */
import { startPluginSandboxHost } from './plugins/host'
import { startSandboxHost } from './scripting'

if (process.env.RELAY_PLUGIN_SANDBOX === '1') startPluginSandboxHost()
else startSandboxHost()
