import type { Application, Request, Response } from 'express'
import OpenAI from 'openai'
import { z } from 'zod'
import { SuggestionGenerationResponseSchema } from '../../../packages/shared/src/schemas'

type OpenAiRouteConfig = {
  model: string
  apiKeyPresent: boolean
  openai?: OpenAI
}

const requestSchema = z.object({
  system: z.string().min(1),
  user: z.string().min(1),
  schemaVersion: z.string().optional()
})

export function registerOpenAiRoutes(app: Application, config: OpenAiRouteConfig) {
  app.get('/api/llm/status', (_req: Request, res: Response) => {
    if (!config.apiKeyPresent) {
      res.status(503).json({ ok: false, error: 'OPENAI_API_KEY_MISSING' })
      return
    }

    res.json({ ok: true, model: config.model })
  })

  app.post('/api/llm/suggestions', async (req: Request, res: Response) => {
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request payload.' })
      return
    }

    if (!config.apiKeyPresent || !config.openai) {
      res.status(503).json({ error: 'OPENAI_API_KEY_MISSING' })
      return
    }

    try {
      const completion = await config.openai.chat.completions.create({
        model: config.model,
        messages: [
          { role: 'system', content: parsed.data.system },
          { role: 'user', content: parsed.data.user }
        ],
        response_format: { type: 'json_object' },
        temperature: 0
      })

      const content = completion.choices[0]?.message?.content
      if (!content) {
        res.status(502).json({ error: 'OpenAI returned an empty response.' })
        return
      }

      let json: unknown
      try {
        json = JSON.parse(content)
      } catch (error) {
        res.status(502).json({ error: 'OpenAI response was not valid JSON.' })
        return
      }

      const validated = SuggestionGenerationResponseSchema.safeParse(json)
      if (!validated.success) {
        res.status(502).json({ error: 'OpenAI response failed schema validation.' })
        return
      }

      res.json(validated.data)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OpenAI request failed.'
      res.status(502).json({ error: message })
    }
  })
}
