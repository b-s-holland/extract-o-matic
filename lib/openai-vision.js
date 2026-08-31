// lib/openai-vision.js
// Shared OpenAI vision call layer. The active model/API mode are read from
// environment variables at call time so .env.local is honoured by the local
// server. Source text is supplied by Google Vision; this layer is used for
// reference-only visual structure interpretation.

// Read as functions, not module-level constants -- a module-level
// `const X = process.env.X` gets evaluated the moment this file is
// imported, which for the local dev server happens BEFORE
// local-server.mjs's own .env.local loader runs (static imports resolve
// before a file's own runtime code, including an `await` further down
// that file). A module-level constant here would silently freeze to
// whatever process.env held before .env.local was ever read -- exactly
// the kind of silent-default problem this whole change exists to
// eliminate, just via a different mechanism than the one already found.
// Reading fresh on every call, the same way lib/ocr.js already safely
// reads GOOGLE_VISION_API_KEY, avoids this regardless of import order.
function config() {
  return {
    model: process.env.OPENAI_VISION_MODEL || 'gpt-5.6-sol',
    apiMode: process.env.OPENAI_API_MODE || 'chat_completions', // 'chat_completions' | 'responses'
    temperature: process.env.OPENAI_TEMPERATURE, // optional; omit entirely for reasoning models like GPT-5.6
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT // optional; e.g. "medium" -- only meaningful for reasoning-capable models
  };
}

// Exposed so callers (translate-core.js) can report exactly what ran in
// provenance, per stage, rather than the caller having to re-read env
// vars separately and risk drifting out of sync with what this file
// actually sent.
export function getVisionConfig() {
  const c = config();
  return { model: c.model, apiMode: c.apiMode };
}

export async function callVisionForStructure(systemPrompt, userContent, maxOutputTokens) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set.');
  }
  const { apiMode } = config();
  if (apiMode === 'responses') {
    return callViaResponses(systemPrompt, userContent, maxOutputTokens);
  }
  if (apiMode !== 'chat_completions') {
    throw new Error(`Unknown OPENAI_API_MODE "${apiMode}" -- expected "chat_completions" or "responses".`);
  }
  return callViaChatCompletions(systemPrompt, userContent, maxOutputTokens);
}

async function callViaChatCompletions(systemPrompt, userContent, maxOutputTokens) {
  const { model, temperature, reasoningEffort } = config();
  const body = {
    model,
    response_format: { type: 'json_object' },
    max_completion_tokens: maxOutputTokens || 4000,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  };
  if (temperature !== undefined && temperature !== '') {
    body.temperature = Number(temperature);
  }
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const choice = data.choices[0];
  return parseJsonResponse(choice.message.content, choice.finish_reason === 'length', maxOutputTokens);
}

// The structure prompt builder produces content blocks in Chat Completions' shape --
// {type:"text"} / {type:"image_url", image_url:{url}} -- since that's
// the format this file originally spoke exclusively. Rather than make
// every prompt builder aware of which API mode is active, this is the
// one place that translates to Responses' shape when needed.
function toResponsesContent(blocks) {
  return blocks.map((b) => {
    if (b.type === 'text') return { type: 'input_text', text: b.text };
    if (b.type === 'image_url') return { type: 'input_image', image_url: b.image_url.url };
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
    max_output_tokens: maxOutputTokens || 4000
  };
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const messageItem = (data.output || []).find((item) => item.type === 'message');
  const textContent = messageItem && messageItem.content && messageItem.content.find((c) => c.type === 'output_text');

  if (!textContent) {
    throw new Error(
      'Unexpected Responses API shape -- no message/output_text item found in output[]. ' +
      'This path was written against documented examples but could not be tested live from this environment. ' +
      'Raw response (truncated): ' + JSON.stringify(data).slice(0, 2000)
    );
  }

  const truncated = data.status === 'incomplete' || (data.incomplete_details && data.incomplete_details.reason === 'max_output_tokens');
  return parseJsonResponse(textContent.text, truncated, maxOutputTokens);
}

function parseJsonResponse(raw, wasTruncated, maxOutputTokens) {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // The most common real cause of "invalid JSON" here isn't the model
    // writing malformed JSON -- it's the response getting cut off mid-
    // string because it hit the output token limit. Surfacing that
    // plainly beats a confusing raw JSON.parse message either way,
    // regardless of which API produced it.
    if (wasTruncated) {
      const truncErr = new Error(
        `The model's response was cut off before it finished (hit the ${maxOutputTokens || 4000}-token output limit) ` +
        `rather than sending malformed JSON. The page-level structure result was incomplete; inspect the saved diagnostic rather than treating a larger token cap as the default fix.`
      );
      truncErr.rawResponse = raw;
      throw truncErr;
    }
    const parseErr = new Error('Model did not return valid JSON: ' + err.message);
    parseErr.rawResponse = raw;
    throw parseErr;
  }
}
