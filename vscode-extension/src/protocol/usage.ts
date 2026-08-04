export interface SessionUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens: number;
  context_window?: number;
  service_tier?: string;
}

export function makeUsage(input: SessionUsage): SessionUsage {
  const out: SessionUsage = { input_tokens: input.input_tokens, output_tokens: input.output_tokens };
  if (input.cache_creation_input_tokens !== undefined) out.cache_creation_input_tokens = input.cache_creation_input_tokens;
  if (input.cache_read_input_tokens !== undefined) out.cache_read_input_tokens = input.cache_read_input_tokens;
  if (input.context_window !== undefined) out.context_window = input.context_window;
  if (input.service_tier !== undefined) out.service_tier = input.service_tier;
  return out;
}
