// ============================================================================
// MCP HTTP Server
// Provides HTTP transport for the MCP server with unified GraphManager
// ============================================================================

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { server, initializeGraphManager, allTools } from './index.js';
import { createOrchestrationRouter } from './api/orchestration-api.js';
import { createChatRouter } from './api/chat-api.js';
import { createMCPToolsRouter } from './api/mcp-tools-api.js';
import indexRouter from './api/index-api.js';
import nodesRouter from './api/nodes-api.js';
import { FileWatchManager } from './indexing/FileWatchManager.js';
import type { IGraphManager } from './types/index.js';
import passport from './config/passport.js';
import authRouter from './api/auth-api.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// HTTP Server - Shared Session Mode
// ============================================================================

// Global shared transport for all agents - no session isolation
let sharedTransport: any | null = null;
let isSessionInitialized = false;

const SHARED_SESSION_ID = 'shared-global-session';

async function startHttpServer() {
  console.error("🚀 Graph-RAG MCP HTTP Server v4.1 starting...");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error("🌐 MODE: Shared Global Session (multi-agent)");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Initialize GraphManager
  let graphManager: IGraphManager;
  let watchManager: FileWatchManager;
  try {
    graphManager = await initializeGraphManager();
    const stats = await graphManager.getStats();
    console.log(`✅ Connected to Neo4j`);
    console.log(`   Nodes: ${stats.nodeCount}`);
    console.log(`   Edges: ${stats.edgeCount}`);
    console.log(`   Types: ${JSON.stringify(stats.types)}`);

    // Initialize FileWatchManager
    watchManager = new FileWatchManager(graphManager.getDriver());
    console.log(`✅ FileWatchManager initialized`);
    
    // Make watchManager globally accessible for API routes
    (globalThis as any).fileWatchManager = watchManager;
  } catch (error: any) {
    console.error(`❌ Failed to initialize GraphManager: ${error.message}`);
    process.exit(1);
  }

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`📊 ${allTools.length} tools available (globally accessible)`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const app = express();
  
  // Add error handler for JSON parsing failures
  app.use(bodyParser.json({ 
    limit: '1mb',
    verify: (req: any, res, buf, encoding) => {
      try {
        const enc = (encoding as BufferEncoding) || 'utf8';
        JSON.parse(buf.toString(enc));
      } catch (e: any) {
        const enc = (encoding as BufferEncoding) || 'utf8';
        console.error('❌ JSON parse error:', e.message);
        console.error('   Raw body preview:', buf.toString(enc).substring(0, 200));
        throw new Error('Invalid JSON in request body');
      }
    }
  }));
  
  // Add URL-encoded body parser for form submissions (needed for Passport login)
  app.use(bodyParser.urlencoded({ extended: true }));
  
  app.use(cors({ 
    origin: process.env.MCP_ALLOWED_ORIGIN || '*', 
    methods: ['POST','GET','DELETE'], 
    exposedHeaders: ['Mcp-Session-Id'], 
    // Allow Accept header, custom mcp-session-id header, and Cache-Control for SSE
    allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id', 'Cache-Control'], 
    credentials: true 
  }));

  // Initialize audit logging (if enabled)
  let auditConfig: any = null;
  if (process.env.MIMIR_ENABLE_AUDIT_LOGGING === 'true') {
    const { loadAuditLoggerConfig, auditLogger } = await import('./middleware/audit-logger.js');
    auditConfig = loadAuditLoggerConfig();
    
    console.log('📝 Audit logging enabled');
    console.log(`   Destination: ${auditConfig.destination}`);
    console.log(`   Format: ${auditConfig.format}`);
    if (auditConfig.filePath) {
      console.log(`   File: ${auditConfig.filePath}`);
    }
    if (auditConfig.webhookUrl) {
      console.log(`   Webhook: ${auditConfig.webhookUrl}`);
    }
    
    // Add audit logger middleware (before routes)
    app.use(auditLogger(auditConfig));
  }

  // Add session middleware (only if security enabled)
  if (process.env.MIMIR_ENABLE_SECURITY === 'true') {
    console.log('🔐 Security enabled - initializing Passport.js authentication');
    
    if (process.env.MIMIR_ENABLE_RBAC === 'true') {
      console.log('🔒 RBAC enabled - role-based access control active');
      
      // Initialize RBAC config (supports remote URIs)
      const { initRBACConfig } = await import('./config/rbac-config.js');
      await initRBACConfig();
    } else {
      console.log('ℹ️  RBAC disabled - all authenticated users have full access');
    }
    
    // Parse session max age from env (in hours, 0 = never expire)
    const sessionMaxAgeHours = parseInt(process.env.MIMIR_SESSION_MAX_AGE_HOURS || '24', 10);
    const sessionMaxAge = sessionMaxAgeHours === 0 ? undefined : sessionMaxAgeHours * 60 * 60 * 1000;
    
    if (sessionMaxAgeHours === 0) {
      console.log('🔓 Session configured to never expire');
    } else {
      console.log(`⏱️  Session max age: ${sessionMaxAgeHours} hours`);
    }
    
    app.use(session({
      secret: process.env.MIMIR_SESSION_SECRET || 'dev-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: sessionMaxAge
      }
    }));

    app.use(passport.initialize());
    app.use(passport.session());
  }

  // Protect API routes (only if security enabled)
  if (process.env.MIMIR_ENABLE_SECURITY === 'true') {
    app.use('/api', (req, res, next) => {
      // Skip auth check for health endpoint and auth endpoints
      if (req.path === '/health' || req.path.startsWith('/auth')) {
        return next();
      }
      
      // Check authentication
      if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
      }
      
      res.status(401).json({ error: 'Unauthorized' });
    });
  }

  // Mount chat API routes (OpenAI-compatible, at root level)
  app.use('/', createChatRouter(graphManager));
  
  // Mount orchestration API routes
  app.use('/api', createOrchestrationRouter(graphManager));
  
  // Mount MCP tools API routes
  app.use('/api', createMCPToolsRouter(graphManager));
  
  // Mount index management API routes
  app.use('/api', indexRouter);
  
  // Mount nodes management API routes
  app.use('/api/nodes', nodesRouter);

  // Debug middleware - log ALL requests
  app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.path}`);
    next();
  });
  
  // Mount auth routes AFTER session middleware (auth routes need session support)
  app.use(authRouter);

  // Serve static frontend files (assets only, not HTML)
  const frontendDistPath = path.join(__dirname, '../frontend/dist');
  console.log(`📁 Serving frontend from: ${frontendDistPath}`);
  app.use(express.static(frontendDistPath, {
    index: false, // Don't serve index.html automatically
    setHeaders: (res, filepath) => {
      // Only serve actual asset files, not HTML
      if (filepath.endsWith('.html')) {
        res.status(404).end();
      }
    }
  }));

  // SSE endpoint for PCTX and other clients that need event streams
  app.get('/mcp', async (req, res) => {
    try {
      console.warn(`[HTTP] SSE connection request (shared session mode)`);
      
      // Initialize shared transport once on first request
      if (!sharedTransport) {
        console.warn(`[HTTP] Initializing shared global session: ${SHARED_SESSION_ID}`);
        
        sharedTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => SHARED_SESSION_ID,
          enableJsonResponse: true
        } as any);

        // Connect server to shared transport
        await (server as any).connect(sharedTransport);
        console.warn(`[HTTP] Server connected to shared session`);
      }
      
      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Mcp-Session-Id', SHARED_SESSION_ID);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.flushHeaders();
      
      console.warn(`[HTTP] SSE stream established for session: ${SHARED_SESSION_ID}`);
      
      // Keep connection alive with periodic heartbeat
      const heartbeatInterval = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);
      
      // Clean up on disconnect
      req.on('close', () => {
        clearInterval(heartbeatInterval);
        console.warn(`[HTTP] SSE client disconnected`);
      });
      
      // Handle the SSE request through transport
      await sharedTransport.handleRequest(req, res, null);
    } catch (error) {
      console.error('❌ HTTP /mcp SSE handler error:', error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });

  app.post('/mcp', async (req, res) => {
    try {
      let method = req.body?.method || 'unknown';
      console.warn(`[HTTP] Request method: ${method} (shared session mode)`);
      
      // Log headers for debugging content negotiation issues
      const contentType = req.headers['content-type'] || 'not-set';
      const accept = req.headers['accept'] || 'not-set';
      console.warn(`[HTTP] Headers: Content-Type="${contentType}", Accept="${accept}"`);
      
      // Initialize shared transport once on first request
      if (!sharedTransport) {
        console.warn(`[HTTP] Initializing shared global session: ${SHARED_SESSION_ID}`);
        
        sharedTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => SHARED_SESSION_ID,
          enableJsonResponse: true
        } as any);

        // Connect server to shared transport
        await (server as any).connect(sharedTransport);
        console.warn(`[HTTP] Server connected to shared session`);
      }
      
      // Auto-initialize: Convert first non-initialize request to initialize
      // Only do this if we haven't initialized yet
      if (!isSessionInitialized && method !== 'initialize') {
        console.warn(`[HTTP] Auto-initializing: Converting '${method}' request to 'initialize'`);
        req.body.method = 'initialize';
        req.body.params = {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'http-auto-init', version: '1.0' }
        };
        method = 'initialize'; // Update the method variable too!
      }
      
      // Handle re-initialization gracefully - return cached init response
      if (isSessionInitialized && method === 'initialize') {
        console.warn(`[HTTP] Re-initialization request - returning cached response`);
        res.setHeader('Mcp-Session-Id', SHARED_SESSION_ID);
        res.setHeader('Content-Type', 'application/json');
        res.json({
          jsonrpc: '2.0',
          id: req.body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'Mimir-RAG-TODO-MCP',
              version: '4.0.0',
              sessionId: SHARED_SESSION_ID,
              sessionMode: 'shared-global'
            }
          }
        });
        return;
      }
      
      // Mark session as initialized AFTER transport handles the initialize request
      if (method === 'initialize') {
        // Let transport handle the request first, then mark as initialized
        
        // Always inject the shared session ID into request headers
        if (!req.headers['mcp-session-id']) {
          req.headers['mcp-session-id'] = SHARED_SESSION_ID;
        }
        res.setHeader('Mcp-Session-Id', SHARED_SESSION_ID);
        
        // Intercept response to add sessionId and mark as initialized
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        let responseData = '';

        res.write = ((chunk: any, ...args: any[]) => {
          if (chunk) responseData += chunk.toString();
          return true;
        }) as any;

        res.end = ((chunk?: any, ...args: any[]) => {
          if (chunk) responseData += chunk.toString();
          
          try {
            const parsed = JSON.parse(responseData);
            if (parsed.result && parsed.result.serverInfo) {
              parsed.result.serverInfo.sessionId = SHARED_SESSION_ID;
              parsed.result.serverInfo.sessionMode = 'shared-global';
            }
            responseData = JSON.stringify(parsed);
            console.warn(`[HTTP] Initialization complete - session ready`);
            isSessionInitialized = true;  // Mark as initialized AFTER successful init
          } catch (e: any) {
            console.error('❌ Failed to modify initialize response:', e.message);
          }
          
          originalEnd(responseData);
        }) as any;
        
        // Handle the initialize request
        await sharedTransport.handleRequest(req, res, req.body);
        return;
      }

      // Always inject the shared session ID into request headers
      if (!req.headers['mcp-session-id']) {
        req.headers['mcp-session-id'] = SHARED_SESSION_ID;
      }

      // Always set the shared session header in response
      res.setHeader('Mcp-Session-Id', SHARED_SESSION_ID);

      // Handle the request
      await sharedTransport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('❌ HTTP /mcp handler error:', error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  });
  
  // Health check for Docker HEALTHCHECK
  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', version: '4.1.0', mode: 'shared-session', tools: allTools.length });
  });
  
  // SPA catch-all route - serve index.html for all non-API routes
  // This must come AFTER all API routes but BEFORE error handlers
  // Use a regex pattern instead of '*' to avoid path-to-regexp errors
  app.get(/^\/(?!api|v1|mcp|health|models|auth).*$/, (req, res) => {
    console.log(`[AUTH] Catch-all hit: ${req.path}, Security: ${process.env.MIMIR_ENABLE_SECURITY}, isAuth: ${req.isAuthenticated ? req.isAuthenticated() : 'no method'}`);
    
    // Check authentication if security is enabled
    if (process.env.MIMIR_ENABLE_SECURITY === 'true') {
      // Allow /login route
      if (req.path === '/login') {
        console.log('[AUTH] Serving login page');
        return res.sendFile(path.join(frontendDistPath, 'index.html'));
      }
      
      // Check if user is authenticated
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        console.log('[AUTH] Not authenticated, redirecting to /login');
        return res.redirect('/login');
      }
      
      console.log('[AUTH] Authenticated, serving app');
    }
    
    // Serve index.html for all routes except API endpoints
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
  
  // Global error handler for JSON parsing and other errors
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && 'body' in err) {
      console.error('❌ Body parse error:', err.message);
      console.error('   Request method:', req.method);
      console.error('   Request path:', req.path);
      return res.status(400).json({ 
        jsonrpc: '2.0',
        error: { 
          code: -32700, 
          message: 'Parse error: Invalid JSON in request body',
          data: { detail: err.message }
        } 
      });
    }
    
    console.error('❌ Unhandled error:', err);
    if (!res.headersSent) {
      res.status(500).json({ 
        jsonrpc: '2.0',
        error: { 
          code: -32603, 
          message: 'Internal error',
          data: { detail: err.message }
        } 
      });
    }
  });

  const port = parseInt(process.env.PORT || process.env.MCP_HTTP_PORT || '3000', 10);
  const server = app.listen(port, () => {
    console.error(`✅ HTTP server listening on http://localhost:${port}/mcp`);
    console.error(`✅ Health check: http://localhost:${port}/health`);
    console.error(`🎨 Mimir Portal UI: http://localhost:${port}/portal`);
    console.error(`🎭 Orchestration Studio: http://localhost:${port}/studio`);
    console.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received - starting graceful shutdown...`);
    
    // Flush audit logs if enabled
    if (auditConfig && auditConfig.enabled) {
      const { shutdownAuditLogger } = await import('./middleware/audit-logger.js');
      await shutdownAuditLogger(auditConfig);
      console.log('✅ Audit logs flushed');
    }
    
    // Close server
    server.close(() => {
      console.log('✅ HTTP server closed');
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startHttpServer().catch(error => {
  console.error('❌ HTTP server failed to start:', error);
  process.exit(1);
});
