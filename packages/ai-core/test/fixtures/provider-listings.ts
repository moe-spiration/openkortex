// Handwritten listings shaped like the provider APIs (Anthropic /v1/models, OpenRouter /models
// and /embeddings/models, Eden AI v2 /info/provider_subfeatures and v3 /models).

export const anthropicPage1 = {
  data: [
    {
      type: "model",
      id: "fx-haiku-9",
      display_name: "Fixture Haiku 9",
      created_at: "2026-10-07T18:00:00Z",
      line: "haiku",
      max_input_tokens: 1_000_000,
      capabilities: { image_input: { supported: true }, pdf_input: { supported: true } },
      lifecycle: "active",
      retires_at: null,
    },
    {
      type: "model",
      id: "fx-sonnet-9",
      display_name: "Fixture Sonnet 9",
      created_at: "2026-09-28T00:00:00Z",
      line: "sonnet",
      max_input_tokens: 1_000_000,
      capabilities: { image_input: { supported: true }, pdf_input: { supported: false } },
      lifecycle: "active",
    },
  ],
  has_more: true,
  last_id: "fx-sonnet-9",
};

export const anthropicPage2 = {
  data: [
    {
      type: "model",
      id: "fx-opus-old",
      display_name: "Fixture Opus old",
      created_at: "2025-11-24T00:00:00Z",
      line: "opus",
      lifecycle: "retired",
    },
    {
      type: "model",
      id: "fx-legacy",
      display_name: "Fixture Legacy",
      created_at: "2024-03-01T00:00:00Z",
    },
  ],
  has_more: false,
  last_id: "fx-legacy",
};

export const openRouterModels = {
  data: [
    {
      id: "fx/vision-model",
      name: "Fixture: Vision",
      created: 1_791_397_883,
      context_length: 1_000_000,
      architecture: { input_modalities: ["text", "image", "file"], output_modalities: ["text"] },
      pricing: { prompt: "0.0000001", completion: "0.0000005" },
    },
    {
      id: "fx/audio-model",
      name: "Fixture: Audio",
      created: 1_780_000_000,
      architecture: { input_modalities: ["text", "audio"], output_modalities: ["text"] },
      pricing: { prompt: "0.000002", completion: "0.000008" },
    },
    {
      id: "fx/image-gen",
      name: "Fixture: Image generator",
      architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      pricing: { prompt: "0", completion: "0" },
    },
    {
      id: "openrouter/auto",
      name: "Auto Router",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "-1", completion: "-1" },
    },
    {
      id: "fx/expired",
      name: "Fixture: expired",
      architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      pricing: { prompt: "0.000001", completion: "0.000001" },
      expiration_date: "2026-01-01",
    },
  ],
};

export const openRouterEmbeddings = {
  data: [
    {
      id: "fx/emb-1536",
      name: "Fixture 1536",
      created: 1_706_140_800,
      description: "Embedding model.",
      pricing: { prompt: "0.00000002" },
    },
    {
      id: "fx/emb-3072",
      name: "Fixture 3072",
      created: 1_706_140_800,
      description: "Large embedding model.",
      pricing: { prompt: "0.00000013" },
    },
    {
      id: "fx/emb-768",
      name: "Fixture 768",
      description: "A 768-dim sentence-transformers model.",
      pricing: { prompt: "0.000000005" },
    },
    {
      id: "fx/emb-free:free",
      name: "Fixture free",
      description: "Free embeddings.",
      pricing: { prompt: "0" },
    },
  ],
};

/** Vector size each OpenRouter fixture model returns for a probe asking for 1536 dimensions. */
export const PROBE_DIMS: Record<string, number> = { "fx/emb-1536": 1536, "fx/emb-3072": 3072 };

export const edenSubfeatures = [
  {
    name: "deepgram.audio.speech_to_text_async",
    is_working: true,
    provider: { name: "deepgram", fullname: "Deepgram" },
    feature: { name: "audio" },
    subfeature: { name: "speech_to_text_async", fullname: "Speech To Text" },
    pricings: [
      {
        model_name: "fx-nova",
        price: "0.005200000",
        price_unit_quantity: 60,
        price_unit_type: "seconde",
      },
      {
        model_name: "default",
        price: "0.018900000",
        price_unit_quantity: 60,
        price_unit_type: "seconde",
      },
    ],
    models: { models: ["fx-nova", "fx-enhanced"], default_model: "fx-enhanced" },
    llm_details: {},
  },
  {
    name: "google.ocr.ocr",
    is_working: true,
    provider: { name: "google", fullname: "Google" },
    feature: { name: "ocr" },
    subfeature: { name: "ocr", fullname: "Optical Character Recognition" },
    pricings: [
      {
        model_name: "default",
        price: "1.500000000",
        price_unit_quantity: 1000,
        price_unit_type: "page",
      },
    ],
    models: { models: [], default_model: null },
  },
  {
    name: "mistral.ocr.ocr_async",
    is_working: true,
    provider: { name: "mistral", fullname: "Mistral" },
    feature: { name: "ocr" },
    subfeature: { name: "ocr_async", fullname: "OCR Async" },
    pricings: [
      {
        model_name: "fx-ocr",
        price: "2.000000000",
        price_unit_quantity: 1000,
        price_unit_type: "page",
      },
    ],
    models: { models: ["fx-ocr"], default_model: null },
  },
  {
    name: "openai.text.embeddings",
    is_working: true,
    provider: { name: "openai", fullname: "OpenAI" },
    feature: { name: "text" },
    subfeature: { name: "embeddings", fullname: "Embeddings" },
    pricings: [
      {
        model_name: "1536__fx-ada",
        price: "0.100000000",
        price_unit_quantity: 1000000,
        price_unit_type: "token",
      },
    ],
    models: { models: ["fx-small", "1536__fx-ada"], default_model: "1536__fx-ada" },
    llm_details: { "fx-small": { input_cost_per_token: 2e-8, output_vector_size: 1536 } },
  },
  {
    name: "mistral.text.embeddings",
    is_working: true,
    provider: { name: "mistral", fullname: "Mistral" },
    feature: { name: "text" },
    subfeature: { name: "embeddings", fullname: "Embeddings" },
    pricings: [],
    models: { models: ["1024__fx-embed"], default_model: "1024__fx-embed" },
  },
  {
    name: "sentisight.image.background_removal",
    is_working: true,
    provider: { name: "sentisight" },
    feature: { name: "image" },
    subfeature: { name: "background_removal" },
    pricings: [],
    models: { models: [] },
  },
  {
    name: "amazon.audio.speech_to_text_async",
    is_working: false,
    provider: { name: "amazon", fullname: "Amazon" },
    feature: { name: "audio" },
    subfeature: { name: "speech_to_text_async" },
    pricings: [],
    models: { models: [] },
  },
];

export const edenLlms = {
  object: "list",
  data: [
    {
      id: "mistral/fx-small",
      created: 1_792_693_170,
      context_length: 128_000,
      capabilities: { input_modalities: ["text", "image"], output_modalities: ["text"] },
      pricing: { input_cost_per_token: 1.5e-7, output_cost_per_token: 5e-7 },
    },
    {
      id: "fx-image-only",
      capabilities: { input_modalities: ["text"], output_modalities: ["image"] },
    },
  ],
};
