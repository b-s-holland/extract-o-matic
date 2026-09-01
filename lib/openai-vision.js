// lib/openai-vision.js
// Minimal multimodal call layer for direct page reconstruction.

function config() {
  return {
    model: process.env.OPENAI_VISION_MODEL || 'gpt-5.6-sol',
    apiMode: process.env.OPENAI_API_MODE || 'chat_completions',
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT
  };
}

export function getVisionConfig() {
  const c = config();
  return { model: c.model, apiMode: c.apiMode };
}

export async function callVisionForReconstruction(systemPrompt, userContent, maxOutputTokens) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
  const { apiMode } = config();
  if (apiMode === 'responses') return callViaResponses(systemPrompt, userContent, maxOutputTokens);
  if (apiMode === 'chat_completions') return callViaChatCompletions(systemPrompt, userContent, maxOutputTokens);
  throw new Error(`Unknown OPENAI_API_MODE "${apiMode}" -- expected "chat_completions" or "responses".`);
}

async function callViaChatCompletions(systemPrompt, userContent, maxOutputTokens) {
  const { model, reasoningEffort } = config();
  const body = {
    model,
    response_format: { type: 'json_object' },
    max_completion_tokens: maxOutputTokens || 10000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const choice = data.choices && data.choices[0];
  if (!choice || !choice.message) throw new Error('OpenAI returned no completion message.');
  return parseJsonResponse(choice.message.content || '', choice.finish_reason === 'length', maxOutputTokens);
}

function toResponsesContent(blocks) {
  return blocks.map((b) => {
    if (b.type === 'text') return { type: 'input_text', text: b.text };
    if (b.type === 'image_url') return { type: 'input_image', image_url: b.image_url.url, detail: b.image_url.detail || 'high' };
    return b;
  });
}

async function callViaResponses(systemPrompt, userContent, maxOutputTokens) {
  const { model, reasoningEffort } = config();
  const body = {
    model,
    instructions: systemPrompt,
    input: [{ role: 'user', content: toResponsesContent(userContent) }],
    text: { format: { type: 'json_object' } },
    max_output_tokens: maxOutputTokens || 10000
  };
  if (reasoningEffort) body.reasoning = { effort: reasoningEffort };

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`OpenAI API error (${res.status}): ${await res.text()}`);

  const data = await res.json();
  const message = (data.output || []).find((item) => item.type === 'message');
  const text = message && (message.content || []).find((item) => item.type === 'output_text');
  if (!text) throw new Error('OpenAI Responses API returned no output_text item.');
  const truncated = data.status === 'incomplete' || (data.incomplete_details && data.incomplete_details.reason === 'max_output_tokens');
  return parseJsonResponse(text.text || '', truncated, maxOutputTokens);
}

function parseJsonResponse(raw, wasTruncated, maxOutputTokens) {
  let cleaned = String(raw || '').trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    if (wasTruncated) throw new Error(`The reconstruction was cut off at the ${maxOutputTokens || 10000}-token output limit. Try fewer pages.`);
    const e = new Error('Model did not return valid JSON: ' + err.message);
    e.rawResponse = raw;
    throw e;
  }
}
