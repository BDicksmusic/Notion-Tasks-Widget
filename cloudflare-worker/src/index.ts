/**
 * Notion Webhook Relay - Cloudflare Worker
 * 
 * Receives webhooks from Notion and stores them for desktop app to fetch.
 * 
 * Endpoints:
 *   POST /webhook/:userId     - Notion sends webhooks here
 *   GET  /events/:userId      - App fetches pending events
 *   POST /register            - App registers and gets a user token
 *   GET  /health              - Health check
 */

interface Env {
  WEBHOOK_EVENTS: KVNamespace;
  WEBHOOK_SECRET?: string;
  // OAuth credentials (set via wrangler secret)
  NOTION_OAUTH_CLIENT_ID?: string;
  NOTION_OAUTH_CLIENT_SECRET?: string;
}

// OAuth token storage
interface StoredOAuthTokens {
  access_token: string;
  refresh_token: string;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string;
  workspace_icon?: string;
  created_at: string;
  updated_at: string;
}

interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  data: unknown;
}

interface StoredEvents {
  events: WebhookEvent[];
  lastUpdated: string;
  verificationToken?: string; // Store the latest verification token
  lastPayload?: string; // Debug: last received payload
}

// CORS headers for desktop app
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health check
      if (path === '/health') {
        return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
      }

      // Test endpoint - manually store a test token to verify KV is working
      const testMatch = path.match(/^\/test\/([a-zA-Z0-9_-]+)$/);
      if (testMatch && request.method === 'POST') {
        const userId = testMatch[1];
        const testToken = `test_${Date.now()}`;
        
        const stored = await env.WEBHOOK_EVENTS.get(userId);
        let data: StoredEvents = stored ? JSON.parse(stored) : { events: [], lastUpdated: new Date().toISOString() };
        data.verificationToken = testToken;
        data.lastUpdated = new Date().toISOString();
        await env.WEBHOOK_EVENTS.put(userId, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 30 });
        
        return jsonResponse({ 
          success: true, 
          testToken,
          message: 'Test token stored. Now GET /verify/' + userId + ' to retrieve it.'
        });
      }
      
      // Debug endpoint - show what's stored for a user
      const debugMatch = path.match(/^\/debug\/([a-zA-Z0-9_-]+)$/);
      if (debugMatch && request.method === 'GET') {
        const userId = debugMatch[1];
        const stored = await env.WEBHOOK_EVENTS.get(userId);
        if (!stored) {
          return jsonResponse({ error: 'No data for this user', userId });
        }
        return jsonResponse({ userId, data: JSON.parse(stored) });
      }

      // ============ OAUTH ENDPOINTS ============
      
      // Start OAuth flow - redirects user to Notion
      if (path === '/auth/start') {
        return handleOAuthStart(request, env);
      }

      // OAuth callback - Notion redirects here with code
      if (path === '/auth/callback') {
        return await handleOAuthCallback(request, env);
      }

      // Get stored OAuth tokens for a user
      const tokenMatch = path.match(/^\/auth\/tokens\/([a-zA-Z0-9_-]+)$/);
      if (tokenMatch && request.method === 'GET') {
        const visitorId = tokenMatch[1];
        return await handleGetOAuthTokens(env, visitorId);
      }

      // Refresh OAuth token
      const refreshMatch = path.match(/^\/auth\/refresh\/([a-zA-Z0-9_-]+)$/);
      if (refreshMatch && request.method === 'POST') {
        const visitorId = refreshMatch[1];
        return await handleRefreshToken(env, visitorId);
      }

      // Register new user - generates a unique token
      if (path === '/register' && request.method === 'POST') {
        return await handleRegister(request, env);
      }

      // Dev endpoint - always returns the same dev webhook URL
      if (path === '/dev/register' && request.method === 'POST') {
        return await handleDevRegister(env, request);
      }

      // Webhook endpoint - Notion POSTs here, GET returns status
      const webhookMatch = path.match(/^\/webhook\/([a-zA-Z0-9_-]+)$/);
      if (webhookMatch) {
        const userId = webhookMatch[1];
        
        // Handle GET - return webhook status (for user verification)
        if (request.method === 'GET') {
          const stored = await env.WEBHOOK_EVENTS.get(userId);
          if (!stored) {
            return jsonResponse({ 
              error: 'User not found',
              message: 'This webhook URL is not registered. Enable real-time sync in the app first.',
              userId 
            }, 404);
          }
          const data: StoredEvents = JSON.parse(stored);
          return jsonResponse({
            status: 'ready',
            message: 'Webhook endpoint is active and ready to receive events from Notion.',
            userId,
            registered: true,
            lastUpdated: data.lastUpdated,
            hasVerificationToken: !!data.verificationToken,
            eventsCount: data.events?.length || 0
          });
        }
        
        // Handle POST - receive webhook from Notion
        if (request.method === 'POST') {
          return await handleWebhook(request, env, userId);
        }
      }

      // Verification token endpoint - Get the token to paste into Notion
      const verifyMatch = path.match(/^\/verify\/([a-zA-Z0-9_-]+)$/);
      if (verifyMatch && request.method === 'GET') {
        const userId = verifyMatch[1];
        return await handleGetVerificationToken(env, userId);
      }

      // Events endpoint - App GETs pending events
      const eventsMatch = path.match(/^\/events\/([a-zA-Z0-9_-]+)$/);
      if (eventsMatch && request.method === 'GET') {
        const userId = eventsMatch[1];
        return await handleGetEvents(request, env, userId);
      }

      // Clear events endpoint - App DELETEs after processing
      if (eventsMatch && request.method === 'DELETE') {
        const userId = eventsMatch[1];
        return await handleClearEvents(request, env, userId);
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },
};

