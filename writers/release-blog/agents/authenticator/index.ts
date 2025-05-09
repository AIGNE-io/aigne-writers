import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { FunctionAgent } from "@aigne/core";
import {
  type OAuthClientProvider,
  UnauthorizedError,
  refreshAuthorization,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
// @ts-ignore
import JWT from "jsonwebtoken";
import open from "open";
import { z } from "zod";

export class BlockletOAuthProvider extends EventEmitter implements OAuthClientProvider {
  private _tokens: OAuthTokens | undefined;
  private _clientInformation: OAuthClientInformationFull | undefined;

  private codeVerifierValue = "";
  private localServerPort = 7777; // Choose an available port
  private tokenFilePath: string;
  private clientInfoPath: string;

  constructor(host: string) {
    super();

    this.tokenFilePath = join(process.cwd(), ".oauth", host, "token.json");
    this.clientInfoPath = join(process.cwd(), ".oauth", host, "client.json");

    mkdirSync(join(process.cwd(), ".oauth", host), { recursive: true });

    this.loadTokens();
    this.loadClientInfo();
  }

  get redirectUrl() {
    return `http://localhost:${this.localServerPort}/callback`;
  }

  get clientMetadata() {
    return {
      redirect_uris: ["https://grafana.abtnet.io/login/generic_oauth"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Grafana",
      client_uri: "https://grafana.abtnet.io",
      logo_uri: "https://grafana.abtnet.io/.well-known/service/blocklet/logo",
      scope: "profile:read",
      tos_uri: "https://www.arcblock.io/en/termsofuse",
      policy_uri: "https://www.arcblock.io/en/privacy",
      contacts: ["blocklet@aigne.io"],
      software_id: "Grafana",
      software_version: "1.0.0",
    };
  }

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    return this._clientInformation;
  }

  async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
    console.info("Saving oauth client:", clientInformation);
    this._clientInformation = clientInformation;
    this.persistClientInfo();
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return this._tokens;
  }

  async saveTokens(tokens: OAuthTokens | undefined): Promise<void> {
    if (tokens) {
      console.info("Saving oauth tokens:", tokens);
      this._tokens = tokens;
      this.persistTokens();
    } else {
      this._tokens = undefined;
      this.persistTokens();
    }
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    // Create a local server to handle the callback
    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        if (req.url?.startsWith("/callback")) {
          const url = new URL(req.url, this.redirectUrl);
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");
          const errorDescription = url.searchParams.get("error_description");

          // Send a response to close the browser window
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html>
              <head>
                <title>Authorization</title>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    margin: 0;
                    background-color: #f5f5f5;
                    color: #333;
                  }
                  .container {
                    background: white;
                    padding: 2rem;
                    border-radius: 8px;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                    text-align: center;
                    max-width: 400px;
                    width: 90%;
                  }
                  h1 {
                    color: ${error ? "#dc3545" : "#28a745"};
                    margin-bottom: 1rem;
                  }
                  p {
                    margin: 0.5rem 0;
                    line-height: 1.5;
                  }
                  .status-icon {
                    font-size: 3rem;
                    margin-bottom: 1rem;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="status-icon">${error ? "❌" : "✅"}</div>
                  <h1>Authorization ${error ? "Failed" : "Successful"}!</h1>
                  ${errorDescription ? `<p>${errorDescription}</p>` : ""}
                  <p>You can close this window and return to the application.</p>
                </div>
                <script>window.close()</script>
              </body>
            </html>
          `);

          // Close the server
          server.close();

          if (code) {
            this.emit("authorized", code);
            console.info("Authorization code received, exchanging for tokens...");
            setTimeout(() => {
              resolve();
            }, 3000);
          } else {
            this.emit("error", new Error("No authorization code received"));
            reject(new Error("No authorization code received"));
          }
        }
      });

      // Start the local server
      server.listen(this.localServerPort, async () => {
        console.log("Please complete the authorization in your browser...");
        // Open the authorization URL in the default browser
        await open(authorizationUrl.toString());
      });
    });
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.codeVerifierValue = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    return this.codeVerifierValue;
  }

  private loadTokens(): void {
    try {
      if (existsSync(this.tokenFilePath)) {
        const data = readFileSync(this.tokenFilePath, "utf8");
        this._tokens = JSON.parse(data);
      }
    } catch (error) {
      console.error("Error loading tokens:", error);
    }
  }

  private persistTokens(): void {
    try {
      if (this._tokens) {
        writeFileSync(this.tokenFilePath, JSON.stringify(this._tokens, null, 2));
      }
    } catch (error) {
      console.error("Error persisting tokens:", error);
    }
  }

  private loadClientInfo(): void {
    try {
      if (existsSync(this.clientInfoPath)) {
        const data = readFileSync(this.clientInfoPath, "utf8");
        this._clientInformation = JSON.parse(data);
      }
    } catch (error) {
      console.error("Error loading client information:", error);
    }
  }

  private persistClientInfo(): void {
    try {
      if (this._clientInformation) {
        writeFileSync(this.clientInfoPath, JSON.stringify(this._clientInformation, null, 2));
      }
    } catch (error) {
      console.error("Error persisting client information:", error);
    }
  }
}

export const authenticator = FunctionAgent.from({
  name: "authenticator",
  description: "Authenticates user with a blocklet",
  inputSchema: z.object({
    appUrl: z.string(),
  }),
  outputSchema: z.object({
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
  }),
  fn: async (input: { appUrl: string }) => {
    const appUrl = new URL(input.appUrl);
    appUrl.pathname = "/.well-known/service/mcp";
    console.info("Connecting to blocklet app", appUrl.href);

    let transport: StreamableHTTPClientTransport;

    const provider = new BlockletOAuthProvider(appUrl.host);
    const authCodePromise = new Promise((resolve, reject) => {
      provider.once("authorized", async (code) => {
        await transport.finishAuth(code);
        resolve(code);
      });
      provider.once("error", reject);
    });

    transport = new StreamableHTTPClientTransport(appUrl, {
      authProvider: provider,
    });

    try {
      let tokens = await provider.tokens();
      if (tokens?.access_token && tokens?.refresh_token) {
        let decoded = JWT.decode(tokens.access_token);
        if (decoded) {
          const now = Date.now();
          const expiresAt = decoded.exp * 1000;
          if (now < expiresAt) {
            return {
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
            };
          }

          if (tokens.refresh_token) {
            decoded = JWT.decode(tokens.refresh_token);
            if (decoded) {
              const now = Date.now();
              const expiresAt = decoded.exp * 1000;
              if (now < expiresAt) {
                const oauthUrl = new URL(input.appUrl);
                oauthUrl.pathname = "/.well-known/oauth-authorization-server";
                const metadata = await fetch(oauthUrl.href).then((res) => res.json());
                try {
                  tokens = await refreshAuthorization(oauthUrl.href, {
                    metadata,
                    // biome-ignore lint/style/noNonNullAssertion: <explanation>
                    clientInformation: (await provider.clientInformation())!,
                    refreshToken: tokens.refresh_token,
                  });
                  await provider.saveTokens(tokens);
                  return {
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                  };
                } catch (error) {
                  console.error(
                    "Error refreshing authorization, resetting tokens and starting authorization",
                    error,
                  );
                  await provider.saveTokens(undefined);
                  await transport.start();
                }
              } else {
                console.info("Refresh token already expired, starting authorization");
                await transport.start();
              }
            }
          }
        }
      } else {
        console.info("No tokens found, starting authorization");
        await transport._authThenStart();
      }
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        const code = await authCodePromise;
        console.info("Authorization code received, finishing authorization...", Date.now());
        await transport.finishAuth(code as string);
        await transport.close();

        const tokens = await provider.tokens();
        if (tokens) {
          return {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
          };
        }
      } else {
        console.error("Error authorizing:", error);
        process.exit(1);
      }
    }
  },
});
