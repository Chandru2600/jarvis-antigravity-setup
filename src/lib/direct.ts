/**
 * Direct fallback mode.
 * The primary AI brain is Google Gemini via the local bridge (npm run bridge).
 */

export type Msg = {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export type AskHandlers = {
  /** Fires for each chunk of the spoken answer. */
  onText: (delta: string) => void
  /** Fires when a tool starts running. */
  onTool: (name: string) => void
}

export async function ask(
  _messages: Msg[],
  handlers: AskHandlers,
): Promise<{ text: string; tools: string[] }> {
  const note = 'Please run npm run bridge to connect to Google Gemini.'
  handlers.onText(note)
  return { text: note, tools: [] }
}