/**
 * Development registration - always returns the same dev webhook URL
 * Use this for testing so you don't need to reconfigure Notion webhooks
 */
async function handleDevRegister(env: Env, request: Request): Promise<Response> {
  const userId = 'dev_brandon_notion_tasks';
  const baseUrl = new URL(request.url).origin;
  
  // Initialize or keep existing events for dev user
  const existing = await env.WEBHOOK_EVENTS.get(userId);
  if (!existing) {
    const initialData: StoredEvents = {
      events: [],
      lastUpdated: new Date().toISOString(),
    };
    await env.WEBHOOK_EVENTS.put(userId, JSON.stringify(initialData));
  }

  const webhookUrl = `${baseUrl}/webhook/${userId}`;
  
  return jsonResponse({
    userId,
    webhookUrl,
    eventsUrl: `${baseUrl}/events/${userId}`,
    message: 'DEV MODE: This webhook URL is fixed for development',
  });
}

/**
 * Register a new user and generate a unique webhook token
 */
async function handleRegister(request: Request, env: Env): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { appId?: string };
  const baseUrl = new URL(request.url).origin;
  
  // Generate a unique user token
  const token = generateToken();
  const userId = `user_${token}`;
  
  console.log(`[Register] Creating user: ${userId}`);
  
  // Initialize with lastPayload to distinguish from "never registered"
  const initialData: StoredEvents = {
    events: [],
    lastUpdated: new Date().toISOString(),
    lastPayload: 'User registered, awaiting webhook from Notion',
  };
  
  try {
    // Write to KV
    await env.WEBHOOK_EVENTS.put(userId, JSON.stringify(initialData), {
      expirationTtl: 60 * 60 * 24 * 30, // 30 days
    });
    
    // Verify the write succeeded by reading it back
    const verification = await env.WEBHOOK_EVENTS.get(userId);
    if (!verification) {
      console.error(`[Register] KV write verification failed for ${userId}`);
      return jsonResponse({ 
        error: 'Registration failed - could not verify KV write',
        userId 
      }, 500);
    }
    
    console.log(`[Register] Successfully created user: ${userId}`);
    
    // Return the webhook URL for this user
    const webhookUrl = `${baseUrl}/webhook/${userId}`;
    
    return jsonResponse({
      userId,
      webhookUrl,
      eventsUrl: `${baseUrl}/events/${userId}`,
      verifyUrl: `${baseUrl}/verify/${userId}`,
      message: 'Paste the webhookUrl into Notion webhook settings',
    });
  } catch (error) {
    console.error(`[Register] Error creating user ${userId}:`, error);
    return jsonResponse({ 
      error: 'Registration failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

/**
 * Handle incoming webhook from Notion
 */
async function handleWebhook(request: Request, env: Env, userId: string): Promise<Response> {
  // First, ALWAYS store that we received something - even before parsing
  const rawBody = await request.text();
  
  // Store raw request info for debugging
  const debugInfo = {
    receivedAt: new Date().toISOString(),
    method: request.method,
    contentType: request.headers.get('content-type'),
    rawBodyLength: rawBody.length,
    rawBodyPreview: rawBody.substring(0, 500),
  };
  
  console.log(`[Webhook] Raw request for ${userId}:`, JSON.stringify(debugInfo));
  
  // Parse JSON
  let payload: any = null;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    // Store debug info even if parsing fails
    const stored = await env.WEBHOOK_EVENTS.get(userId);
    let data: StoredEvents = stored ? JSON.parse(stored) : { events: [], lastUpdated: new Date().toISOString() };
    data.lastPayload = `PARSE_ERROR: ${rawBody.substring(0, 500)}`;
    data.lastUpdated = new Date().toISOString();
    await env.WEBHOOK_EVENTS.put(userId, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 30 });
    
    return jsonResponse({ error: 'Invalid JSON', debug: debugInfo }, 400);
  }

  console.log(`[Webhook] Parsed payload for ${userId}:`, JSON.stringify(payload).substring(0, 500));

  // ALWAYS store the raw payload first for debugging
  const stored = await env.WEBHOOK_EVENTS.get(userId);
  let data: StoredEvents = stored ? JSON.parse(stored) : { events: [], lastUpdated: new Date().toISOString() };
  data.lastPayload = rawBody.substring(0, 1000);
  data.lastUpdated = new Date().toISOString();

  // Handle Notion's verification token
  // Notion might send it as verification_token, challenge, or in different formats
  const payloadAny = payload as any;
  
  // Check various possible field names Notion might use
  const verificationToken = 
    payloadAny.verification_token || 
    payloadAny.verificationToken ||
    payloadAny.challenge ||
    payloadAny.token ||
    (payloadAny.type === 'url_verification' && payloadAny.challenge);
  
  if (verificationToken) {
    console.log(`[Webhook] Verification token received for ${userId}: ${verificationToken}`);
    data.verificationToken = verificationToken;
  } else {
    console.log(`[Webhook] No verification token found. Keys:`, Object.keys(payloadAny));
  }
  
  // Always save
  await env.WEBHOOK_EVENTS.put(userId, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 30 });
    
  // If not a verification token, store as a regular event
  if (!verificationToken) {
    const event: WebhookEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: payloadAny.type || 'unknown',
      timestamp: new Date().toISOString(),
      data: payload,
    };
    data.events.push(event);
    
    // Keep only last 100 events to prevent KV bloat
    if (data.events.length > 100) {
      data.events = data.events.slice(-100);
    }
  }

  // Always save
  await env.WEBHOOK_EVENTS.put(userId, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 30 });
    
  return jsonResponse({ 
    success: true,
    message: verificationToken ? 'Verification token stored' : 'Event stored',
    hasToken: !!verificationToken,
    payloadKeys: Object.keys(payloadAny)
  });
}

