import Anthropic from '@anthropic-ai/sdk'
import { createApp } from './app.js'
import { ConfigError, loadConfig, type Config } from './lib/config.js'

const HOST = '127.0.0.1'

function loadConfigOrExit(): Config {
  try {
    return loadConfig()
  } catch (error) {
    if (error instanceof ConfigError) {
      // The message names the variables only, never their values.
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }
}

const config = loadConfigOrExit()
const client = new Anthropic({ apiKey: config.anthropicApiKey })
const app = createApp({ client, config })

// Bound to loopback only: anyone who can reach the port can spend the API key.
app.listen(config.port, HOST, error => {
  if (error) {
    console.error(JSON.stringify({ level: 'error', operation: 'startup', errorType: error.constructor.name, message: error.message }))
    process.exit(1)
  }
  console.log(JSON.stringify({ level: 'info', operation: 'startup', address: `http://${HOST}:${config.port}`, model: config.model }))
})
