import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import OpenAI from 'openai'
import { registerOpenAiRoutes } from './openaiSuggestionRoute'

dotenv.config()

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

const port = Number(process.env.PORT ?? '8787')
const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const apiKey = process.env.OPENAI_API_KEY

const openai = apiKey ? new OpenAI({ apiKey }) : undefined

registerOpenAiRoutes(app, {
  model,
  apiKeyPresent: Boolean(apiKey),
  openai
})

app.listen(port, () => {
  console.log(`[saff] OpenAI proxy listening on http://localhost:${port}`)
})