/**
 * Get the verification token that Notion sent (user needs to paste this back into Notion)
 */
async function handleGetVerificationToken(env: Env, userId: string): Promise<Response> {
  const stored = await env.WEBHOOK_EVENTS.get(userId);
  
  if (!stored) {
    return jsonResponse({ 
      error: 'No data found for this user. Make sure to register first.',
      verificationToken: null 
    }, 404);
  }

  const data: StoredEvents = JSON.parse(stored);
  
  if (!data.verificationToken) {
    return jsonResponse({ 
      message: 'No verification token yet. Click "Resend token" in Notion.',
      verificationToken: null,
      debug: {
        lastUpdated: data.lastUpdated,
        lastPayload: data.lastPayload || 'No payload received yet',
        eventsCount: data.events?.length || 0
      }
    });
  }

  return jsonResponse({
    verificationToken: data.verificationToken,
    message: 'Copy this token and paste it into Notion to verify your webhook.'
  });
}

/**
 * Return pending events for the app to process
 */
async function handleGetEvents(request: Request, env: Env, userId: string): Promise<Response> {
  const stored = await env.WEBHOOK_EVENTS.get(userId);
  
  if (!stored) {
    return jsonResponse({ events: [], message: 'No events or user not found' });
  }

  const data: StoredEvents = JSON.parse(stored);
  
  // Optional: filter by timestamp if provided
  const url = new URL(request.url);
  const since = url.searchParams.get('since');
  
  let events = data.events;
  if (since) {
    events = events.filter(e => e.timestamp > since);
  }

  return jsonResponse({
    events,
    count: events.length,
    lastUpdated: data.lastUpdated,
  });
}

