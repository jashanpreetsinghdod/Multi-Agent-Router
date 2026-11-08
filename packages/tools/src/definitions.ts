import type { ToolDef } from '@omnirouter/canonical';

export const GET_CURRENT_TIME_TOOL: ToolDef = {
  name: 'get_current_time',
  description: 'Returns the current server UTC time and local time offset in ISO format.',
  inputSchema: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: 'Optional IANA timezone name (e.g. "America/New_York", "UTC"). Defaults to UTC.',
      },
    },
  },
  strict: true,
};

export const FETCH_URL_TOOL: ToolDef = {
  name: 'fetch_url',
  description: 'Fetches the text content of a public web page with SSRF safeguards. Truncates large content.',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The public HTTP or HTTPS URL to fetch.',
      },
      maxLength: {
        type: 'number',
        description: 'Optional max character length to return (default 8000, max 20000).',
      },
    },
    required: ['url'],
  },
  strict: true,
};

export const WEB_SEARCH_TOOL: ToolDef = {
  name: 'web_search',
  description: 'Searches the web for relevant queries and returns top snippets and links.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to execute.',
      },
      maxResults: {
        type: 'number',
        description: 'Number of results to return (1-10, default 5).',
      },
    },
    required: ['query'],
  },
  strict: true,
};

export const BUILTIN_TOOLS: ToolDef[] = [
  GET_CURRENT_TIME_TOOL,
  FETCH_URL_TOOL,
  WEB_SEARCH_TOOL,
];

