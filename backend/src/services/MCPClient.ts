import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPTool, MCPToolCall, MCPToolResult, ConnectionStatus, Position, ShapeUpdate } from '../types';

interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export class MCPClient {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();
  private connectionStatus: Map<string, ConnectionStatus> = new Map();
  private tools: Map<string, MCPTool[]> = new Map();
  private retryAttempts: Map<string, number> = new Map();
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY = 1000; // 1 second

  async connect(config: MCPServerConfig): Promise<void> {
    return this.connectWithRetry(config, 0);
  }

  private async connectWithRetry(config: MCPServerConfig, attempt: number): Promise<void> {
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env
      });

      const client = new Client({
        name: 'diagram-ai-backend',
        version: '1.0.0'
      }, {
        capabilities: {}
      });

      await client.connect(transport);

      this.clients.set(config.name, client);
      this.transports.set(config.name, transport);

      // List available tools
      const toolsResponse = await client.listTools();
      this.tools.set(config.name, toolsResponse.tools as MCPTool[]);

      this.connectionStatus.set(config.name, {
        connected: true,
        serverName: config.name,
        lastChecked: new Date()
      });

      this.retryAttempts.set(config.name, 0);

      console.log(`Connected to MCP server: ${config.name}`);
      console.log(`Available tools: ${toolsResponse.tools.map((t: any) => t.name).join(', ')}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (attempt < this.MAX_RETRIES) {
        const delay = this.BASE_DELAY * Math.pow(2, attempt); // Exponential backoff
        console.warn(`Failed to connect to ${config.name} (attempt ${attempt + 1}/${this.MAX_RETRIES}). Retrying in ${delay}ms...`);
        console.error(`Error: ${errorMessage}`);

        this.retryAttempts.set(config.name, attempt + 1);

        await this.sleep(delay);
        return this.connectWithRetry(config, attempt + 1);
      }

      this.connectionStatus.set(config.name, {
        connected: false,
        serverName: config.name,
        lastChecked: new Date(),
        error: errorMessage
      });

      console.error(`Failed to connect to MCP server ${config.name} after ${this.MAX_RETRIES} attempts:`, error);
      throw error;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async reconnect(serverName: string, config: MCPServerConfig): Promise<void> {
    console.log(`Attempting to reconnect to ${serverName}...`);
    await this.disconnect(serverName);
    await this.connect(config);
  }

  async healthCheck(serverName: string): Promise<boolean> {
    const client = this.clients.get(serverName);
    if (!client) {
      return false;
    }

    try {
      // Try to list tools as a health check
      await client.listTools();

      this.connectionStatus.set(serverName, {
        connected: true,
        serverName,
        lastChecked: new Date()
      });

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.connectionStatus.set(serverName, {
        connected: false,
        serverName,
        lastChecked: new Date(),
        error: errorMessage
      });

      console.error(`Health check failed for ${serverName}:`, error);
      return false;
    }
  }

  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    const transport = this.transports.get(serverName);

    if (client && transport) {
      await client.close();
      await transport.close();
      this.clients.delete(serverName);
      this.transports.delete(serverName);
      this.tools.delete(serverName);
      this.connectionStatus.delete(serverName);
      console.log(`Disconnected from MCP server: ${serverName}`);
    }
  }

  async callTool(serverName: string, toolName: string, params: any): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`Not connected to MCP server: ${serverName}`);
    }

    try {
      const response = await client.callTool({
        name: toolName,
        arguments: params
      });

      return response.content;
    } catch (error) {
      console.error(`Error calling tool ${toolName} on ${serverName}:`, error);
      throw error;
    }
  }

  listTools(serverName: string): MCPTool[] {
    return this.tools.get(serverName) || [];
  }

  getConnectionStatus(serverName: string): ConnectionStatus | null {
    return this.connectionStatus.get(serverName) || null;
  }

  getAllConnectionStatuses(): ConnectionStatus[] {
    return Array.from(this.connectionStatus.values());
  }

  // Draw.io specific methods
  async createShape(
    type: string,
    label: string,
    position: Position,
    width: number = 120,
    height: number = 60
  ): Promise<string> {
    const result = await this.callTool('drawio', 'mcp_drawio_add_rectangle', {
      text: label,
      x: position.x,
      y: position.y,
      width,
      height,
      style: this.getShapeStyle(type)
    });

    // Extract cell ID from result
    return result[0]?.text || '';
  }

  async createEdge(
    sourceId: string,
    targetId: string,
    label?: string
  ): Promise<string> {
    const result = await this.callTool('drawio', 'mcp_drawio_add_edge', {
      source_id: sourceId,
      target_id: targetId,
      text: label || ''
    });

    return result[0]?.text || '';
  }

  async updateShape(id: string, updates: ShapeUpdate): Promise<void> {
    const params: any = { cell_id: id };

    if (updates.label !== undefined) params.text = updates.label;
    if (updates.position) {
      params.x = updates.position.x;
      params.y = updates.position.y;
    }
    if (updates.width !== undefined) params.width = updates.width;
    if (updates.height !== undefined) params.height = updates.height;
    if (updates.style !== undefined) params.style = updates.style;

    await this.callTool('drawio', 'mcp_drawio_edit_cell', params);
  }

  async deleteShape(id: string): Promise<void> {
    await this.callTool('drawio', 'mcp_drawio_delete_cell_by_id', {
      cell_id: id
    });
  }

  async applyLayout(algorithm: string = 'hierarchical'): Promise<void> {
    // Draw.io MCP doesn't have built-in layout, this would need custom implementation
    console.log(`Layout algorithm ${algorithm} requested - not yet implemented`);
  }

  async exportDiagram(format: string = 'xml'): Promise<Buffer> {
    // This would need to be implemented based on Draw.io MCP capabilities
    throw new Error('Export not yet implemented');
  }

  async getShapeByName(shapeName: string): Promise<any> {
    return await this.callTool('drawio', 'mcp_drawio_get_shape_by_name', {
      shape_name: shapeName
    });
  }

  async addCellOfShape(
    shapeName: string,
    position: Position,
    text?: string,
    width: number = 120,
    height: number = 60
  ): Promise<string> {
    const params: any = {
      shape_name: shapeName,
      x: position.x,
      y: position.y,
      width,
      height
    };

    if (text) params.text = text;

    const result = await this.callTool('drawio', 'mcp_drawio_add_cell_of_shape', params);
    return result[0]?.text || '';
  }

  async listPagedModel(
    page: number = 0,
    pageSize: number = 50,
    filter?: any
  ): Promise<any> {
    const params: any = { page, page_size: pageSize };
    if (filter) params.filter = filter;

    return await this.callTool('drawio', 'mcp_drawio_list_paged_model', params);
  }

  private getShapeStyle(type: string): string {
    const styles: Record<string, string> = {
      rectangle: 'whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
      ellipse: 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;',
      cloud: 'ellipse;shape=cloud;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;',
      cylinder: 'shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;',
      actor: 'shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;',
      default: 'whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;'
    };

    return styles[type] || styles.default;
  }
}

export const mcpClient = new MCPClient();
