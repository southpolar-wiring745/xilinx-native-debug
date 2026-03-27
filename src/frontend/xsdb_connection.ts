import * as vscode from "vscode";
import { XSDBClient } from "../backend/xsdb/xsdb";

/**
 * Singleton connection manager for standalone XSDB access outside debug sessions.
 * Hex editor and future tools can reuse this connection.
 */
export class XSDBConnectionManager {
	private static instance: XSDBConnectionManager | undefined;
	private client: XSDBClient | undefined;
	private connecting = false;
	private xsdbPath: string | undefined;
	private hwServerUrl: string | undefined;

	private constructor() {}

	public static getInstance(): XSDBConnectionManager {
		if (!XSDBConnectionManager.instance) {
			XSDBConnectionManager.instance = new XSDBConnectionManager();
		}
		return XSDBConnectionManager.instance;
	}

	/**
	 * Get or create a connected XSDB client for standalone use.
	 * If already connected with the same parameters, returns the existing client.
	 */
	public async getOrCreate(xsdbPath: string, hwServerUrl: string): Promise<XSDBClient> {
		// Return existing client if it matches
		if (this.client && this.xsdbPath === xsdbPath && this.hwServerUrl === hwServerUrl) {
			return this.client;
		}

		// Prevent concurrent creation
		if (this.connecting) {
			throw new Error("XSDB connection is already being established.");
		}

		// Dispose any old client
		this.disposeClient();

		this.connecting = true;
		try {
			const client = new XSDBClient(xsdbPath);
			await client.start();

			// Connect to hw_server
			const connectResult = await client.sendCommand(`connect -url ${hwServerUrl}`);
			if (connectResult.toLowerCase().includes("error")) {
				client.kill();
				throw new Error(`Failed to connect to hw_server: ${connectResult}`);
			}

			this.client = client;
			this.xsdbPath = xsdbPath;
			this.hwServerUrl = hwServerUrl;
			return client;
		} finally {
			this.connecting = false;
		}
	}

	/**
	 * Returns the current client if available, or undefined.
	 */
	public getClient(): XSDBClient | undefined {
		return this.client;
	}

	/**
	 * Check whether a standalone XSDB client is currently connected.
	 */
	public isConnected(): boolean {
		return this.client !== undefined;
	}

	/**
	 * Dispose the current XSDB client if any.
	 */
	public dispose(): void {
		this.disposeClient();
		XSDBConnectionManager.instance = undefined;
	}

	private disposeClient(): void {
		if (this.client) {
			try {
				this.client.kill();
			} catch {
				// ignore
			}
			this.client = undefined;
			this.xsdbPath = undefined;
			this.hwServerUrl = undefined;
		}
	}
}