/**
 * Clear events after the app has processed them
 */
async function handleClearEvents(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const beforeTimestamp = url.searchParams.get('before');
  
  const stored = await env.WEBHOOK_EVENTS.get(userId);
  
  if (!stored) {
    return jsonResponse({ cleared: 0 });
  }

  const data: StoredEvents = JSON.parse(stored);
  const originalCount = data.events.length;

  if (beforeTimestamp) {
    // Clear only events before the timestamp
    data.events = data.events.filter(e => e.timestamp > beforeTimestamp);
  } else {
    // Clear all events
    data.events = [];
  }

  data.lastUpdated = new Date().toISOString();
  
  await env.WEBHOOK_EVENTS.put(userId, JSON.stringify(data), {
    expirationTtl: 60 * 60 * 24 * 30,
  });

  return jsonResponse({
    cleared: originalCount - data.events.length,
    remaining: data.events.length,
  });
}

// ============================================================================
// OAUTH HANDLERS
// ============================================================================

const NOTION_OAUTH_URL = 'https://api.notion.com/v1/oauth/authorize';
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
// Note: OAuth redirect URI must be configured in Notion integration settings
// This will be derived from the request URL dynamically

/**
 * Start OAuth flow - redirect user to Notion authorization
 */
function handleOAuthStart(request: Request, env: Env): Response {
  const url = new URL(request.url);
  const baseUrl = url.origin;
  const visitorId = url.searchParams.get('visitor_id') || generateToken();
  const redirectUri = `${baseUrl}/auth/callback`;
  
  if (!env.NOTION_OAUTH_CLIENT_ID) {
    return jsonResponse({ error: 'OAuth not configured. Set NOTION_OAUTH_CLIENT_ID secret.' }, 500);
  }

  // Build Notion OAuth URL
  const authUrl = new URL(NOTION_OAUTH_URL);
  authUrl.searchParams.set('client_id', env.NOTION_OAUTH_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('owner', 'user');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', visitorId); // Pass visitor ID through state

  // Redirect to Notion
  return Response.redirect(authUrl.toString(), 302);
}

/**
 * Handle OAuth callback from Notion
 */
async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const baseUrl = url.origin;
  const redirectUri = `${baseUrl}/auth/callback`;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state'); // This is the visitor_id
  const error = url.searchParams.get('error');

  if (error) {
    return htmlResponse(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>❌ Authorization Failed</h1>
          <p>Error: ${error}</p>
          <p>You can close this window and try again.</p>
        </body>
      </html>
    `);
  }

  if (!code || !state) {
    return htmlResponse(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>❌ Missing Parameters</h1>
          <p>Authorization code or state is missing.</p>
        </body>
      </html>
    `);
  }

  if (!env.NOTION_OAUTH_CLIENT_ID || !env.NOTION_OAUTH_CLIENT_SECRET) {
    return htmlResponse(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>❌ Server Configuration Error</h1>
          <p>OAuth credentials not configured.</p>
        </body>
      </html>
    `);
  }

  try {
    // Exchange code for tokens
    const credentials = btoa(`${env.NOTION_OAUTH_CLIENT_ID}:${env.NOTION_OAUTH_CLIENT_SECRET}`);
    
    const tokenResponse = await fetch(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('[OAuth] Token exchange failed:', errorData);
      return htmlResponse(`
        <html>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1>❌ Token Exchange Failed</h1>
            <p>Could not complete authorization. Please try again.</p>
          </body>
        </html>
      `);
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      bot_id: string;
      workspace_id: string;
      workspace_name?: string;
      workspace_icon?: string;
    };

    // Store tokens with visitor ID as key
    const storedTokens: StoredOAuthTokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      bot_id: tokenData.bot_id,
      workspace_id: tokenData.workspace_id,
      workspace_name: tokenData.workspace_name,
      workspace_icon: tokenData.workspace_icon,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await env.WEBHOOK_EVENTS.put(`oauth_${state}`, JSON.stringify(storedTokens), {
      expirationTtl: 60 * 60 * 24 * 365, // 1 year
    });

    console.log(`[OAuth] Tokens stored for visitor: ${state}`);

    // Show success page that closes itself
    return htmlResponse(`
      <html>
        <head>
          <title>Connected to Notion!</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
              color: white;
            }
            .container {
              text-align: center;
              padding: 40px;
            }
            .checkmark {
              font-size: 64px;
              margin-bottom: 20px;
            }
            h1 {
              margin: 0 0 10px;
              font-weight: 600;
            }
            p {
              opacity: 0.8;
              margin: 0;
            }
            .workspace {
              margin-top: 20px;
              padding: 15px 25px;
              background: rgba(255,255,255,0.1);
              border-radius: 8px;
              display: inline-block;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="checkmark">✅</div>
            <h1>Connected to Notion!</h1>
            <p>You can close this window and return to the app.</p>
            ${tokenData.workspace_name ? `<div class="workspace">Workspace: ${tokenData.workspace_name}</div>` : ''}
          </div>
          <script>
            // Notify opener window if exists
            if (window.opener) {
              window.opener.postMessage({ type: 'notion-oauth-success', visitorId: '${state}' }, '*');
            }
            // Auto-close after 3 seconds
            setTimeout(() => window.close(), 3000);
          </script>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('[OAuth] Callback error:', err);
    return htmlResponse(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>❌ Error</h1>
          <p>Something went wrong. Please try again.</p>
        </body>
      </html>
    `);
  }
}

/**
 * Get stored OAuth tokens for a visitor
 */
async function handleGetOAuthTokens(env: Env, visitorId: string): Promise<Response> {
  const stored = await env.WEBHOOK_EVENTS.get(`oauth_${visitorId}`);
  
  if (!stored) {
    return jsonResponse({ error: 'No tokens found. Please connect to Notion first.', connected: false }, 404);
  }

  const tokens: StoredOAuthTokens = JSON.parse(stored);
  
  return jsonResponse({
    connected: true,
    access_token: tokens.access_token,
    workspace_id: tokens.workspace_id,
    workspace_name: tokens.workspace_name,
    workspace_icon: tokens.workspace_icon,
    bot_id: tokens.bot_id,
  });
}

/**
 * Refresh an OAuth token
 */
async function handleRefreshToken(env: Env, visitorId: string): Promise<Response> {
  const stored = await env.WEBHOOK_EVENTS.get(`oauth_${visitorId}`);
  
  if (!stored) {
    return jsonResponse({ error: 'No tokens found' }, 404);
  }

  const tokens: StoredOAuthTokens = JSON.parse(stored);

  if (!env.NOTION_OAUTH_CLIENT_ID || !env.NOTION_OAUTH_CLIENT_SECRET) {
    return jsonResponse({ error: 'OAuth not configured' }, 500);
  }

  try {
    const credentials = btoa(`${env.NOTION_OAUTH_CLIENT_ID}:${env.NOTION_OAUTH_CLIENT_SECRET}`);
    
    const response = await fetch(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
      }),
    });

    if (!response.ok) {
      return jsonResponse({ error: 'Token refresh failed' }, 400);
    }

    const newTokens = await response.json() as {
      access_token: string;
      refresh_token: string;
    };

    // Update stored tokens
    const updatedTokens: StoredOAuthTokens = {
      ...tokens,
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      updated_at: new Date().toISOString(),
    };

    await env.WEBHOOK_EVENTS.put(`oauth_${visitorId}`, JSON.stringify(updatedTokens), {
      expirationTtl: 60 * 60 * 24 * 365,
    });

    return jsonResponse({ success: true, access_token: newTokens.access_token });

  } catch (err) {
    console.error('[OAuth] Refresh error:', err);
    return jsonResponse({ error: 'Token refresh failed' }, 500);
  }
}

/**
 * Generate a random token
 */
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Helper to create JSON responses with CORS headers
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Helper to return HTML responses
 */
function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html',
    },
  });
}

